import { Router } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { sendSms } from "../twilio";
import { asyncHandler, parseBody } from "../lib/http";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { authenticate, createInviteLink, normalizePhone, type AuthedRequest } from "../lib/auth";
import { reputationFor } from "../lib/reputation";

const router = Router();
router.use(authenticate);

async function membershipOrThrow(groupId: string, userId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: { group: true },
  });
  if (!membership) throw notFound("Group not found");
  return membership;
}

async function ownerOrThrow(groupId: string, userId: string) {
  const membership = await membershipOrThrow(groupId, userId);
  if (membership.role !== "OWNER") throw forbidden("Only the group owner can do that");
  return membership;
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  maxStakeCents: z.number().int().positive().max(env.maxStakeCents).optional(),
  maxPotCents: z.number().int().positive().max(env.maxPotCents).optional(),
  monthlyLimitCents: z.number().int().positive().max(env.monthlyLimitCents).optional(),
  defaultBondCents: z.number().int().min(0).max(10_000).optional(),
  defaultThresholdBps: z.number().int().min(1).max(10_000).optional(),
  resolutionWindowHours: z.number().int().min(1).max(168).optional(),
});

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = parseBody(createSchema, req);
    const group = await prisma.group.create({
      data: {
        ...body,
        ownerId: req.userId!,
        members: { create: { userId: req.userId!, role: "OWNER" } },
      },
      include: { members: true },
    });
    res.status(201).json({ ok: true, group });
  })
);

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: req.userId } } },
      include: { _count: { select: { members: true, wagers: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, groups });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    await membershipOrThrow(req.params.id, req.userId!);
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        members: { include: { user: { select: { id: true, displayName: true, handle: true, phone: true } } } },
        wagers: {
          orderBy: { createdAt: "desc" },
          take: 25,
          include: { participants: { include: { user: { select: { id: true, displayName: true } } } } },
        },
      },
    });
    res.json({ ok: true, group });
  })
);

const limitsSchema = createSchema.omit({ name: true }).extend({
  name: z.string().trim().min(2).max(60).optional(),
  defaultResolution: z.enum(["ATTESTATION", "ORACLE"]).optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    await ownerOrThrow(req.params.id, req.userId!);
    const body = parseBody(limitsSchema, req);
    const group = await prisma.group.update({ where: { id: req.params.id }, data: body });
    res.json({ ok: true, group });
  })
);

const inviteSchema = z.object({
  // Optional: a link with no number attached works for the share sheet.
  phone: z.string().min(7).optional(),
  name: z.string().trim().max(60).optional(),
});

/// Mints a share link for the group. The inviter sends it themselves, so a
/// non-user goes from their friend's text straight into the group — no shortcode,
/// no carrier registration, and a far better first impression.
router.post(
  "/:id/invites",
  asyncHandler(async (req: AuthedRequest, res) => {
    const membership = await membershipOrThrow(req.params.id, req.userId!);
    const body = parseBody(inviteSchema, req);

    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (body.phone && !phone) throw badRequest("Enter a valid phone number, including country code");

    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) {
        const alreadyIn = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId: membership.groupId, userId: existing.id } },
        });
        if (alreadyIn) return res.json({ ok: true, alreadyMember: true });
      }
    }

    const { url } = await createInviteLink({
      invitedById: req.userId!,
      groupId: membership.groupId,
      phone,
    });

    const inviter = await prisma.user.findUnique({ where: { id: req.userId! } });
    const who = inviter?.displayName || "A friend";
    const message = `${who} added you to "${membership.group.name}" on youbet.space — ${url}`;

    if (phone && env.sendInviteSms) await sendSms(phone, message);

    res.status(201).json({ ok: true, phone, url, message });
  })
);

router.delete(
  "/:id/members/:userId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const membership = await ownerOrThrow(req.params.id, req.userId!);
    if (req.params.userId === membership.group.ownerId) throw badRequest("The owner cannot be removed");

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId: req.params.id, userId: req.params.userId } },
    });
    res.json({ ok: true });
  })
);

/// Leaderboard: record, net winnings and attestation rate for every member
/// (execution plan §7).
router.get(
  "/:id/leaderboard",
  asyncHandler(async (req: AuthedRequest, res) => {
    await membershipOrThrow(req.params.id, req.userId!);
    const members = await prisma.groupMember.findMany({
      where: { groupId: req.params.id },
      include: { user: { select: { id: true, displayName: true, handle: true } } },
    });

    const rows = await Promise.all(
      members.map(async (member) => ({
        user: member.user,
        role: member.role,
        ...(await reputationFor(member.userId, req.params.id)),
      }))
    );

    rows.sort((a, b) => b.netCents - a.netCents);
    res.json({ ok: true, leaderboard: rows });
  })
);

export default router;
