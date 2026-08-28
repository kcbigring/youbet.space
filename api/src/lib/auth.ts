import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import prisma from "../prisma";
import { env } from "../env";
import { unauthorized } from "./errors";

export type AuthedRequest = Request & { userId?: string };

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/// Normalises to E.164, defaulting bare 10-digit input to +1. Anything else must
/// already carry a country code.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/// Codes are stored hashed so a database leak cannot be replayed as a login.
export const hashOtp = (phone: string, code: string) =>
  crypto.createHash("sha256").update(`${phone}:${code}:${env.adminApiKey || "youbet"}`).digest("hex");

export function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

/// Verifies a one-time code and burns it. Returns the invite so callers can honour
/// the group or wager it was attached to.
export async function consumeOtp(phone: string, code: string) {
  const invite = await prisma.invite.findFirst({
    where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!invite) return { ok: false as const, reason: "No pending code for this number" };
  if (invite.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false as const, reason: "Too many attempts. Request a new code." };
  }

  const expected = Buffer.from(invite.codeHash);
  const actual = Buffer.from(hashOtp(phone, code));
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    await prisma.invite.update({ where: { id: invite.id }, data: { attempts: { increment: 1 } } });
    return { ok: false as const, reason: "Invalid code" };
  }

  await prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
  return { ok: true as const, invite };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const custom = req.headers["x-session-token"];
  return typeof custom === "string" ? custom : null;
}

/// Rejects the request unless it carries a live session.
export async function authenticate(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (!token) throw unauthorized("Sign in required");

    const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) throw unauthorized("Session expired");

    req.userId = session.userId;
    next();
  } catch (error) {
    next(error);
  }
}

/// Guards operational endpoints (contract deploys, resolver management).
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!env.adminApiKey) return next(unauthorized("Admin API key is not configured"));
  const provided =
    (req.headers["x-api-key"] as string | undefined) ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);

  const expected = Buffer.from(env.adminApiKey);
  const actual = Buffer.from(provided || "");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) {
    return next(unauthorized());
  }
  next();
}
