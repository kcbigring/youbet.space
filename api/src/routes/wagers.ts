import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { sendSms } from "../twilio";
import { asyncHandler, parseBody } from "../lib/http";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { authenticate, createInviteLink, normalizePhone, type AuthedRequest } from "../lib/auth";
import { parseWager } from "../lib/parse";
import { centsToUnits, formatUsd, unitsToCents } from "../lib/money";
import { artifact, getBook, hashTerms, readWagerParticipants, readWagerState } from "../lib/chain";
import { ethers } from "ethers";
import { monthlyVolumeCents, reputationFor } from "../lib/reputation";
import { standingFor } from "../lib/standing";

const router = Router();
router.use(authenticate);

const HOUR = 60 * 60 * 1000;

const wagerInclude = {
  creator: { select: { id: true, displayName: true, handle: true } },
  group: { select: { id: true, name: true } },
  participants: {
    // The phone comes back so the client can show its last four digits. Two
    // friends called Mike need telling apart before anyone stakes money on
    // which of them is voting; the whole number is nobody else's business.
    include: { user: { select: { id: true, displayName: true, handle: true, phone: true } } },
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
  return redactPhones(wager);
}

type WithParticipants = { participants: Array<{ user: { phone: string } }> };

/// Replaces each participant's number with its last four digits.
///
/// Everyone in a wager needs to tell the others apart — two friends called Mike
/// have to be distinguishable before anyone stakes money on which of them
/// voted — but that is all it takes, and a full number belongs to its owner. An
/// account claimed by link has a `pending:` placeholder rather than a number,
/// which yields nothing.
export function redactPhones<T extends WithParticipants>(wager: T): T {
  return {
    ...wager,
    participants: wager.participants.map((p) => {
      const digits = (p.user.phone ?? "").replace(/\D/g, "");
      return { ...p, user: { ...p.user, phone: digits.length >= 4 ? digits.slice(-4) : null } };
    }),
  } as T;
}

// ------------------------------------------------------------------ create

router.post(
  "/parse",
  asyncHandler(async (req, res) => {
    const { text, tzOffsetMinutes } = parseBody(
      z.object({
        text: z.string().trim().min(3).max(500),
        /// The client's `getTimezoneOffset()`. "6am tomorrow" is 6am where the
        /// bettor is, and nothing on the server knows where that is.
        tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
      }),
      req
    );
    const parsed = await parseWager(text, new Date(), tzOffsetMinutes ?? 0);
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
  /// Hours after the outcome is known that everyone has to cast a vote. The
  /// contract caps this at seven days and refuses anything longer, so bound it
  /// here rather than letting the transaction revert.
  resolutionWindowHours: z.number().int().min(1).max(168).optional(),
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

    // Standing sets a personal ceiling at or below the protocol cap — a new
    // account starts low and earns its way up, rather than unlocking past it.
    const standing = standingFor(await reputationFor(userId));
    const maxStake = Math.min(
      env.maxStakeCents,
      standing.limits.maxStakeCents,
      group?.maxStakeCents ?? env.maxStakeCents
    );
    const maxPot = Math.min(env.maxPotCents, group?.maxPotCents ?? env.maxPotCents);
    const monthlyLimit = Math.min(env.monthlyLimitCents, group?.monthlyLimitCents ?? env.monthlyLimitCents);

    if (body.stakeCents > maxStake) {
      const personal = standing.limits.maxStakeCents < (group?.maxStakeCents ?? env.maxStakeCents);
      throw badRequest(
        personal
          ? `Your limit is ${formatUsd(maxStake)} a wager right now. Settle a few more and it goes up.`
          : `Stake is above the ${formatUsd(maxStake)} limit per person`
      );
    }

    const open = await prisma.wagerParticipant.count({
      where: { userId, state: "JOINED", wager: { status: { in: ["OPEN", "LOCKED"] } } },
    });
    if (open >= standing.limits.openWagers) {
      throw badRequest(
        `You have ${open} bets running, which is your limit for now. Settle some and this opens up.`
      );
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

    const windowHours = body.resolutionWindowHours ?? group?.resolutionWindowHours ?? 72;
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

    // The creator deploys the escrow from their own smart account, so the
    // contract's `creator` is them and the owner fee split reaches them
    // directly. The API never signs on a user's behalf.
    if (body.invitePhones?.length) {
      await inviteToWager(wager.id, userId, body.invitePhones, body.proposition, body.stakeCents);
    }

    const fresh = await prisma.wager.findUniqueOrThrow({ where: { id: wager.id }, include: wagerInclude });
    res.status(201).json({
      ok: true,
      wager: fresh,
      // Everything the client needs to deploy it, matching WagerFactory.CreateParams.
      deploy: {
        book: env.wagerBookAddress ?? null,
        params: {
          groupId: String(group?.onchainId ?? 0),
          termsHash,
          stake: centsToUnits(body.stakeCents).toString(),
          bond: centsToUnits(bondCents).toString(),
          ownerSplitBps: body.ownerSplitBps ?? 0,
          attestationThresholdBps: thresholdBps,
          fundingDeadline: Math.floor(fundingDeadline.getTime() / 1000),
          eventDeadline: Math.floor(eventDeadline.getTime() / 1000),
          resolutionDeadline: Math.floor(resolutionDeadline.getTime() / 1000),
          maxParticipants: body.maxParticipants,
          resolutionMethod: body.resolutionMethod === "ORACLE" ? 1 : 0,
        },
      },
    });
  })
);

// ------------------------------------------------------------------ reading

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const raw = await prisma.wager.findMany({
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

    const wagers = raw.map(redactPhones);
    const mine = (w: (typeof wagers)[number]) => w.participants.find((p) => p.userId === req.userId);

    // The home screen groups by what the user has to do next (execution plan §17).
    res.json({
      ok: true,
      drafts: wagers.filter((w) => w.status === "DRAFT" && w.creatorId === req.userId),
      pending: wagers.filter((w) => w.status === "OPEN" && mine(w)?.state === "INVITED"),
      active: wagers.filter((w) => ["OPEN", "LOCKED"].includes(w.status) && mine(w)?.state === "JOINED"),
      needsAttention: wagers.filter(
        (w) => w.status === "LOCKED" && mine(w)?.state === "JOINED" && !mine(w)?.attestedAt && w.eventDeadline < new Date()
      ),
      recent: wagers.filter((w) => ["SETTLED", "REFUNDED", "CANCELLED"].includes(w.status)).slice(0, 20),
    });
  })
);

/// The newest wager id this user's account created, read back from the book
/// after a create transaction. Scoped to the caller's own wallet, so it cannot
/// be used to enumerate anyone else's wagers.
router.get(
  "/latest-onchain-id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    if (!me.walletAddress) throw badRequest("Connect a wallet first");

    const ids: bigint[] = await getBook().getWagersByCreator(me.walletAddress);
    if (!ids.length) throw notFound("No wager found for this account yet");

    res.json({ ok: true, onchainId: Number(ids[ids.length - 1]) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    let wager = await loadWager(req.params.id, req.userId!);
    const comments = await prisma.comment.findMany({
      where: { wagerId: wager.id },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
    });

    let onchain = null;
    if (wager.onchainId) {
      try {
        // Reconcile on read, rather than trusting the client to have told us.
        //
        // A join is a transaction the user sends and we then hear about: the
        // browser posts to /sync once the batch lands, which can be a minute
        // or two later. Close the tab, lose signal, or simply navigate away in
        // that window and the stake sits in escrow while the app still shows
        // the wager as unfunded — and offers to join it again. The chain is the
        // authority on who paid, so ask it every time someone looks.
        onchain = await syncFromChain(wager.id);
        wager = await loadWager(req.params.id, req.userId!);
      } catch (error) {
        console.warn(`Could not read on-chain state for wager ${wager.onchainId}`, error);
      }
    }

    res.json({ ok: true, wager, comments, onchain });
  })
);

// ------------------------------------------------------------- participation
//
// Joining, attesting, conceding and withdrawing are all transactions the user
// signs with their passkey and sends from their own smart account. The API does
// not sign for anyone, so these endpoints record intent and then reconcile
// against the chain, which is the only authority on who funded what.

const linkSchema = z.object({
  onchainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
});

/// Finds a wager this creator already put on-chain for these exact terms.
///
/// A create transaction that lands while the follow-up link call is lost —
/// the tab closed, the network dropped, the read raced inclusion — leaves an
/// escrow on-chain and a draft off-chain with nothing joining them. Publishing
/// again would open a second escrow and charge a second sponsored transaction,
/// so the publish path looks for the orphan first.
export async function orphanedOnchainId(
  termsHash: string | null,
  creatorAddress: string | null
): Promise<number | null> {
  if (!termsHash || !creatorAddress || !env.wagerBookAddress) return null;

  const book = getBook();
  const ids: bigint[] = await book.getWagersByCreator(creatorAddress);
  // Newest first: a retry is far likelier to be reclaiming its own last attempt.
  for (const id of [...ids].reverse()) {
    const onchain = await book.getWager(id);
    if (onchain.termsHash.toLowerCase() !== termsHash.toLowerCase()) continue;
    // Identical terms hash to the millisecond is vanishingly unlikely across
    // two drafts, but linking the wrong escrow would be unrecoverable, so
    // never hand back one that already belongs to something.
    const taken = await prisma.wager.findUnique({ where: { onchainId: Number(id) } });
    if (!taken) return Number(id);
  }
  return null;
}

/// The on-chain parameters for a draft, so a wager created before the creator
/// had a wallet can still be put on-chain rather than being stranded.
router.get(
  "/:id/deploy-params",
  asyncHandler(async (req: AuthedRequest, res) => {
    const wager = await loadWager(req.params.id, req.userId!);
    if (wager.creatorId !== req.userId) throw forbidden("Only the creator can publish this");
    if (wager.onchainId) throw conflict("This wager is already on-chain");

    const group = wager.groupId
      ? await prisma.group.findUnique({ where: { id: wager.groupId } })
      : null;

    const creator = await prisma.user.findUniqueOrThrow({ where: { id: wager.creatorId } });

    res.json({
      ok: true,
      book: env.wagerBookAddress ?? null,
      /// Set when this draft's escrow already exists on-chain. The client
      /// should link it rather than send a second create.
      existingOnchainId: await orphanedOnchainId(wager.termsHash, creator.walletAddress).catch(
        () => null
      ),
      params: {
        groupId: String(group?.onchainId ?? 0),
        termsHash: wager.termsHash,
        stake: centsToUnits(wager.stakeCents).toString(),
        bond: centsToUnits(wager.bondCents).toString(),
        ownerSplitBps: wager.ownerSplitBps,
        attestationThresholdBps: wager.thresholdBps,
        fundingDeadline: Math.floor(wager.fundingDeadline.getTime() / 1000),
        eventDeadline: Math.floor(wager.eventDeadline.getTime() / 1000),
        resolutionDeadline: Math.floor(wager.resolutionDeadline.getTime() / 1000),
        maxParticipants: wager.participants.length > 2 ? wager.participants.length : 2,
        resolutionMethod: wager.resolutionMethod === "ORACLE" ? 1 : 0,
      },
    });
  })
);

/// Links an on-chain wager id to its off-chain record. Verifies the terms and
/// creator recorded on-chain match ours, so a client cannot point its wager at
/// someone else's escrow.
router.post(
  "/:id/link",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = parseBody(linkSchema, req);
    const wager = await loadWager(req.params.id, req.userId!);

    if (wager.creatorId !== req.userId) throw forbidden("Only the creator can link the escrow");
    if (wager.onchainId) throw conflict("This wager is already on-chain");

    const onchain = await getBook().getWager(body.onchainId);
    if (wager.termsHash && onchain.termsHash.toLowerCase() !== wager.termsHash.toLowerCase()) {
      throw badRequest("The on-chain terms do not match this wager");
    }

    const creator = await prisma.user.findUniqueOrThrow({ where: { id: wager.creatorId } });
    if (creator.walletAddress && onchain.creator.toLowerCase() !== creator.walletAddress.toLowerCase()) {
      throw badRequest("That wager was created by a different account");
    }

    await prisma.wager.update({
      where: { id: wager.id },
      data: { onchainId: body.onchainId, txHash: body.txHash, status: "OPEN" },
    });

    const state = await syncFromChain(wager.id);
    res.json({ ok: true, onchainId: body.onchainId, onchain: state });
  })
);

