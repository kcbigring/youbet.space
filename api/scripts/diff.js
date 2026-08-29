#!/usr/bin/env node
/**
 * Generates a migration by introspecting the live database and diffing it
 * against schema.prisma. Uses --from-url, which only reads.
 *
 * Never use `migrate diff --from-migrations` with a real connection string as
 * the shadow database: it resets that database to replay migrations into it.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const repoRoot = path.resolve(__dirname, "../..");
for (const file of [path.resolve(__dirname, "../.env"), path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}

const name = process.argv[2];
if (!name) {
  console.error("Usage: npm run prisma:diff -- <migration_name>");
  process.exit(1);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const dir = path.resolve(__dirname, `../prisma/migrations/${stamp}_${name}`);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
  { encoding: "utf8", env: process.env }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const sql = result.stdout.trim();
if (!sql || /^-- This is an empty migration/.test(sql)) {
  console.log("No schema changes to migrate.");
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "migration.sql"), sql + "\n");
console.log(`Wrote ${path.relative(process.cwd(), path.join(dir, "migration.sql"))}\n`);
console.log(sql);
