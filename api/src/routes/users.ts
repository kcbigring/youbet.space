import { Router } from "express";
import prisma from "../prisma";
import { ethers } from "ethers";
import { asyncHandler } from "../lib/http";
import { notFound } from "../lib/errors";
import { authenticate, type AuthedRequest } from "../lib/auth";
import { reputationFor, monthlyVolumeCents } from "../lib/reputation";
import { standingFor, TIERS } from "../lib/standing";
import { contractAt } from "../lib/chain";
import { unitsToCents } from "../lib/money";
import { env } from "../env";

const router = Router();
router.use(authenticate);

/// Wallet screen: balance, address and remaining monthly headroom. The address
/// belongs to the user's own smart account — we only record it.
router.get(
  "/me/wallet",
  asyncHandler(async (req: AuthedRequest, res) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    const address = me.walletAddress;

    if (!address) {
      return res.json({
        ok: true,
        wallet: null,
        limits: {
          monthlyLimitCents: env.monthlyLimitCents,
          committedCents: await monthlyVolumeCents(req.userId!),
          remainingCents: env.monthlyLimitCents,
          maxStakeCents: env.maxStakeCents,
          maxPotCents: env.maxPotCents,
        },
      });
    }

    // The spendable balance is the stake token, not the native token — users
    // never hold ETH, since gas is sponsored.
    let balanceCents: number | null = null;
    let balanceUnits = "0";
    try {
      if (env.stakeTokenAddress) {
        const token = contractAt("TestUSD", env.stakeTokenAddress);
        const balance: bigint = await token.balanceOf(address);
        balanceUnits = balance.toString();
        balanceCents = unitsToCents(balance);
      }
    } catch (error) {
      console.warn("Could not read wallet balance", error);
    }

    const committed = await monthlyVolumeCents(req.userId!);

    res.json({
      ok: true,
      wallet: {
        address,
        chainId: env.chainId,
        balanceUnits,
        balanceCents,
      },
      limits: {
        monthlyLimitCents: env.monthlyLimitCents,
        committedCents: committed,
        remainingCents: Math.max(0, env.monthlyLimitCents - committed),
        maxStakeCents: env.maxStakeCents,
        maxPotCents: env.maxPotCents,
      },
    });
  })
);

router.get(
  "/me/reputation",
  asyncHandler(async (req: AuthedRequest, res) => {
    const reputation = await reputationFor(req.userId!);
    res.json({ ok: true, reputation, standing: standingFor(reputation) });
  })
);

/// Every tier and what it takes, so the app can show someone what is ahead
/// rather than only what they currently have.
router.get("/tiers", (_req, res) => {
  res.json({ ok: true, tiers: TIERS });
});

router.get(
  "/:id/reputation",
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, displayName: true, handle: true },
    });
    if (!user) throw notFound("User not found");

    // Reputation lives inside groups, so it is only visible to people who share one.
    const shared = await prisma.groupMember.findFirst({
      where: {
        userId: req.userId!,
        group: { members: { some: { userId: user.id } } },
      },
    });
    if (!shared && user.id !== req.userId) throw notFound("User not found");

    res.json({ ok: true, user, reputation: await reputationFor(user.id) });
  })
);

router.get(
  "/me/notifications",
  asyncHandler(async (req: AuthedRequest, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId!, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ ok: true, notifications });
  })
);

export default router;
