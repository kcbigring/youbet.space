import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { Banner } from "./Layout";

/// Mints an invite link and hands it to the OS share sheet, so the text arrives
/// from the inviter's own number. A message from a friend converts better than
/// one from a shortcode, and it keeps the platform out of app-to-person
/// messaging — and out of the carrier registration behind it.
export function ShareInvite({
  endpoint,
  label = "Invite a friend",
  shareTitle = "youbet.space",
}: {
  endpoint: string;
  label?: string;
  shareTitle?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ url: string; message: string; alreadyMember?: boolean }>(endpoint, {});
      if (res.alreadyMember) {
        setNotice("They are already in.");
        return;
      }
      setLink({ url: res.url, message: res.message });

      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: shareTitle, text: res.message });
          setNotice("Sent.");
          return;
        } catch {
          // The user dismissed the sheet, or the browser refused it. Fall
          // through to copy so there is always a way to send the invite.
        }
      }

      await navigator.clipboard?.writeText(res.message);
      setNotice("Copied — paste it into your messages.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create an invite link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button className="block" onClick={share} disabled={busy}>
        {busy ? "Creating link…" : label}
      </button>
      {notice && <Banner kind="info">{notice}</Banner>}
      <Banner>{error}</Banner>
      {link && (
        <div className="card">
          <div className="small muted">Anyone with this link can take the other side.</div>
          <div className="mono break small" style={{ marginTop: 6 }}>
            {link.url}
          </div>
        </div>
      )}
    </div>
  );
}
