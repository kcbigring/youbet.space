#!/usr/bin/env node
/**
 * Publishes the deployed source to Basescan, so the escrow can be read rather
 * than taken on trust. The landing page links to the WagerBook address; without
 * this, the person most likely to click it finds a hex blob.
 *
 *   npm run verify:mainnet
 *
 * Constructor arguments come from deployments/<network>.json rather than being
 * retyped: they have to match the deployment exactly, and one wrong address is
 * a failure that reads like a compiler mismatch.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const network = process.argv[2] || "base";
const file = path.resolve(__dirname, `../../deployments/${network}.json`);

if (!fs.existsSync(file)) {
  console.error(`No deployment recorded for ${network}. Deploy first.`);
  process.exit(1);
}
if (!process.env.BASESCAN_API_KEY) {
  console.error("BASESCAN_API_KEY is not set. Get one free at https://etherscan.io/myapikey");
  process.exit(1);
}

const record = JSON.parse(fs.readFileSync(file, "utf8"));
const { StakeToken, Treasury, GroupRegistry, ResolverRegistry, WagerBook } = record.contracts;
const { owner, limits } = record;

// Every constructor, in the order the deploy script ran them.
const targets = [
  { name: "PlayDollar", address: StakeToken, args: [owner] },
  { name: "Treasury", address: Treasury, args: [owner] },
  { name: "GroupRegistry", address: GroupRegistry, args: [] },
  { name: "ResolverRegistry", address: ResolverRegistry, args: [owner] },
  {
    name: "WagerBook",
    address: WagerBook,
    args: [
      owner,
      StakeToken,
      Treasury,
      GroupRegistry,
      ResolverRegistry,
      limits.maxStakeUnits,
      limits.maxPotUnits,
    ],
  },
];

let failed = 0;

for (const target of targets) {
  console.log(`\n${target.name}  ${target.address}`);
  const result = spawnSync(
    "npx",
    ["hardhat", "verify", "--network", network, target.address, ...target.args.map(String)],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }
  );

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  // Re-verifying is not a failure. It is the normal state of every contract
  // after the first successful run.
  if (/already verified/i.test(output)) {
    console.log("  already verified");
    continue;
  }
  if (result.status === 0) {
    console.log("  verified");
    continue;
  }
  failed += 1;
  console.log(output.trim().split("\n").slice(-12).join("\n"));
}

if (failed) {
  console.error(`\n${failed} did not verify.`);
  process.exit(1);
}
console.log(`\nAll ${targets.length} verified: https://basescan.org/address/${WagerBook}#code`);