const sideSchema = z.object({ side: z.number().int().min(0).max(1) });

export const wagerInviteSchema = z.object({
  // Optional: a link with no number attached is what the share sheet sends.
  phone: z.string().min(7).optional(),
});

/// Records the side a user intends to take and returns the exact call for their
/// wallet to send. Nothing is committed until the chain says so.
router.post(
  "/:id/join",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { side } = parseBody(sideSchema, req);
    const userId = req.userId!;
    const wager = await loadWager(req.params.id, userId);

    if (wager.status !== "OPEN") throw conflict("This wager is no longer accepting participants");
    if (wager.fundingDeadline < new Date()) throw conflict("Funding has closed for this wager");
    if (!wager.onchainId) throw conflict("This wager is not on-chain yet");

    const existing = wager.participants.find((p) => p.userId === userId);
    if (existing?.state === "JOINED") throw conflict("You have already joined this wager");

    // Real money requires a proven phone. Off while the alpha runs on test funds.
    if (env.requireVerifiedPhone) {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!me.phoneVerified) throw forbidden("Verify your phone number before funding a wager");
    }

    const standing = standingFor(await reputationFor(userId));
    if (wager.stakeCents > standing.limits.maxStakeCents) {
      throw badRequest(
        `This bet is above your ${formatUsd(standing.limits.maxStakeCents)} limit right now. Settle a few more and it goes up.`
      );
    }

    const open = await prisma.wagerParticipant.count({
      where: { userId, state: "JOINED", wager: { status: { in: ["OPEN", "LOCKED"] } } },
    });
    if (open >= standing.limits.openWagers) {
      throw badRequest(`You have ${open} bets running, which is your limit for now.`);
    }

    const committed = await monthlyVolumeCents(userId);
    if (committed + wager.stakeCents > env.monthlyLimitCents) {
      throw badRequest(`This would put you over your ${formatUsd(env.monthlyLimitCents)} monthly limit`);
    }

    await prisma.wagerParticipant.upsert({
      where: { wagerId_userId: { wagerId: wager.id, userId } },
      update: { side },
      create: { wagerId: wager.id, userId, side, state: "INVITED" },
    });

    res.json({ ok: true, calls: joinCalls(wager.onchainId, side, wager.stakeCents, wager.bondCents) });
  })
);

