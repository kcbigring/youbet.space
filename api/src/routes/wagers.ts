import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { sendSms } from "../twilio";
import { asyncHandler, parseBody } from "../lib/http";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import {
  authenticate,
  generateOtp,
  hashOtp,
  normalizePhone,
  otpExpiry,
  type AuthedRequest,
} from "../lib/auth";
import { parseWager } from "../lib/parse";
import { centsToWei, formatUsd, weiToCents } from "../lib/money";
import { getFactory, getWager, hashTerms, isChainConfigured, readWagerState } from "../lib/chain";
import { addressFor, sendSponsored } from "../lib/wallet";
import { monthlyVolumeCents } from "../lib/reputation";

const router = Router();
router.use(authenticate);

const HOUR = 60 * 60 * 1000;

const wagerInclude = {
  creator: { select: { id: true, displayName: true, handle: true } },
  group: { select: { id: true, name: true } },
  participants: {
    include: { user: { select: { id: true, displayName: true, handle: true } } },
  },
} as const;

async function loadWager(id: string, userId: string) {
  const wager = await prisma.wager.findUnique({ where: { id }, include: wagerInclude });
  if (!wager) throw notFound("Wager not found");

  const isParticipant = wager.participants.some((p) => p.userId === userId);
  if (!isParticipant && wager.creatorId !== userId) {
    // Group members can see their group's wagers even before being invited.
    if (!wager.groupId) throw forbidden("You do not have access to this wager");
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: wager.groupId, userId } },
    });
    if (!membership) throw forbidden("You do not have access to this wager");
  }
  return wager;
}

// ------------------------------------------------------------------ create

router.post(
  "/parse",
  asyncHandler(async (req, res) => {
    const { text } = parseBody(z.object({ text: z.string().trim().min(3).max(500) }), req);
    const parsed = await parseWager(text);
    res.json({ ok: true, parsed });
  })
);

const createSchema = z.object({
  groupId: z.string().optional(),
  proposition: z.string().trim().min(3).max(280),
  sideLabels: z.tuple([z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)]),
  stakeCents: z.number().int().positive(),
  bondCents: z.number().int().min(0).optional(),
  maxParticipants: z.number().int().min(2).max(20).default(2),
  resolutionMethod: z.enum(["ATTESTATION", "ORACLE"]).default("ATTESTATION"),
  oracleSource: z.string().max(60).optional(),
  thresholdBps: z.number().int().min(1).max(10_000).optional(),
  category: z.string().max(40).optional(),
  eventDeadline: z.coerce.date(),
  fundingDeadline: z.coerce.date().optional(),
  ownerSplitBps: z.number().int().min(0).max(10_000).optional(),
  creatorSide: z.number().int().min(0).max(1).default(0),
  invitePhones: z.array(z.string().min(7)).max(19).optional(),
});

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = parseBody(createSchema, req);
    const userId = req.userId!;

    // Group defaults and governance, when the wager belongs to one.
    let group = null;
    if (body.groupId) {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: body.groupId, userId } },
        include: { group: true },
      });
      if (!membership) throw forbidden("You are not a member of that group");
      group = membership.group;
    }

    const maxStake = Math.min(env.maxStakeCents, group?.maxStakeCents ?? env.maxStakeCents);
    const maxPot = Math.min(env.maxPotCents, group?.maxPotCents ?? env.maxPotCents);
    const monthlyLimit = Math.min(env.monthlyLimitCents, group?.monthlyLimitCents ?? env.monthlyLimitCents);

    if (body.stakeCents > maxStake) {
      throw badRequest(`Stake is above the ${formatUsd(maxStake)} limit per person`);
    }
    const pot = body.stakeCents * body.maxParticipants;
    if (pot > maxPot) throw badRequest(`Total pot is above the ${formatUsd(maxPot)} limit`);

    const committed = await monthlyVolumeCents(userId);
    if (committed + body.stakeCents > monthlyLimit) {
      throw badRequest(
        `This would put you over your ${formatUsd(monthlyLimit)} monthly limit (${formatUsd(committed)} committed)`
      );
    }

    const now = new Date();
    const eventDeadline = body.eventDeadline;
    if (eventDeadline <= now) throw badRequest("The event deadline must be in the future");

    const fundingDeadline = body.fundingDeadline ?? eventDeadline;
    if (fundingDeadline > eventDeadline) throw badRequest("Funding must close before the event ends");

    const windowHours = group?.resolutionWindowHours ?? 72;
    const resolutionDeadline = new Date(eventDeadline.getTime() + windowHours * HOUR);

    const bondCents = body.bondCents ?? group?.defaultBondCents ?? 100;
    const thresholdBps = body.thresholdBps ?? group?.defaultThresholdBps ?? 5000;

    const termsHash = hashTerms({
      proposition: body.proposition,
      sideLabels: body.sideLabels,
      stakeCents: body.stakeCents,
      bondCents,
      eventDeadline,
      resolutionDeadline,
      thresholdBps,
    });

    const wager = await prisma.wager.create({
      data: {
        groupId: body.groupId,
        creatorId: userId,
        proposition: body.proposition,
        sideLabels: body.sideLabels,
        category: body.category,
        stakeCents: body.stakeCents,
        bondCents,
        ownerSplitBps: body.ownerSplitBps ?? 0,
        resolutionMethod: body.resolutionMethod,
        oracleSource: body.oracleSource,
        thresholdBps,
        fundingDeadline,
        eventDeadline,
        resolutionDeadline,
        termsHash,
        chainId: env.chainId,
        status: "DRAFT",
        participants: {
          create: { userId, side: body.creatorSide, state: "INVITED" },
        },
      },
      include: wagerInclude,
    });

    // Deploy the escrow. Without a configured chain the wager stays a draft so the
    // social flow still works in local development.
    let deployment: { address: string; txHash: string } | null = null;
    if (isChainConfigured()) {
      deployment = await deployWager(wager.id, userId, {
        termsHash,
        stakeCents: body.stakeCents,
        bondCents,
        ownerSplitBps: body.ownerSplitBps ?? 0,
        thresholdBps,
        fundingDeadline,
        eventDeadline,
        resolutionDeadline,
        maxParticipants: body.maxParticipants,
        resolutionMethod: body.resolutionMethod,
        onchainGroupId: group?.onchainId ?? 0,
      });
    }

    if (body.invitePhones?.length) {
      await inviteToWager(wager.id, userId, body.invitePhones, body.proposition, body.stakeCents);
    }

    const fresh = await prisma.wager.findUniqueOrThrow({ where: { id: wager.id }, include: wagerInclude });
    res.status(201).json({ ok: true, wager: fresh, deployment });
  })
);

