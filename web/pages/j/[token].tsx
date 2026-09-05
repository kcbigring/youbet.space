import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, setToken, usd, ApiError } from "../../lib/api";
import { Banner } from "../../components/Layout";

interface InvitePreview {
  from: string;
  group: { id: string; name: string } | null;
  wager: {
    id: string;
    proposition: string;
    stakeCents: number;
    sideLabels: string[];
    status: string;
  } | null;
  expiresAt: string;
}

/// The landing page for a challenge a friend texted you. It shows what you were
/// challenged to before asking for anything — the invite is the acquisition
/// channel, so a verification wall here is where the funnel leaks.
export default function JoinByLink() {
  const router = useRouter();
  const { token } = router.query;

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof token !== "string") return;
    api
      .get<{ invite: InvitePreview }>(`/auth/invite/${token}`)
      .then((res) => setInvite(res.invite))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this invite"));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{
        token: string;
        landing: { groupId: string | null; wagerId: string | null };
      }>("/auth/claim", { token, displayName: name });

      setToken(res.token);
      const destination = res.landing.wagerId
        ? `/w/${res.landing.wagerId}`
        : res.landing.groupId
          ? `/groups/${res.landing.groupId}`
          : "/";
      await router.replace(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept that invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div style={{ paddingTop: 56, maxWidth: 400, margin: "0 auto" }}>
        <div className="brand" style={{ fontSize: 22, marginBottom: 28 }}>
          youbet<span>.space</span>
        </div>

        {!invite && !error && <div className="skeleton" style={{ height: 140 }} />}
        {error && !invite && <Banner>{error}</Banner>}

        {invite && (
          <>
            {invite.wager ? (
              <div className="card">
                <div className="small muted">{invite.from} bet you</div>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: "2px 0 10px" }}>
                  {usd(invite.wager.stakeCents)}
                </div>
                <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{invite.wager.proposition}</div>
                <div className="divider" style={{ margin: "14px 0" }} />
                <div className="small muted">You would be taking:</div>
                <div style={{ marginTop: 4 }}>{invite.wager.sideLabels[1]}</div>
              </div>
            ) : (
              <div className="card">
                <div className="small muted">{invite.from} added you to</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{invite.group?.name}</div>
              </div>
            )}

            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                autoFocus
                placeholder="Fred"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Banner>{error}</Banner>

            <button className="block" style={{ marginTop: 14 }} onClick={accept} disabled={busy || name.length < 1}>
              {busy ? "One moment…" : invite.wager ? "Take the bet" : "Join the group"}
            </button>

            {/* No phone is asked for here: the link is the credential, and a
                number nobody has proven is not one. Someone who already has an
                account proves theirs the usual way, and the invite follows. */}
            <p className="small muted center" style={{ marginTop: 14 }}>
              Already have an account?{" "}
              <a href={`/signin?invite=${encodeURIComponent(String(token))}`}>Sign in instead</a>
            </p>

            <p className="small muted center" style={{ marginTop: 14 }}>
              No password, no seed phrase. We create your wallet for you.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
