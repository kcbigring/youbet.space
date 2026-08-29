import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { smsEnabled } from "../twilio";
import { firebaseEnabled } from "../lib/firebase";
import { asyncHandler, parseBody } from "../lib/http";
import { requireAdmin } from "../lib/auth";
import { contractAt, getProvider, getRelayer, isChainConfigured } from "../lib/chain";
import { ethers } from "ethers";

const router = Router();
const startedAt = Date.now();

/// Liveness — must not touch the database, so it stays green during a DB blip.
router.get("/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
});

/// Readiness — reports every dependency the API needs to serve traffic.
router.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      checks.database = { ok: false, detail: (error as Error).message };
    }

    try {
      const block = await getProvider().getBlockNumber();
      checks.chain = { ok: true, detail: `block ${block}` };
    } catch (error) {
      checks.chain = { ok: false, detail: (error as Error).message };
    }

    checks.contracts = {
      ok: isChainConfigured(),
      detail: env.wagerBookAddress ? `book ${env.wagerBookAddress}` : "WAGER_BOOK_ADDRESS not set",
    };
    // Invites are share links, so SMS is a convenience rather than a dependency.
    checks.phoneVerification = {
      ok: firebaseEnabled() || !env.requireVerifiedPhone,
      detail: firebaseEnabled() ? "firebase" : "not configured (verification not required)",
    };

    const ok = Object.values(checks).every((c) => c.ok);
    res.status(ok ? 200 : 503).json({ ok, chainId: env.chainId, checks });
  })
);

/// Prometheus text exposition — enough to alert on before wiring a full agent.
router.get(
  "/metrics",
  asyncHandler(async (_req, res) => {
    const [users, groups, wagers, settled, locked] = await Promise.all([
      prisma.user.count(),
      prisma.group.count(),
      prisma.wager.count(),
      prisma.wager.count({ where: { status: "SETTLED" } }),
      prisma.wager.count({ where: { status: "LOCKED" } }),
    ]);

    const memory = process.memoryUsage();
    const lines = [
      "# HELP youbet_users_total Registered users",
      "# TYPE youbet_users_total gauge",
      `youbet_users_total ${users}`,
      "# HELP youbet_groups_total Groups created",
      "# TYPE youbet_groups_total gauge",
      `youbet_groups_total ${groups}`,
      "# HELP youbet_wagers_total Wagers created",
      "# TYPE youbet_wagers_total gauge",
      `youbet_wagers_total ${wagers}`,
      "# HELP youbet_wagers_settled_total Wagers that reached settlement",
      "# TYPE youbet_wagers_settled_total gauge",
      `youbet_wagers_settled_total ${settled}`,
      "# HELP youbet_wagers_locked Wagers currently awaiting resolution",
      "# TYPE youbet_wagers_locked gauge",
      `youbet_wagers_locked ${locked}`,
      "# HELP youbet_process_uptime_seconds API uptime",
      "# TYPE youbet_process_uptime_seconds counter",
      `youbet_process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
      "# HELP youbet_process_heap_bytes Heap in use",
      "# TYPE youbet_process_heap_bytes gauge",
      `youbet_process_heap_bytes ${memory.heapUsed}`,
    ];

    res.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
  })
);

/// Client bootstrap: the limits and addresses the frontend needs to render.
router.get("/config", (_req, res) => {
  res.json({
    ok: true,
    chainId: env.chainId,
    wagerBookAddress: env.wagerBookAddress ?? null,
    limits: {
      maxStakeCents: env.maxStakeCents,
      maxPotCents: env.maxPotCents,
      monthlyLimitCents: env.monthlyLimitCents,
      feeBps: 100,
    },
    smsEnabled,
    phoneVerification: firebaseEnabled() ? "firebase" : null,
    requireVerifiedPhone: env.requireVerifiedPhone,
  });
});

// ------------------------------------------------------------------- admin

router.get(
  "/admin/relayer",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const relayer = getRelayer();
    const balance = await getProvider().getBalance(relayer.address);
    res.json({
      ok: true,
      relayer: { address: relayer.address, balanceEth: ethers.formatEther(balance) },
    });
  })
);

const resolverSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  allowed: z.boolean(),
  name: z.string().max(60).default(""),
});

router.post(
  "/admin/resolvers",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(resolverSchema, req);
    if (!env.resolverRegistryAddress) {
      return res.status(503).json({ ok: false, error: "RESOLVER_REGISTRY_ADDRESS is not configured" });
    }
    const registry = contractAt("ResolverRegistry", env.resolverRegistryAddress, getRelayer());
    const tx = await registry.setResolver(body.address, body.allowed, body.name);
    await tx.wait();
    res.json({ ok: true, txHash: tx.hash });
  })
);

export default router;
