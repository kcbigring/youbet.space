import { useState } from "react";
import { useRouter } from "next/router";
import { api, setToken, ApiError } from "../lib/api";
import { Banner } from "../components/Layout";

export default function SignIn() {
  const router = useRouter();
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const requestCode = () =>
    run(async () => {
      const res = await api.post<{ phone: string; devCode?: string }>("/auth/request-code", { phone });
      setPhone(res.phone);
      setDevCode(res.devCode ?? null);
      setStage("code");
    });

  const verify = () =>
    run(async () => {
      const res = await api.post<{ token: string; landing: { groupId?: string; wagerId?: string } }>(
        "/auth/verify",
        { phone, code, displayName: name || undefined }
      );
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
        <div className="brand" style={{ fontSize: 28, marginBottom: 8 }}>
          youbet<span>.space</span>
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
            <button className="ghost block" onClick={() => setStage("phone")} disabled={busy}>
              Use a different number
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
