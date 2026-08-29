#!/usr/bin/env node
/**
 * Copies the addresses from deployments/<network>.json into the env files that
 * actually read them, so nothing is transcribed by hand:
 *
 *   <repo>/.env.local   FACTORY_ADDRESS, GROUP_REGISTRY_ADDRESS, …   (API)
 *   web/.env.local      NEXT_PUBLIC_FACTORY_ADDRESS, NEXT_PUBLIC_CHAIN_ID
 *
 * Usage: npm run sync-env [network]   (default: base_sepolia)
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const network = process.argv[2] || "base_sepolia";
const file = path.join(repoRoot, "deployments", `${network}.json`);

if (!fs.existsSync(file)) {
  console.error(`No deployment found at ${path.relative(process.cwd(), file)}.`);
  console.error(`Deploy first:  npm run deploy:base`);
  process.exit(1);
}

const record = JSON.parse(fs.readFileSync(file, "utf8"));
const c = record.contracts;

/// Rewrites KEY="value" in place, appending the key when it is not present.
function setVars(target, vars) {
  if (!fs.existsSync(target)) fs.writeFileSync(target, "");
  let text = fs.readFileSync(target, "utf8");

  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
  }

  fs.writeFileSync(target, text);
  console.log(`  ${path.relative(repoRoot, target)}`);
  for (const key of Object.keys(vars)) console.log(`    ${key}`);
}

console.log(`Syncing ${network} (chain ${record.chainId}) into:`);

setVars(path.join(repoRoot, ".env.local"), {
  CHAIN_ID: record.chainId,
  WAGER_BOOK_ADDRESS: c.WagerBook,
  GROUP_REGISTRY_ADDRESS: c.GroupRegistry,
  RESOLVER_REGISTRY_ADDRESS: c.ResolverRegistry,
  TREASURY_ADDRESS: c.Treasury,
});

setVars(path.join(repoRoot, "web/.env.local"), {
  NEXT_PUBLIC_CHAIN_ID: record.chainId,
  NEXT_PUBLIC_WAGER_BOOK_ADDRESS: c.WagerBook,
});

console.log("\nRestart the API and `next dev` to pick these up.");