async function deployWager(
  wagerId: string,
  userId: string,
  terms: {
    termsHash: string;
    stakeCents: number;
    bondCents: number;
    ownerSplitBps: number;
    thresholdBps: number;
    fundingDeadline: Date;
    eventDeadline: Date;
    resolutionDeadline: Date;
    maxParticipants: number;
    resolutionMethod: "ATTESTATION" | "ORACLE";
    onchainGroupId: number;
  }
) {
  const params = {
    groupId: terms.onchainGroupId,
    termsHash: terms.termsHash,
    stake: centsToWei(terms.stakeCents),
    bond: centsToWei(terms.bondCents),
    ownerSplitBps: terms.ownerSplitBps,
    attestationThresholdBps: terms.thresholdBps,
    fundingDeadline: Math.floor(terms.fundingDeadline.getTime() / 1000),
    eventDeadline: Math.floor(terms.eventDeadline.getTime() / 1000),
    resolutionDeadline: Math.floor(terms.resolutionDeadline.getTime() / 1000),
    maxParticipants: terms.maxParticipants,
    resolutionMethod: terms.resolutionMethod === "ORACLE" ? 1 : 0,
  };

  const { hash, receipt } = await sendSponsored(userId, async (signer) =>
    getFactory(signer).createWager(params)
  );

  const factory = getFactory();
  const created = receipt!.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "WagerCreated");

  const address = created?.args?.wager as string | undefined;
  if (!address) throw new Error("WagerCreated event missing from the deploy receipt");

  await prisma.wager.update({
    where: { id: wagerId },
    data: { address, txHash: hash, status: "OPEN" },
  });

  return { address, txHash: hash };
}

