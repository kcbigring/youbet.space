import { env } from "../env";
import { ApiError } from "./errors";

/// Firebase is used as a phone-verification oracle, nothing more. Identity lives
/// in our own User table keyed on phone number, so swapping this out later costs
/// a migration of one column rather than a re-registration of every user.

let app: import("firebase-admin/app").App | null = null;

function getApp() {
  if (app) return app;

  const { initializeApp, cert, getApps } = require("firebase-admin/app");
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app!;
  }

  // A JSON service account in the environment, or Application Default
  // Credentials — which is what a GCP runtime provides automatically.
  if (env.firebaseServiceAccount) {
    let parsed: Record<string, unknown>;
    try {
      const raw = env.firebaseServiceAccount.trim().startsWith("{")
        ? env.firebaseServiceAccount
        : Buffer.from(env.firebaseServiceAccount, "base64").toString("utf8");
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(503, "FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64 JSON");
    }
    app = initializeApp({ credential: cert(parsed as any), projectId: env.firebaseProjectId });
  } else if (env.firebaseProjectId) {
    app = initializeApp({ projectId: env.firebaseProjectId });
  } else {
    throw new ApiError(503, "Firebase is not configured (set FIREBASE_PROJECT_ID)");
  }

  return app!;
}

export const firebaseEnabled = () => Boolean(env.firebaseProjectId || env.firebaseServiceAccount);

export interface VerifiedPhone {
  uid: string;
  phone: string;
}

/// Verifies a Firebase ID token and returns the phone number Google proved.
/// Rejects tokens without a phone claim: an unverified identity is worth nothing
/// to us here.
export async function verifyPhoneToken(idToken: string): Promise<VerifiedPhone> {
  const { getAuth } = require("firebase-admin/auth");

  let decoded: { uid: string; phone_number?: string };
  try {
    // checkRevoked is deliberately off. It turns a local signature check into a
    // call to the Identity Toolkit API, which needs credentials and IAM the
    // Cloud Run service account does not carry — and for a token that is
    // seconds old, revocation cannot meaningfully have happened yet.
    decoded = await getAuth(getApp()).verifyIdToken(idToken);
  } catch (error) {
    // Log the real reason. A bare 401 here is unactionable from the outside.
    console.error("Firebase token verification failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(401, `Could not verify that sign-in token: ${detail}`);
  }

  if (!decoded.phone_number) {
    throw new ApiError(400, "That sign-in did not include a verified phone number");
  }

  return { uid: decoded.uid, phone: decoded.phone_number };
}
