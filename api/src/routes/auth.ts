import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { sendSms } from "../twilio";
import { asyncHandler, parseBody } from "../lib/http";
import { badRequest, conflict, unauthorized } from "../lib/errors";
import {
  authenticate,
  consumeInviteLink,
  consumeOtp,
  createSession,
  generateOtp,
  hashOtp,
  normalizePhone,
  otpExpiry,
  type AuthedRequest,
} from "../lib/auth";
import { firebaseEnabled, verifyPhoneToken } from "../lib/firebase";

const router = Router();

/// OTP endpoints are the cheapest thing to abuse, so they are limited per IP.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Counts are shared across every route using this limiter, which would make
  // tests depend on how many auth requests ran before them.
  skip: () => env.nodeEnv === "test",
  message: { ok: false, error: "Too many verification requests. Try again shortly." },
});

const requestSchema = z.object({ phone: z.string().min(7) });
const verifySchema = z.object({
  phone: z.string().min(7),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  displayName: z.string().trim().min(1).max(60).optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  /// Set when someone followed an invite but already had an account: proving
  /// the phone is what lets them into it, and the invite still has to land.
  inviteToken: z.string().min(10).optional(),
});

router.post(
  "/request-code",
  otpLimiter,
  asyncHandler(async (req, res) => {
    const { phone: raw } = parseBody(requestSchema, req);
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("Enter a valid phone number, including country code");

    const code = generateOtp();
    await prisma.invite.create({
      data: { phone, codeHash: hashOtp(phone, code), expiresAt: otpExpiry() },
    });

    const result = await sendSms(phone, `${code} is your youbet.space code.`);

    res.json({
      ok: true,
      phone,
      // Never leak the code in production; in development it saves a round trip.
      ...(result.simulated && !env.isProduction ? { devCode: code } : {}),
    });
  })
);

router.post(
  "/verify",
  otpLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(verifySchema, req);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest("Enter a valid phone number, including country code");

    const result = await consumeOtp(phone, body.code);
    if (!result.ok) throw unauthorized(result.reason);

    const user = await prisma.user.upsert({
      where: { phone },
      update: {
        verified: true,
        ...(body.displayName ? { displayName: body.displayName } : {}),
        ...(body.walletAddress ? { walletAddress: body.walletAddress } : {}),
      },
      create: {
        phone,
        verified: true,
        displayName: body.displayName,
        walletAddress: body.walletAddress,
      },
    });

    // Honour whatever the invite was attached to, so an SMS invite lands the
    // user directly in the group or wager that brought them here.
    let { invite } = result;

    // A link invite followed by someone who already had an account: the claim
    // page turns them away rather than letting an unverified number into it, so
    // the invite rides along with the sign-in that does prove the number.
    if (body.inviteToken) {
      const link = await consumeInviteLink(body.inviteToken);
      if (link.ok) {
        invite = { ...invite, groupId: link.invite.groupId, wagerId: link.invite.wagerId };
        await prisma.invite.update({ where: { id: link.invite.id }, data: { usedAt: new Date() } });
      }
    }

    if (invite.groupId) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId: user.id } },
        update: {},
        create: { groupId: invite.groupId, userId: user.id },
      });
    }
    if (invite.wagerId) {
      await prisma.wagerParticipant.upsert({
        where: { wagerId_userId: { wagerId: invite.wagerId, userId: user.id } },
        update: {},
        create: { wagerId: invite.wagerId, userId: user.id },
      });
    }

    const session = await createSession(user.id);

    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, phone: user.phone, displayName: user.displayName, walletAddress: user.walletAddress },
      landing: { groupId: invite.groupId, wagerId: invite.wagerId },
    });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      include: { memberships: { include: { group: true } } },
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        displayName: user.displayName,
        handle: user.handle,
        walletAddress: user.walletAddress,
        groups: user.memberships.map((m) => ({ id: m.group.id, name: m.group.name, role: m.role })),
      },
    });
  })
);

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  handle: z.string().trim().regex(/^[a-z0-9_]{3,20}$/i).optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = parseBody(profileSchema, req);
    const user = await prisma.user.update({ where: { id: req.userId }, data: body });
    res.json({ ok: true, user: { id: user.id, displayName: user.displayName, handle: user.handle, walletAddress: user.walletAddress } });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const token = req.headers.authorization?.slice(7);
    if (token) await prisma.session.deleteMany({ where: { token } });
    res.json({ ok: true });
  })
);

/// Applies whatever a redeemed invite pointed at, so someone arriving from a
/// friend's text lands inside the group or wager rather than on an empty home.
async function applyInvite(
  userId: string,
  invite: { groupId: string | null; wagerId: string | null }
) {
  if (invite.groupId) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: invite.groupId, userId } },
      update: {},
      create: { groupId: invite.groupId, userId },
    });
  }
  if (invite.wagerId) {
    await prisma.wagerParticipant.upsert({
      where: { wagerId_userId: { wagerId: invite.wagerId, userId } },
      update: {},
      create: { wagerId: invite.wagerId, userId },
    });
  }
}

