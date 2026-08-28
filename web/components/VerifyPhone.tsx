import { useState } from "react";
import { api, ApiError, setToken } from "../lib/api";
import {
  confirmVerificationCode,
  phoneVerificationAvailable,
  resetVerifier,
  sendVerificationCode,
  type ConfirmationResult,
} from "../lib/firebase";
import { Banner } from "./Layout";

/// Verification is deliberately not the front door. People arrive through a
/// friend's link and start playing; this is what they do before real money is
/// on the line.
export function VerifyPhone({ onVerified }: { onVerified?: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!phoneVerificationAvailable) {
    return <Banner>Phone verification is not configured for this environment.</Banner>;
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const e164 = phone.trim().startsWith("+") ? phone.trim() : `+1${phone.replace(/\D/g, "")}`;
      setConfirmation(await sendVerificationCode(e164, "recaptcha-slot"));
    } catch (err) {
      resetVerifier();
      setError(err instanceof Error ? err.message : "Could not send that code");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await confirmVerificationCode(confirmation, code);
      // Exchange Google's proof of the phone number for one of our sessions.
      const res = await api.post<{ token: string }>("/auth/firebase", { idToken });
      setToken(res.token);
      setDone(true);
      onVerified?.();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "That code did not work");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Banner kind="info">Phone verified.</Banner>;

  return (
    <div className="stack">
      {!confirmation ? (
        <>
          <div className="field">
            <label htmlFor="verify-phone">Phone number</label>
            <input
              id="verify-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(512) 555-1234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <button onClick={send} disabled={busy || phone.length < 7}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="verify-code">Code sent to {phone}</label>
            <input
              id="verify-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <button onClick={confirm} disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify"}
          </button>
        </>
      )}
      <Banner>{error}</Banner>
      {/* RecaptchaVerifier needs a real element to attach its invisible widget. */}
      <div id="recaptcha-slot" />
    </div>
  );
}
