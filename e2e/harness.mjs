#!/usr/bin/env node
// Stands up the whole product locally and drives it through a real browser.
//
// Everything that broke in the first week of running this thing broke in the
// seams — a client posting a shape the API rejected, a chain list whose order
// decided which network reads went to, an env var read under a different name
// than it was written, a component unmounted by the event it was meant to
// report. None of that is visible to a type checker or a unit test, and all of
// it is obvious the moment the thing actually runs.
//
// So: a real chain, the real contracts, the real API, the real web app, and a
// browser clicking through them.
//
//   node e2e/harness.mjs            run it
//   node e2e/harness.mjs --headed   watch it
//   node e2e/harness.mjs --keep     leave the stack up afterwards
//
// The one thing not covered is Coinbase's own onboarding, which demands a
// verified email before it will mint a passkey. wagmi's mock connector stands
// in for the wallet: it answers `wallet_sendCalls` by forwarding each call to
// the node, so every line of our batching, waiting and reconciling runs exactly
// as it does in production — only the key custody differs.

import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHAIN_PORT = 8545;
const API_PORT = 4100;
const WEB_PORT = 3100;
const DB_URL = "postgresql://youbet:youbet@127.0.0.1:5433/youbet_e2e";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);

const children = [];
let shuttingDown = false;

function run(name, command, args, { cwd = ROOT, env = {}, quiet = true } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  // Long-running services are noisy and mostly uninteresting until something
  // fails, so their output is buffered and printed only if it does.
  child.log = "";
  const collect = (chunk) => {
    child.log = (child.log + chunk).slice(-20_000);
    if (!quiet) process.stdout.write(`  ${name}: ${chunk}`);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0 && !child.expectExit) {
      console.error(`\n${name} exited with ${code}:\n${child.log}`);
    }
  });
  children.push({ name, child });
  return child;
}

/// Waits for something to answer, rather than sleeping and hoping.
async function waitFor(label, check, { timeoutMs = 120_000, everyMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

const httpOk = (url, init) => async () => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2_000) });
  return res.ok;
};

const rpcOk = (url) => async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(2_000),
  });
  return res.ok;
};

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (flag("keep")) {
    console.log(`\nStack left up: chain :${CHAIN_PORT} · api :${API_PORT} · web :${WEB_PORT}`);
    console.log("Stop it with: docker compose -f e2e/docker-compose.yml down && pkill -f 'hardhat node'");
    process.exit(code);
  }
  for (const { child } of children.reverse()) child.kill("SIGTERM");
  await exec("docker", ["compose", "-f", "e2e/docker-compose.yml", "down", "-v"], { cwd: ROOT }).catch(
    () => {}
  );
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));

const step = (n, text) => console.log(`\n[${n}/7] ${text}`);

async function main() {
  await exec("docker", ["info"]).catch(() => {
    throw new Error("Docker is not running. Start Docker Desktop and try again.");
  });

  step(1, "Postgres");
  await exec("docker", ["compose", "-f", "e2e/docker-compose.yml", "up", "-d", "--wait"], { cwd: ROOT });

  step(2, "Local chain");
  run("chain", "npx", ["hardhat", "node", "--port", String(CHAIN_PORT)], {
    cwd: path.join(ROOT, "contracts"),
  });
  await waitFor("the chain", rpcOk(`http://127.0.0.1:${CHAIN_PORT}`));

  step(3, "Contracts");
  await exec("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
    cwd: path.join(ROOT, "contracts"),
    env: { ...process.env, PROTOCOL_OWNER: "", STAKE_TOKEN_ADDRESS: "", TREASURY_ADDRESS: "" },
  });
  const deployment = JSON.parse(
    await readFile(path.join(ROOT, "deployments", "localhost.json"), "utf8")
  );
  const { StakeToken, WagerBook, GroupRegistry, ResolverRegistry, Treasury } = deployment.contracts;
  console.log(`      book ${WagerBook}`);

  step(4, "Schema");
  await exec("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], {
    cwd: path.join(ROOT, "api"),
    env: { ...process.env, DATABASE_URL: DB_URL },
  });

  step(5, "API");
  const apiEnv = {
    NODE_ENV: "test",
    PORT: String(API_PORT),
    DATABASE_URL: DB_URL,
    DIRECT_URL: DB_URL,
    CHAIN_ID: "31337",
    BASE_RPC: `http://127.0.0.1:${CHAIN_PORT}`,
    WAGER_BOOK_ADDRESS: WagerBook,
    STAKE_TOKEN_ADDRESS: StakeToken,
    GROUP_REGISTRY_ADDRESS: GroupRegistry,
    RESOLVER_REGISTRY_ADDRESS: ResolverRegistry,
    TREASURY_ADDRESS: Treasury,
    OTP_PEPPER: "harness-pepper",
    API_KEY: "harness-admin-key",
    // No Firebase, so /auth/request-code hands the code back in the response
    // and the browser can sign in without an SMS.
    FIREBASE_PROJECT_ID: "",
    OPENAI_API_KEY: "",
    SEND_INVITE_SMS: "false",
  };
  run("api", "npx", ["ts-node", "--transpile-only", "src/index.ts"], {
    cwd: path.join(ROOT, "api"),
    env: apiEnv,
  });
  await waitFor("the API", httpOk(`http://127.0.0.1:${API_PORT}/health`));

  step(6, "Web");
  // Hardhat's first two accounts, which the node signs for. They are the same
  // on every run, which is what lets the browser hold one and the test assert
  // against the other.
  const [ALICE, BOB, CAROL] = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ];
  const webEnv = {
    PORT: String(WEB_PORT),
    NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
    API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_WAGER_BOOK_ADDRESS: WagerBook,
    NEXT_PUBLIC_STAKE_TOKEN_ADDRESS: StakeToken,
    NEXT_PUBLIC_GROUP_REGISTRY_ADDRESS: GroupRegistry,
    NEXT_PUBLIC_E2E_ACCOUNT: ALICE,
    // Gas is free on a local node, so no paymaster: the app is built to work
    // without one and this exercises that path too.
    NEXT_PUBLIC_PAYMASTER_URL: "",
    NEXT_PUBLIC_FIREBASE_API_KEY: "",
  };
  run("web", "npx", ["next", "dev", "--port", String(WEB_PORT)], {
    cwd: path.join(ROOT, "web"),
    env: webEnv,
  });
  await waitFor("the web app", httpOk(`http://127.0.0.1:${WEB_PORT}/`), { timeoutMs: 180_000 });

  step(7, "Browser");
  const playwright = run(
    "playwright",
    "npx",
    ["playwright", "test", "e2e/flow.spec.ts", ...(flag("headed") ? ["--headed"] : [])],
    {
      cwd: path.join(ROOT, "web"),
      env: {
        E2E_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
        E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
        E2E_RPC_URL: `http://127.0.0.1:${CHAIN_PORT}`,
        E2E_WAGER_BOOK: WagerBook,
        E2E_STAKE_TOKEN: StakeToken,
        E2E_GROUP_REGISTRY: GroupRegistry,
        E2E_ALICE: ALICE,
        E2E_BOB: BOB,
        E2E_CAROL: CAROL,
      },
      quiet: false,
    }
  );
  playwright.expectExit = true;
  const [code] = await once(playwright, "exit");
  await shutdown(code ?? 1);
}

main().catch(async (error) => {
  console.error(`\n${error.message}`);
  await shutdown(1);
});
