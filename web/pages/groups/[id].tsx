import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, usd, ApiError } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import type { Group, Wager, User, Reputation } from "../../lib/types";
import { Layout, Banner, Avatar, Empty } from "../../components/Layout";
import { ShareInvite } from "../../components/ShareInvite";
import { WagerCard } from "../../components/WagerCard";

interface GroupDetail extends Group {
  members: Array<{ id: string; role: string; userId: string; user: User }>;
  wagers: Wager[];
}

type LeaderboardRow = Reputation & { user: User; role: string };

export default function GroupPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useSession();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"wagers" | "leaderboard" | "members">("wagers");

  const load = useCallback(async () => {
    if (typeof id !== "string") return;
    try {
      const [g, l] = await Promise.all([
        api.get<{ group: GroupDetail }>(`/groups/${id}`),
        api.get<{ leaderboard: LeaderboardRow[] }>(`/groups/${id}/leaderboard`),
      ]);
      setGroup(g.group);
      setBoard(l.leaderboard);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this group");
    }
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user || !group) {
    return (
      <Layout>
        <Banner>{error}</Banner>
        <div className="skeleton" />
      </Layout>
    );
  }

  const isOwner = group.ownerId === user.id;

  return (
    <Layout title="Group">
      <h1 style={{ marginBottom: 2 }}>{group.name}</h1>
      <p className="muted small" style={{ marginTop: 0 }}>
        {group.members.length} members · up to {usd(group.maxStakeCents)} per person ·{" "}
        {group.resolutionWindowHours}h to resolve
      </p>

      <div className="row" style={{ margin: "16px 0 4px" }}>
        {(["wagers", "leaderboard", "members"] as const).map((key) => (
          <button
            key={key}
            className={tab === key ? "small" : "small ghost"}
            onClick={() => setTab(key)}
            style={{ textTransform: "capitalize" }}
          >
            {key}
          </button>
        ))}
      </div>

      <Banner>{error}</Banner>

      {tab === "wagers" && (
        <div style={{ marginTop: 12 }}>
          {group.wagers.length === 0 ? (
            <Empty>No wagers in this group yet.</Empty>
          ) : (
            group.wagers.map((w) => <WagerCard key={w.id} wager={w} userId={user.id} />)
          )}
        </div>
      )}

      {tab === "leaderboard" && (
        <div style={{ marginTop: 12 }}>
          {board.every((row) => row.challenges === 0) ? (
            <Empty>Settle a few wagers and the standings will fill in.</Empty>
          ) : (
            board.map((row) => (
              <div key={row.user.id} className="card">
                <div className="between">
                  <div className="row">
                    <Avatar name={row.user.displayName} />
                    <div>
                      <div>
                        <b>{row.user.displayName || "Friend"}</b>
                        {row.user.id === user.id && <span className="small muted"> · you</span>}
                      </div>
                      <div className="small muted">
                        {row.challenges} challenges · {row.wins}-{row.losses} ·{" "}
                        {row.attestationRate == null ? "—" : `${row.attestationRate}%`} attestation
                      </div>
                    </div>
                  </div>
                  <b className={row.netCents >= 0 ? "pos" : "neg"}>
                    {row.netCents >= 0 ? "+" : ""}
                    {usd(row.netCents)}
                  </b>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "members" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 20 }}>
            <ShareInvite
              endpoint={`/groups/${group.id}/invites`}
              shareTitle={group.name}
              heading={`Invite people to ${group.name}`}
            />
          </div>

          {group.members.map((member) => (
            <div key={member.id} className="card">
              <div className="between">
                <div className="row">
                  <Avatar name={member.user.displayName} />
                  <div>
                    <div>{member.user.displayName || member.user.phone || "Friend"}</div>
                    <div className="small muted">{member.role.toLowerCase()}</div>
                  </div>
                </div>
                {isOwner && member.userId !== group.ownerId && (
                  <button
                    className="small danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.del(`/groups/${group.id}/members/${member.userId}`);
                        await load();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Could not remove them");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
