import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import prisma from "../prisma";
import { env } from "../env";
import { sendSms } from "../twilio";
import { asyncHandler, parseBody } from "../lib/http";
import { badRequest, unauthorized } from "../lib/errors";
import {
  authenticate,
  consumeOtp,
  createSession,
  generateOtp,
  hashOtp,
  normalizePhone,
  otpExpiry,
  type AuthedRequest,
} from "../lib/auth";

const router = Router();

/// OTP endpoints are the cheapest thing to abuse, so they are limited per IP.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many verification requests. Try again shortly." },
});

const requestSchema = z.object({ phone: z.string().min(7) });
const verifySchema = z.object({
  phone: z.string().min(7),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  displayName: z.string().trim().min(1).max(60).optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
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
    const { invite } = result;
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

export default router;
