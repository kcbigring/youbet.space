import { useEffect, useState } from "react";
import Link from "next/link";
import { api, usd, ApiError } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import type { Group } from "../../lib/types";
import { Layout, Banner, Empty } from "../../components/Layout";

export default function Groups() {
  const { user, loading } = useSession();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ groups: Group[] }>("/groups")
      .then((res) => setGroups(res.groups))
      .catch((err) => setError(err.message));
  }, [user]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ group: Group }>("/groups", { name });
      setGroups((prev) => [res.group, ...prev]);
      setName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create that group");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <Layout>
        <div className="skeleton" />
      </Layout>
    );
  }

  return (
    <Layout title="Groups">
      <div className="between">
        <h1 style={{ margin: 0 }}>Your groups</h1>
        <button className="small subtle" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "New"}
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="name">Group name</label>
            <input
              id="name"
              autoFocus
              placeholder="Saturday Crew"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.length > 1 && create()}
            />
          </div>
          <button className="block" style={{ marginTop: 12 }} onClick={create} disabled={busy || name.length < 2}>
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      )}

      <Banner>{error}</Banner>

      <div style={{ marginTop: 16 }}>
        {groups.length === 0 && !creating && (
          <Empty>
            <p style={{ marginTop: 0 }}>No groups yet.</p>
            <p className="small">A group is a persistent set of friends you bet with.</p>
            <button onClick={() => setCreating(true)}>Create one</button>
          </Empty>
        )}

        {groups.map((group) => (
          <Link key={group.id} href={`/groups/${group.id}`} className="card card-link">
            <div className="between">
              <b>{group.name}</b>
              <span className="small muted">
                {group._count?.members ?? 0} members · {group._count?.wagers ?? 0} wagers
              </span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Up to {usd(group.maxStakeCents)} per person · {usd(group.maxPotCents)} pot
            </div>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
