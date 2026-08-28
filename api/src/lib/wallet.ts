import crypto from "crypto";
import { ethers } from "ethers";
import prisma from "../prisma";
import { getProvider, getRelayer } from "./chain";
import { ApiError } from "./errors";

/// Embedded wallets: every user gets a signing key the platform holds encrypted,
/// so nobody manages a seed phrase (execution plan §13). Gas is sponsored by the
/// relayer. Stakes never sit here — they go straight into the wager escrow.
///
/// This is a custodial signing key. Keep WALLET_ENCRYPTION_KEY in a KMS or secret
/// manager, never in the repo, and note the custody question for legal review.

const ALGORITHM = "aes-256-gcm";

function masterKey(): Buffer {
  const raw = process.env.WALLET_ENCRYPTION_KEY;
  if (!raw) throw new ApiError(503, "WALLET_ENCRYPTION_KEY is not configured");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
  if (key.length !== 32) throw new ApiError(503, "WALLET_ENCRYPTION_KEY must be 32 bytes");
  return key;
}

function encrypt(plaintext: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(record: { encryptedKey: string; iv: string; authTag: string }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.encryptedKey, "base64")), decipher.final()]).toString("utf8");
}

/// Returns the user's wallet, creating one on first use.
export async function ensureWallet(userId: string) {
  const existing = await prisma.embeddedWallet.findUnique({ where: { userId } });
  if (existing) return existing;

  const wallet = ethers.Wallet.createRandom();
  const created = await prisma.embeddedWallet.create({
    data: { userId, address: wallet.address, ...encrypt(wallet.privateKey) },
  });
  await prisma.user.update({ where: { id: userId }, data: { walletAddress: wallet.address } });
  return created;
}

/// A signer for the user, connected to the chain. Decryption happens per call and
/// the key is never returned to a caller.
export async function signerFor(userId: string): Promise<ethers.Wallet> {
  const record = await ensureWallet(userId);
  return new ethers.Wallet(decrypt(record), getProvider());
}

export async function addressFor(userId: string): Promise<string> {
  return (await ensureWallet(userId)).address;
}

/// Tops the user's wallet up from the relayer so a transaction can pay for gas.
/// Only ever sends the shortfall, and only up to `maxTopUpWei`.
export async function sponsorGas(address: string, needed: bigint) {
  const provider = getProvider();
  const balance = await provider.getBalance(address);
  if (balance >= needed) return { sponsored: 0n, balance };

  const relayer = getRelayer();
  const shortfall = needed - balance;
  const maxTopUp = ethers.parseEther(process.env.MAX_GAS_TOPUP_ETH || "0.01");
  if (shortfall > maxTopUp) {
    throw new ApiError(503, "Gas sponsorship limit exceeded for this transaction");
  }

  const tx = await relayer.sendTransaction({ to: address, value: shortfall });
  await tx.wait();
  return { sponsored: shortfall, balance: balance + shortfall };
}

/// Estimates the cost of a call, tops the wallet up, then sends it.
export async function sendSponsored(
  userId: string,
  build: (signer: ethers.Wallet) => Promise<ethers.ContractTransactionResponse>,
  value = 0n
) {
  const signer = await signerFor(userId);
  const provider = getProvider();
  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? ethers.parseUnits("1", "gwei");

  // Cover the transfer value plus a generous gas allowance.
  await sponsorGas(signer.address, value + gasPrice * 500_000n);

  const tx = await build(signer);
  const receipt = await tx.wait();
  return { hash: tx.hash, receipt, address: signer.address };
}
