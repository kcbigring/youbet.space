import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

/// Phone verification runs on Google Identity Platform: Google delivers the SMS,
/// so there is no carrier registration to wait on. It proves a phone number and
/// nothing more — identity itself lives in our own API.

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export const phoneVerificationAvailable = Boolean(config.apiKey && config.projectId);

function app(): FirebaseApp {
  if (!phoneVerificationAvailable) {
    throw new Error("Phone verification is not configured");
  }
  return getApps()[0] ?? initializeApp(config as Required<typeof config>);
}

let verifier: RecaptchaVerifier | null = null;

/// The invisible reCAPTCHA is Google's abuse control for phone auth. It must be
/// attached to a real element, and it can only be created once per page.
function recaptcha(containerId: string) {
  if (verifier) return verifier;
  verifier = new RecaptchaVerifier(getAuth(app()), containerId, { size: "invisible" });
  return verifier;
}

export async function sendVerificationCode(phone: string, containerId: string) {
  return signInWithPhoneNumber(getAuth(app()), phone, recaptcha(containerId));
}

/// Confirms the code and returns the ID token our API exchanges for a session.
export async function confirmVerificationCode(confirmation: ConfirmationResult, code: string) {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
}

export function resetVerifier() {
  verifier?.clear();
  verifier = null;
}

export type { ConfirmationResult };