// ------------------------------------------------------------------ reading

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const wagers = await prisma.wager.findMany({
      where: {
        OR: [
          { participants: { some: { userId: req.userId } } },
          { group: { members: { some: { userId: req.userId } } } },
        ],
      },
      include: wagerInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const mine = (w: (typeof wagers)[number]) => w.participants.find((p) => p.userId === req.userId);

    // The home screen groups by what the user has to do next (execution plan §17).
    res.json({
      ok: true,
      pending: wagers.filter((w) => w.status === "OPEN" && mine(w)?.state === "INVITED"),
      active: wagers.filter((w) => ["OPEN", "LOCKED"].includes(w.status) && mine(w)?.state === "JOINED"),
      needsAttention: wagers.filter(
        (w) => w.status === "LOCKED" && mine(w)?.state === "JOINED" && !mine(w)?.attestedAt && w.eventDeadline < new Date()
      ),
      recent: wagers.filter((w) => ["SETTLED", "REFUNDED", "CANCELLED"].includes(w.status)).slice(0, 20),
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const wager = await loadWager(req.params.id, req.userId!);
    const comments = await prisma.comment.findMany({
      where: { wagerId: wager.id },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    });

    let onchain = null;
    if (wager.address) {
      try {
        onchain = await readWagerState(wager.address);
      } catch (error) {
        console.warn(`Could not read on-chain state for ${wager.address}`, error);
      }
    }

    res.json({ ok: true, wager, comments, onchain });
  })
);

// ------------------------------------------------------------- participation

router.post(
  "/:id/join",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { side } = parseBody(z.object({ side: z.number().int().min(0).max(1) }), req);
    const userId = req.userId!;
    const wager = await loadWager(req.params.id, userId);

    if (wager.status !== "OPEN") throw conflict("This wager is no longer accepting participants");
    if (wager.fundingDeadline < new Date()) throw conflict("Funding has closed for this wager");

    const existing = wager.participants.find((p) => p.userId === userId);
    if (existing?.state === "JOINED") throw conflict("You have already joined this wager");

    const monthlyLimit = env.monthlyLimitCents;
    const committed = await monthlyVolumeCents(userId);
    if (committed + wager.stakeCents > monthlyLimit) {
      throw badRequest(`This would put you over your ${formatUsd(monthlyLimit)} monthly limit`);
    }

    const value = centsToWei(wager.stakeCents) + centsToWei(wager.bondCents);
    const { hash } = await sendSponsored(
      userId,
      async (signer) => getWager(wager.address!, signer).join(side, { value }),
      value
    );

    await prisma.wagerParticipant.upsert({
      where: { wagerId_userId: { wagerId: wager.id, userId } },
      update: { side, state: "JOINED", fundedAt: new Date(), fundedTxHash: hash },
      create: { wagerId: wager.id, userId, side, state: "JOINED", fundedAt: new Date(), fundedTxHash: hash },
    });

    await syncFromChain(wager.id);
    res.json({ ok: true, txHash: hash });
  })
);

router.post(
  "/:id/decline",
  asyncHandler(async (req: AuthedRequest, res) => {
    const wager = await loadWager(req.params.id, req.userId!);
    await prisma.wagerParticipant.updateMany({
      where: { wagerId: wager.id, userId: req.userId!, state: "INVITED" },
      data: { state: "DECLINED" },
    });
    res.json({ ok: true });
  })
);

const attestSchema = z.object({ winningSide: z.number().int().min(0).max(1) });

router.post(
  "/:id/attest",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { winningSide } = parseBody(attestSchema, req);
    const userId = req.userId!;
    const wager = await loadWager(req.params.id, userId);

    const me = wager.participants.find((p) => p.userId === userId);
    if (me?.state !== "JOINED") throw forbidden("Only participants can attest");
    if (me.attestedAt) throw conflict("You have already resolved this wager");

    const { hash } = await sendSponsored(userId, async (signer) =>
      getWager(wager.address!, signer).attest(winningSide)
    );

    await prisma.wagerParticipant.update({
      where: { wagerId_userId: { wagerId: wager.id, userId } },
      data: { attestedAt: new Date(), attestedChoice: winningSide },
    });

    const state = await syncFromChain(wager.id);
    res.json({ ok: true, txHash: hash, onchain: state });
  })
);

router.post(
  "/:id/concede",
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const wager = await loadWager(req.params.id, userId);

    const me = wager.participants.find((p) => p.userId === userId);
    if (me?.state !== "JOINED" || me.side === null) throw forbidden("Only participants can concede");
    if (me.attestedAt) throw conflict("You have already resolved this wager");

    const { hash } = await sendSponsored(userId, async (signer) => getWager(wager.address!, signer).concede());

    await prisma.wagerParticipant.update({
      where: { wagerId_userId: { wagerId: wager.id, userId } },
      data: { attestedAt: new Date(), attestedChoice: me.side === 0 ? 1 : 0, conceded: true },
    });

    const state = await syncFromChain(wager.id);
    res.json({ ok: true, txHash: hash, onchain: state });
  })
);

