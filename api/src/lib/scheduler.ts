import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { env } from "../env";
import { unauthorized } from "./errors";

/// Authenticates Cloud Scheduler by the identity Google signs for it, rather
/// than by a shared secret.
///
/// The Cloud Run service is public, so IAM does not gate these routes — the
/// check has to happen here. Scheduler sends an OIDC token; we verify Google's
/// signature, that the audience is this service, and that the caller is the
/// service account we expect. A leaked bearer token cannot be replayed past its
/// expiry, and there is no long-lived key to rotate.
///
/// The admin API key still works, so the job can be triggered by hand.

const client = new OAuth2Client();

async function callerEmail(token: string, audience: string): Promise<string | null> {
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    return payload?.email_verified ? (payload.email ?? null) : null;
  } catch {
    return null;
  }
}

export function requireScheduler(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const provided = (req.headers["x-api-key"] as string | undefined) ?? undefined;

  // Manual runs may still use the admin key.
  if (env.adminApiKey && provided && provided === env.adminApiKey) return next();

  if (!header?.startsWith("Bearer ")) return next(unauthorized("Scheduler identity required"));
  if (!env.schedulerServiceAccount) {
    return next(unauthorized("SCHEDULER_SERVICE_ACCOUNT is not configured"));
  }

  const audience = env.schedulerAudience || `${req.protocol}://${req.get("host")}`;

  callerEmail(header.slice(7), audience)
    .then((email) => {
      if (email && email === env.schedulerServiceAccount) return next();
      next(unauthorized("Not an authorised scheduler identity"));
    })
    .catch(() => next(unauthorized("Could not verify the scheduler identity")));
}