/// Approving the stake and joining, as one batch. EIP-5792 lets the wallet send
/// both in a single request, so an ERC-20 stake still costs the user one prompt
/// rather than the two that approve-then-transfer normally implies.
function joinCalls(onchainId: number, side: number, stakeCents: number, bondCents: number) {
  const book = new ethers.Interface(artifact("WagerBook").abi);
  const token = new ethers.Interface(artifact("PlayDollar").abi);
  const owed = centsToUnits(stakeCents) + centsToUnits(bondCents);

  return [
    {
      to: env.stakeTokenAddress,
      data: token.encodeFunctionData("approve", [env.wagerBookAddress, owed]),
    },
    {
      to: env.wagerBookAddress,
      data: book.encodeFunctionData("join", [onchainId, side]),
    },
  ];
}

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

/// Mints a share link for a wager. Mirrors the group endpoint exactly, because
/// one component renders both: a bare `{}` means an open link for the share
/// sheet, and a phone additionally reserves that person a seat.
router.post(
  "/:id/invites",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = parseBody(wagerInviteSchema, req);
    const wager = await loadWager(req.params.id, req.userId!);

    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (body.phone && !phone) throw badRequest("Enter a valid phone number, including country code");

    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      const already = existing
        ? await prisma.wagerParticipant.findUnique({
            where: { wagerId_userId: { wagerId: wager.id, userId: existing.id } },
          })
        : null;
      if (already?.state === "JOINED") return res.json({ ok: true, alreadyMember: true });
    }

    const [invited] = await inviteToWager(
      wager.id,
      req.userId!,
      phone ? [phone] : [],
      wager.proposition,
      wager.stakeCents
    );
    res.status(201).json({ ok: true, ...invited });
  })
);