/// Preview an invite before signing in — the recipient should see what they were
/// challenged to before being asked for anything.
router.get(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    const result = await consumeInviteLink(req.params.token);
    if (!result.ok) throw badRequest(result.reason);

    const { invite } = result;
    res.json({
      ok: true,
      invite: {
        from: invite.invitedBy?.displayName ?? "A friend",
        group: invite.group,
        wager: invite.wager,
        expiresAt: invite.expiresAt,
      },
    });
  })
);

const claimSchema = z.object({
  token: z.string().min(10),
  displayName: z.string().trim().min(1).max(60),
  phone: z.string().min(7).optional(),
});

/// Claim an invite link. This signs the bearer in without proving the phone
/// number — the inviter vouched for them. Funding is gated separately on a
/// Firebase-verified phone once REQUIRE_VERIFIED_PHONE is on.
router.post(
  "/claim",
  otpLimiter,
  asyncHandler(async (req, res) => {
    const body = parseBody(claimSchema, req);
    const result = await consumeInviteLink(body.token);
    if (!result.ok) throw badRequest(result.reason);
    const { invite } = result;

    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (body.phone && !phone) throw badRequest("Enter a valid phone number, including country code");

    // An invite link proves someone was handed it. It proves nothing about a
    // phone number, so it must never be enough to enter an account that already
    // exists: this used to match on the typed number and hand back a session
    // for that user, which meant anyone holding a forwarded link could sign in
    // as whoever they claimed to be. A returning user signs in properly and
    // carries the invite through that.
    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) {
        throw conflict("That number already has an account. Sign in and the invite will follow you.");
      }
    }

    const user = await prisma.user.create({
      data: {
        phone: phone ?? `pending:${invite.linkToken}`,
        displayName: body.displayName,
        verified: true,
      },
    });

    await applyInvite(user.id, invite);
    await prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

    const session = await createSession(user.id);
    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, displayName: user.displayName, phoneVerified: user.phoneVerified },
      landing: { groupId: invite.groupId, wagerId: invite.wagerId },
    });
  })
);

const firebaseSchema = z.object({
  idToken: z.string().min(20),
  displayName: z.string().trim().min(1).max(60).optional(),
  inviteToken: z.string().min(10).optional(),
});

/// Sign in with a Firebase phone credential. Google proves the phone number, so
/// there is no code for us to generate, store or rate-limit.
router.post(
  "/firebase",
  otpLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!firebaseEnabled()) throw badRequest("Phone verification is not configured");
    const body = parseBody(firebaseSchema, req);
    const { uid, phone } = await verifyPhoneToken(body.idToken);

    // If this session already exists as a link-claimed user, upgrade that record
    // rather than stranding their history under a placeholder phone.
    const claimed = req.headers.authorization?.startsWith("Bearer ")
      ? await prisma.session.findUnique({ where: { token: req.headers.authorization.slice(7) } })
      : null;

    const byPhone = await prisma.user.findUnique({ where: { phone } });
    const target = byPhone ?? (claimed ? await prisma.user.findUnique({ where: { id: claimed.userId } }) : null);

    const user = target
      ? await prisma.user.update({
          where: { id: target.id },
          data: {
            phone,
            phoneVerified: true,
            verified: true,
            firebaseUid: uid,
            ...(body.displayName && !target.displayName ? { displayName: body.displayName } : {}),
          },
        })
      : await prisma.user.create({
          data: { phone, phoneVerified: true, verified: true, firebaseUid: uid, displayName: body.displayName },
        });

    let landing: { groupId: string | null; wagerId: string | null } = { groupId: null, wagerId: null };
    if (body.inviteToken) {
      const invite = await consumeInviteLink(body.inviteToken);
      if (invite.ok) {
        await applyInvite(user.id, invite.invite);
        await prisma.invite.update({ where: { id: invite.invite.id }, data: { usedAt: new Date() } });
        landing = { groupId: invite.invite.groupId, wagerId: invite.invite.wagerId };
      }
    }

    const session = await createSession(user.id);
    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, phone: user.phone, displayName: user.displayName, phoneVerified: true },
      landing,
    });
  })
);

const walletSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/// Records the smart-account address the user just connected. It is how on-chain
/// activity maps back to a person; we hold no key for it and cannot spend from it.
router.post(
  "/wallet",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { address } = parseBody(walletSchema, req);

    const claimed = await prisma.user.findUnique({ where: { walletAddress: address } });
    if (claimed && claimed.id !== req.userId) {
      throw conflict("That wallet is already linked to another account");
    }

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { walletAddress: address },
    });
    res.json({ ok: true, walletAddress: user.walletAddress });
  })
);

export default router;
