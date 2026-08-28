import { useEffect, useState } from "react";
import Link from "next/link";
import { api, usd } from "../lib/api";
import { useSession } from "../lib/useSession";
import type { Wager, Reputation } from "../lib/types";
import { Layout, Empty, Banner } from "../components/Layout";
import { WagerCard } from "../components/WagerCard";

interface Feed {
  pending: Wager[];
  active: Wager[];
  needsAttention: Wager[];
  recent: Wager[];
}

export default function Home() {
  const { user, loading } = useSession();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [rep, setRep] = useState<Reputation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.get<Feed>("/wagers"), api.get<{ reputation: Reputation }>("/users/me/reputation")])
      .then(([f, r]) => {
        setFeed(f);
        setRep(r.reputation);
      })
      .catch((err) => setError(err.message));
  }, [user]);

  if (loading || !user) {
    return (
      <Layout>
        <div className="stack">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </Layout>
    );
  }

  const empty =
    feed && !feed.pending.length && !feed.active.length && !feed.needsAttention.length && !feed.recent.length;

  return (
    <Layout>
      <h1>Hey{user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}</h1>
      {rep && (
        <div className="stats" style={{ margin: "16px 0 4px" }}>
          <div className="stat">
            <b>
              {rep.wins}-{rep.losses}
            </b>
            <span>Record</span>
          </div>
          <div className="stat">
            <b className={rep.netCents >= 0 ? "pos" : "neg"}>
              {rep.netCents >= 0 ? "+" : ""}
              {usd(rep.netCents)}
            </b>
            <span>Net</span>
          </div>
          <div className="stat">
            <b>{rep.attestationRate == null ? "—" : `${rep.attestationRate}%`}</b>
            <span>Attestation</span>
          </div>
        </div>
      )}

      <Banner>{error}</Banner>

      {feed?.needsAttention.length ? (
        <>
          <h2>Waiting on you</h2>
          {feed.needsAttention.map((w) => (
            <WagerCard key={w.id} wager={w} userId={user.id} />
          ))}
        </>
      ) : null}

      {feed?.pending.length ? (
        <>
          <h2>Challenges for you</h2>
          {feed.pending.map((w) => (
            <WagerCard key={w.id} wager={w} userId={user.id} />
          ))}
        </>
      ) : null}

      {feed?.active.length ? (
        <>
          <h2>Active</h2>
          {feed.active.map((w) => (
            <WagerCard key={w.id} wager={w} userId={user.id} />
          ))}
        </>
      ) : null}

      {feed?.recent.length ? (
        <>
          <h2>Recent results</h2>
          {feed.recent.map((w) => (
            <WagerCard key={w.id} wager={w} userId={user.id} />
          ))}
        </>
      ) : null}

      {empty && (
        <Empty>
          <p style={{ marginTop: 0 }}>Nothing running yet.</p>
          <Link href="/create">
            <button>Start a challenge</button>
          </Link>
        </Empty>
      )}
    </Layout>
  );
}