/// The challenge itself is the invitation. We mint a link and hand it back so
/// the inviter sends it from their own phone — a text from a friend converts
/// better than one from a shortcode, and it keeps us out of app-to-person
/// messaging entirely (execution plan §11).
async function inviteToWager(
  wagerId: string,
  inviterId: string,
  phones: string[],
  proposition: string,
  stakeCents: number
) {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
  const who = inviter?.displayName || "A friend";
  const invited: Array<{ phone: string | null; url: string; message: string }> = [];

  // A wager invite can be addressed to a number or left open for anyone with
  // the link, which is what the share sheet uses.
  const targets = phones.length ? phones : [""];

  for (const raw of targets) {
    const phone = raw ? normalizePhone(raw) : null;
    if (raw && !phone) continue;

    if (phone) {
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
    }

    const { url } = await createInviteLink({ invitedById: inviterId, wagerId, phone });
    const message = `${who} bet you ${formatUsd(stakeCents)}: ${proposition}. Take the other side — ${url}`;

    // Optional courtesy send; nothing depends on it and it is off by default.
    if (phone && env.sendInviteSms) await sendSms(phone, message);

    invited.push({ phone, url, message });
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
  if (!wager.onchainId) return null;

  const state = await readWagerState(String(wager.onchainId));
  const settled = state.status === "SETTLED";

  // Reconcile participation from the chain. A client reporting "I joined" proves
  // nothing; the escrow holding their stake does.
  const onchain = await readWagerParticipants(String(wager.onchainId));
  for (const entry of onchain) {
    const user = await prisma.user.findFirst({
      where: { walletAddress: { equals: entry.address, mode: "insensitive" } },
    });
    if (!user) continue;

    // Someone reconciled from an INVITED row still funded at some point; the
    // record we already hold is the better timestamp, but never leave it empty
    // on a participant the escrow says has paid.
    const known = wager.participants.find((p) => p.userId === user.id);

    await prisma.wagerParticipant.upsert({
      where: { wagerId_userId: { wagerId, userId: user.id } },
      update: {
        side: entry.side,
        state: "JOINED",
        fundedAt: known?.fundedAt ?? new Date(),
        conceded: entry.conceded,
        ...(entry.hasResolved ? { attestedAt: new Date(), attestedChoice: entry.resolutionChoice } : {}),
      },
      create: {
        wagerId,
        userId: user.id,
        side: entry.side,
        state: "JOINED",
        fundedAt: new Date(),
        conceded: entry.conceded,
        ...(entry.hasResolved ? { attestedAt: new Date(), attestedChoice: entry.resolutionChoice } : {}),
      },
    });
  }

  await prisma.wager.update({
    where: { id: wagerId },
    data: {
      // NONE means the id does not exist on-chain; leave the record alone.
      status: state.status === "NONE" ? wager.status : state.status,
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

/// Asks the chain what really happened, after the client sent a transaction.
///
/// A failure here is not a failed action: the transaction has already landed,
/// and the record catches up on the next read either way. Reporting it as an
/// error told someone their bet had broken when the escrow already held their
/// money, so an unreadable chain returns what we have instead.
router.post(
  "/:id/sync",
  asyncHandler(async (req: AuthedRequest, res) => {
    const wager = await loadWager(req.params.id, req.userId!);
    try {
      res.json({ ok: true, onchain: await syncFromChain(req.params.id) });
    } catch (error) {
      console.warn(`Could not reconcile wager ${wager.onchainId} from chain`, error);
      res.json({ ok: true, onchain: null, stale: true });
    }
  })
);

export default router;
