import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { env } from "../env";
import { ApiError } from "./errors";

/// Reads Hardhat build output so the API and the contracts can never drift.
const ARTIFACT_ROOT = path.resolve(__dirname, "../../../contracts/artifacts/contracts");

const artifactCache = new Map<string, { abi: ethers.InterfaceAbi; bytecode: string }>();

export function artifact(name: string) {
  const cached = artifactCache.get(name);
  if (cached) return cached;

  const file = path.join(ARTIFACT_ROOT, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new ApiError(503, `Contract artifact for ${name} not found. Run "npm run compile" in contracts/.`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = { abi: parsed.abi as ethers.InterfaceAbi, bytecode: parsed.bytecode as string };
  artifactCache.set(name, value);
  return value;
}

let provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    // cacheTimeout: -1 disables ethers' short-lived RPC cache. The relayer sends
    // transactions back to back when sponsoring gas, and a cached nonce makes the
    // second one fail with NONCE_EXPIRED.
    provider = new ethers.JsonRpcProvider(env.rpcUrl, env.chainId, { cacheTimeout: -1 });
  }
  return provider;
}

/// Relayer wallet. It sponsors gas so users never hold a seed phrase; it is not a
/// custodian, since stakes sit in the wager contract and pay out to participants.
export function getRelayer(): ethers.Wallet {
  if (!env.deployerPrivateKey) {
    throw new ApiError(503, "Relayer is not configured (DEPLOYER_PRIVATE_KEY missing)");
  }
  return new ethers.Wallet(env.deployerPrivateKey, getProvider());
}

export function contractAt(name: string, address: string, runner?: ethers.ContractRunner) {
  return new ethers.Contract(address, artifact(name).abi, runner ?? getProvider());
}

/// Every wager lives in one contract, keyed by id.
export function getBook(runner?: ethers.ContractRunner) {
  if (!env.wagerBookAddress) {
    throw new ApiError(503, "WAGER_BOOK_ADDRESS is not configured. Deploy the contracts first.");
  }
  return contractAt("WagerBook", env.wagerBookAddress, runner);
}

export const isChainConfigured = () => Boolean(env.wagerBookAddress);

/// Hash of the immutable terms, mirrored on-chain so the record cannot be edited
/// after funds lock (execution plan §16).
export function hashTerms(terms: {
  proposition: string;
  sideLabels: string[];
  stakeCents: number;
  bondCents: number;
  eventDeadline: Date;
  resolutionDeadline: Date;
  thresholdBps: number;
}): string {
  const canonical = JSON.stringify({
    proposition: terms.proposition.trim(),
    sideLabels: terms.sideLabels.map((s) => s.trim()),
    stakeCents: terms.stakeCents,
    bondCents: terms.bondCents,
    eventDeadline: terms.eventDeadline.toISOString(),
    resolutionDeadline: terms.resolutionDeadline.toISOString(),
    thresholdBps: terms.thresholdBps,
  });
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

// Index 0 is Status.None — an id that was never created.
const STATUS_BY_INDEX = ["NONE", "OPEN", "LOCKED", "SETTLED", "REFUNDED", "CANCELLED"] as const;
export type OnchainStatus = (typeof STATUS_BY_INDEX)[number];

/// Full participant-level state. This is what makes the chain authoritative:
/// the API mirrors it rather than trusting a client to report what it did.
export async function readWagerParticipants(wagerId: string) {
  const book = getBook();
  const addresses: string[] = await book.getParticipants(wagerId);

  return Promise.all(
    addresses.map(async (participant) => {
      // One call per participant instead of five.
      const [isParticipant, side, hasResolved, resolutionChoice, conceded] =
        await book.participantState(wagerId, participant);
      const credits = await book.credits(participant);
      void isParticipant;
      return {
        address: participant as string,
        side: Number(side),
        hasResolved: Boolean(hasResolved),
        // The side they said won, which for a conceder is the opposite of theirs.
        resolutionChoice: Number(resolutionChoice),
        conceded: Boolean(conceded),
        creditsWei: (credits as bigint).toString(),
      };
    })
  );
}

export async function readWagerState(wagerId: string) {
  const [status, winningSide, participants, pot, required, forSide0, forSide1] =
    await getBook().summary(wagerId);
  return {
    status: STATUS_BY_INDEX[Number(status)] as OnchainStatus,
    winningSide: Number(winningSide),
    participants: Number(participants),
    potWei: (pot as bigint).toString(),
    attestationsRequired: Number(required),
    attestations: [Number(forSide0), Number(forSide1)],
  };
}
