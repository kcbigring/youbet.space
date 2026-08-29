#!/usr/bin/env node
/**
 * Requests Base Sepolia ETH for the deployer from the CDP faucet.
 *
 * Needs a Secret API Key from a real CDP project (not Sandbox):
 *   portal.cdp.coinbase.com -> your project -> API Keys -> Create secret API key
 * then in .env.local:
 *   CDP_API_KEY_ID="..."
 *   CDP_API_KEY_SECRET="..."
 *
 * The web faucet at portal.cdp.coinbase.com/products/faucet needs none of this
 * and is the faster path for a one-off.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

const repoRoot = path.resolve(__dirname, "../..");
for (const f of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

async function main() {
  const { CDP_API_KEY_ID: id, CDP_API_KEY_SECRET: secret, DEPLOYER_PRIVATE_KEY: key } = process.env;

  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env.local");
  const address = new ethers.Wallet(key).address;

  if (!id || !secret) {
    console.log(`Deployer: ${address}\n`);
    console.log("No CDP credentials found. Either:");
    console.log("  1. Use the web faucet (no keys needed):");
    console.log("     https://portal.cdp.coinbase.com/products/faucet");
    console.log("     Network: Base Sepolia, Token: ETH\n");
    console.log("  2. Or create a secret API key in your CDP project and set");
    console.log("     CDP_API_KEY_ID and CDP_API_KEY_SECRET in .env.local.");
    console.log("     Sandbox keys will not work — they are a different product.");
    process.exit(1);
  }

  const { CdpClient } = require("@coinbase/cdp-sdk");
  const cdp = new CdpClient({ apiKeyId: id, apiKeySecret: secret });

  console.log(`Requesting Base Sepolia ETH for ${address}…`);
  const result = await cdp.evm.requestFaucet({ address, network: "base-sepolia", token: "eth" });
  console.log(`Sent: ${result.transactionHash}`);
  console.log(`https://sepolia.basescan.org/tx/${result.transactionHash}`);
  console.log(`\nCheck it landed:  npm run status`);
}

main().catch((error) => {
  const message = error?.message || String(error);
  console.error(`Faucet request failed: ${message}`);
  if (/unauthorized/i.test(message)) {
    console.error("\n401 means the key is not a CDP Platform secret API key.");
    console.error("Sandbox keys (Account/Transfers/Customers/Orders scopes) will not work.");
  }
  process.exit(1);
});