/// Claims whatever the escrow owes the caller — winnings, refunds and bonds.
router.post(
  "/:id/withdraw",
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const wager = await loadWager(req.params.id, userId);
    if (!wager.address) throw conflict("This wager is not on-chain yet");

    const address = await addressFor(userId);
    const credits: bigint = await getWager(wager.address).credits(address);
    if (credits === 0n) throw conflict("Nothing to withdraw");

    const { hash } = await sendSponsored(userId, async (signer) => getWager(wager.address!, signer).withdraw());
    res.json({ ok: true, txHash: hash, amountCents: weiToCents(credits) });
  })
);

// ------------------------------------------------------------------- social

router.post(
  "/:id/comments",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { body } = parseBody(z.object({ body: z.string().trim().min(1).max(500) }), req);
    const wager = await loadWager(req.params.id, req.userId!);
    const comment = await prisma.comment.create({
      data: { wagerId: wager.id, userId: req.userId!, body },
      include: { user: { select: { id: true, displayName: true } } },
    });
    res.status(201).json({ ok: true, comment });
  })
);

router.post(
  "/:id/invites",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { phones } = parseBody(z.object({ phones: z.array(z.string().min(7)).min(1).max(19) }), req);
    const wager = await loadWager(req.params.id, req.userId!);
    const invited = await inviteToWager(wager.id, req.userId!, phones, wager.proposition, wager.stakeCents);
    res.status(201).json({ ok: true, invited });
  })
);

/// The challenge itself is the invitation — a non-user gets a text with the terms
/// and a code that signs them in (execution plan §11).
async function inviteToWager(
  wagerId: string,
  inviterId: string,
  phones: string[],
  proposition: string,
  stakeCents: number
) {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
  const who = inviter?.displayName || "A friend";
  const invited: Array<{ phone: string; devCode?: string }> = [];

  for (const raw of phones) {
    const phone = normalizePhone(raw);
    if (!phone) continue;

    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, verified: false },
    });
    await prisma.wagerParticipant.upsert({
      where: { wagerId_userId: { wagerId, userId: user.id } },
      update: {},
      create: { wagerId, userId: user.id, state: "INVITED" },
    });

    const code = generateOtp();
    await prisma.invite.create({
      data: { phone, codeHash: hashOtp(phone, code), expiresAt: otpExpiry(), wagerId, invitedById: inviterId },
    });

    const result = await sendSms(
      phone,
      `${who} bet you ${formatUsd(stakeCents)}: ${proposition}. Take the other side — code ${code} — ${env.appUrl}/w/${wagerId}`
    );

    invited.push({ phone, ...(result.simulated && !env.isProduction ? { devCode: code } : {}) });
  }

  return invited;
}

// -------------------------------------------------------------------- sync

/// Pulls authoritative state from the escrow. The chain is the source of truth;
/// Postgres mirrors it so the app can query and rank without RPC calls.
export async function syncFromChain(wagerId: string) {
  const wager = await prisma.wager.findUniqueOrThrow({
    where: { id: wagerId },
    include: { participants: true },
  });
  if (!wager.address) return null;

  const state = await readWagerState(wager.address);
  const settled = state.status === "SETTLED";

  await prisma.wager.update({
    where: { id: wagerId },
    data: {
      status: state.status,
      winningSide: settled ? state.winningSide : null,
      settledAt: settled && !wager.settledAt ? new Date() : wager.settledAt,
    },
  });

  if (settled) {
    // Record each participant's net result so reputation and leaderboards can be
    // computed without touching the chain again.
    const joined = wager.participants.filter((p) => p.state === "JOINED");
    const winners = joined.filter((p) => p.side === state.winningSide);
    const potCents = wager.stakeCents * joined.length;
    const feeCents = Math.floor((potCents * wager.feeBps) / 10_000);
    const perWinner = winners.length ? Math.floor((potCents - feeCents) / winners.length) : 0;

    await Promise.all(
      joined.map((p) =>
        prisma.wagerParticipant.update({
          where: { id: p.id },
          data: { netCents: p.side === state.winningSide ? perWinner - wager.stakeCents : -wager.stakeCents },
        })
      )
    );
  }

  return state;
}

router.post(
  "/:id/sync",
  asyncHandler(async (req: AuthedRequest, res) => {
    await loadWager(req.params.id, req.userId!);
    const state = await syncFromChain(req.params.id);
    res.json({ ok: true, onchain: state });
  })
);

export default router;
