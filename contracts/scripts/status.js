#!/usr/bin/env node
/**
 * "Am I ready to deploy?" — deployer address, balance, what the deploy costs at
 * the current gas price, and whether anything is already deployed.
 *
 * Usage: npm run status [network]     (default: base_sepolia)
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

const repoRoot = path.resolve(__dirname, "../..");
for (const f of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const NETWORKS = {
  base_sepolia: { chainId: 84532, rpc: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
  base: { chainId: 8453, rpc: process.env.BASE_RPC || "https://mainnet.base.org", explorer: "https://basescan.org" },
};

// Measured; see README. Deploying all four contracts.
const DEPLOY_GAS = 4_780_000n;

async function main() {
  const name = process.argv[2] || "base_sepolia";
  const net = NETWORKS[name];
  if (!net) {
    console.error(`Unknown network "${name}". Try: ${Object.keys(NETWORKS).join(", ")}`);
    process.exit(1);
  }

  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) {
    console.error("DEPLOYER_PRIVATE_KEY is not set in .env.local");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { cacheTimeout: -1 });
  const wallet = new ethers.Wallet(key);

  const [balance, fee, block] = await Promise.all([
    provider.getBalance(wallet.address),
    provider.getFeeData(),
    provider.getBlockNumber(),
  ]);

  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const cost = DEPLOY_GAS * gasPrice;
  // The deployer only ever pays for this one deploy — users fund their own
  // transactions — so a small multiple covers a gas spike or a redeploy.
  const recommended = cost * 3n;

  console.log(`network   ${name} (chain ${net.chainId}), block ${block}`);
  console.log(`deployer  ${wallet.address}`);
  console.log(`balance   ${ethers.formatEther(balance)} ETH`);
  console.log(`gas       ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`deploy    ~${ethers.formatEther(cost)} ETH for all four contracts`);
  console.log("");

  if (balance >= recommended) {
    console.log("READY — run: npm run deploy:base");
  } else if (balance >= cost) {
    console.log("Enough to deploy, but thin. Consider topping up.");
  } else {
    console.log(`NOT FUNDED — send Base Sepolia ETH to the deployer address above.`);
    console.log(`  Faucet:   https://portal.cdp.coinbase.com/products/faucet`);
    console.log(`  Explorer: ${net.explorer}/address/${wallet.address}`);
  }

  const file = path.join(repoRoot, "deployments", `${name}.json`);
  if (fs.existsSync(file)) {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`\nalready deployed ${r.deployedAt}:`);
    for (const [k, v] of Object.entries(r.contracts)) console.log(`  ${k.padEnd(17)} ${v}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
