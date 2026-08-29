#!/usr/bin/env node
/**
 * Runs a Prisma CLI command with the project's env-file precedence applied
 * (api/.env, then <repo>/.env.local, then <repo>/.env) — the Prisma CLI only
 * reads `.env`, so it would otherwise miss the local secrets file.
 *
 * For migrations it swaps DATABASE_URL for DIRECT_URL when one is set: Neon's
 * pooled endpoint cannot run DDL, but is the right thing to use at runtime.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const repoRoot = path.resolve(__dirname, "../..");
for (const file of [
  path.resolve(__dirname, "../.env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
]) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}

const args = process.argv.slice(2);
const isMigration = args[0] === "migrate" || args[0] === "db";

// `migrate diff --from-migrations` RESETS whatever it is handed as a shadow
// database. Pointing that at a real connection string wipes it. Generate
// migrations with `npm run prisma:diff`, which introspects via --from-url and
// never writes.
const shadowFlag = args.findIndex((a) => a === "--shadow-database-url");
if (shadowFlag !== -1) {
  const target = args[shadowFlag + 1] || "";
  const live = [process.env.DATABASE_URL, process.env.DIRECT_URL].filter(Boolean);
  if (live.some((url) => url && target.includes(new URL(url).hostname))) {
    console.error(
      "Refusing to use a live database as a shadow database — it would be reset.\n" +
        "Use `npm run prisma:diff` instead."
    );
    process.exit(1);
  }
}

const env = { ...process.env };
if (isMigration && env.DIRECT_URL) {
  env.DATABASE_URL = env.DIRECT_URL;
  console.log("Using DIRECT_URL for this command (pooled endpoints cannot run DDL).");
}

if (!env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Add it to .env.local — for Neon, the pooled\n" +
      "connection string, plus DIRECT_URL for the unpooled one."
  );
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...args], { stdio: "inherit", env });
process.exit(result.status ?? 1);
