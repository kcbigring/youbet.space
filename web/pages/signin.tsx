import { useState } from "react";
import { useRouter } from "next/router";
import { api, setToken, ApiError } from "../lib/api";
import { Banner } from "../components/Layout";
import { Logo } from "../components/Logo";
import {
  confirmVerificationCode,
  phoneVerificationAvailable,
  resetVerifier,
  sendVerificationCode,
  type ConfirmationResult,
} from "../lib/firebase";

/// Firebase surfaces codes like `auth/invalid-phone-number`. Translate the ones
/// a user can act on, and pass anything else through rather than hiding it.
function friendlyAuthError(message: string): string {
  if (/invalid-phone-number/.test(message)) return "That phone number does not look right.";
  if (/too-many-requests/.test(message)) return "Too many attempts. Wait a few minutes and try again.";
  if (/invalid-verification-code/.test(message)) return "That code was not correct.";
  if (/code-expired/.test(message)) return "That code expired. Request a new one.";
  if (/quota-exceeded/.test(message)) return "Too many codes sent right now. Try again shortly.";
  if (/unsupported|region/i.test(message)) return "We cannot text that country yet.";
  if (/captcha/i.test(message)) return "Verification check failed. Reload the page and try again.";
  return message;
}

export default function SignIn() {
  const router = useRouter();
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      // Surface the real reason. Collapsing everything to "Something went wrong"
      // hid a Firebase region-policy error behind a message that said nothing.
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(message));
    } finally {
      setBusy(false);
    }
  }

  /// Google's Identity Platform delivers the SMS, so there is no carrier
  /// registration to wait on and nothing for us to send. The API's own one-time
  /// codes remain as the local-development path, where Firebase is not set up.
  const requestCode = () =>
    run(async () => {
      if (phoneVerificationAvailable) {
        const e164 = phone.trim().startsWith("+") ? phone.trim() : `+1${phone.replace(/\D/g, "")}`;
        try {
          setConfirmation(await sendVerificationCode(e164, "recaptcha-slot"));
          setPhone(e164);
          setStage("code");
          return;
        } catch (err) {
          // A failed attempt leaves the reCAPTCHA widget unusable.
          resetVerifier();
          throw err;
        }
      }

      const res = await api.post<{ phone: string; devCode?: string }>("/auth/request-code", { phone });
      setPhone(res.phone);
      setDevCode(res.devCode ?? null);
      setStage("code");
    });

  const verify = () =>
    run(async () => {
      // With Firebase, Google proves the number and hands us a token to exchange
      // for a session; there is no code for us to check.
      const res = confirmation
        ? await api.post<{ token: string; landing: { groupId?: string; wagerId?: string } }>("/auth/firebase", {
            idToken: await confirmVerificationCode(confirmation, code),
            displayName: name || undefined,
          })
        : await api.post<{ token: string; landing: { groupId?: string; wagerId?: string } }>("/auth/verify", {
            phone,
            code,
            displayName: name || undefined,
          });
      setToken(res.token);

      // An invite drops you straight into whatever brought you here.
      const next = typeof router.query.next === "string" ? router.query.next : "/";
      const destination = res.landing?.wagerId
        ? `/w/${res.landing.wagerId}`
        : res.landing?.groupId
          ? `/groups/${res.landing.groupId}`
          : next.startsWith("/signin")
            ? "/"
            : next;
      await router.replace(destination);
    });

  return (
    <div className="shell">
      <div style={{ paddingTop: 72, maxWidth: 380, margin: "0 auto" }}>
        <div style={{ marginBottom: 10 }}>
          <Logo size={30} />
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 32 }}>
          Private wagers between friends. Challenge, fund, resolve, settle.
        </p>

        {stage === "phone" ? (
          <div className="stack">
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(512) 555-1234"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && phone && requestCode()}
              />
            </div>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                autoComplete="name"
                placeholder="Kevin"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Banner>{error}</Banner>
            <button className="block" onClick={requestCode} disabled={busy || phone.length < 7}>
              {busy ? "Sending…" : "Send code"}
            </button>
            <p className="small muted center">
              We text you a 6-digit code. No passwords, no seed phrases.
            </p>
          </div>
        ) : (
          <div className="stack">
            <div className="field">
              <label htmlFor="code">Code sent to {phone}</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()}
              />
            </div>
            {devCode && <Banner kind="info">Development code: {devCode}</Banner>}
            <Banner>{error}</Banner>
            <button className="block" onClick={verify} disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              className="ghost block"
              onClick={() => {
                resetVerifier();
                setConfirmation(null);
                setStage("phone");
              }}
              disabled={busy}
            >
              Use a different number
            </button>
          </div>
        )}

        {/* The invisible reCAPTCHA needs a real element to attach to. */}
        <div id="recaptcha-slot" />
      </div>
    </div>
  );
}
