import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Banner } from "./Layout";

/// Where reminders go.
///
/// The app sends no SMS and has no push, so an address is the only way anyone
/// hears that their bond is about to be forfeited. That makes this less of a
/// setting than a condition of the bond being fair — a forfeit nobody was
/// warned about is a trap, not a nudge.
///
/// Clearing the address is how someone turns reminders off, which is why the
/// button says what it does rather than hiding behind a toggle.
export function EmailReminders({
  current,
  onSaved,
  heading = "Where should reminders go?",
  compact = false,
}: {
  current: string | null;
  onSaved?: (email: string | null) => void;
  heading?: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState(current ?? "");
  const [saved, setSaved] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(current ?? "");
    setSaved(current);
  }, [current]);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.patch<{ user: { email: string | null } }>("/auth/me", { email: value });
      setSaved(value);
      onSaved?.(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  const changed = email.trim() !== (saved ?? "");

  return (
    <div className={compact ? "card" : undefined}>
      <b>{heading}</b>
      <p className="small muted" style={{ margin: "6px 0 12px" }}>
        {saved
          ? "We will tell you when a bet needs your call, and again before your bond is at risk."
          : "Without one, nothing tells you a bet needs settling — and an unanswered bet costs you your bond."}
      </p>

      <div className="share-link">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email for reminders"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="subtle small"
          disabled={busy || !changed || !email.includes("@")}
          onClick={() => save(email.trim())}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {saved && !changed && (
        <button
          className="ghost block small"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => {
            setEmail("");
            save(null);
          }}
        >
          Stop emailing me
        </button>
      )}

      <Banner>{error}</Banner>
    </div>
  );
}
