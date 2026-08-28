import { Router } from "express";
import prisma from "../prisma";
import { ethers } from "ethers";
import { asyncHandler } from "../lib/http";
import { notFound } from "../lib/errors";
import { authenticate, type AuthedRequest } from "../lib/auth";
import { reputationFor, monthlyVolumeCents } from "../lib/reputation";
import { addressFor } from "../lib/wallet";
import { getProvider } from "../lib/chain";
import { weiToCents } from "../lib/money";
import { env } from "../env";

const router = Router();
router.use(authenticate);

/// Wallet screen: balance, address and remaining monthly headroom.
router.get(
  "/me/wallet",
  asyncHandler(async (req: AuthedRequest, res) => {
    const address = await addressFor(req.userId!);

    let balanceCents: number | null = null;
    let balanceWei = "0";
    try {
      const balance = await getProvider().getBalance(address);
      balanceWei = balance.toString();
      balanceCents = weiToCents(balance);
    } catch (error) {
      console.warn("Could not read wallet balance", error);
    }

    const committed = await monthlyVolumeCents(req.userId!);

    res.json({
      ok: true,
      wallet: {
        address,
        chainId: env.chainId,
        balanceWei,
        balanceEth: ethers.formatEther(balanceWei),
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
    res.json({ ok: true, reputation: await reputationFor(req.userId!) });
  })
);

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
