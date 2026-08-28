import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, usd, ApiError } from "../lib/api";
import { useSession } from "../lib/useSession";
import type { Group, ParsedWager, Wager } from "../lib/types";
import { Layout, Banner } from "../components/Layout";

const EXAMPLES = [
  "$25 each that Texas beats Ohio State",
  "I'll bet Fred and Mike $50 each that I break 90 on Saturday",
  "$10 that it rains tomorrow",
];

function toLocalInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 3 * 86_400_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function Create() {
  const router = useRouter();
  const { user, loading } = useSession();

  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedWager | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reviewable terms — the model proposes, the user confirms (execution plan §12).
  const [proposition, setProposition] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [stake, setStake] = useState("25");
  const [side, setSide] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [deadline, setDeadline] = useState(toLocalInput(null));
  const [phones, setPhones] = useState("");

  useEffect(() => {
    if (!user) return;
    api.get<{ groups: Group[] }>("/groups").then((res) => setGroups(res.groups)).catch(() => {});
  }, [user]);

  async function handleParse() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ parsed: ParsedWager }>("/wagers/parse", { text });
      const p = res.parsed;
      setParsed(p);
      setProposition(p.proposition);
      setSideA(p.sideLabels[0]);
      setSideB(p.sideLabels[1]);
      if (p.stakeCents) setStake(String(p.stakeCents / 100));
      setDeadline(toLocalInput(p.eventDeadline));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not read that bet");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ wager: Wager }>("/wagers", {
        groupId: groupId || undefined,
        proposition,
        sideLabels: [sideA, sideB],
        stakeCents: Math.round(parseFloat(stake) * 100),
        creatorSide: side,
        eventDeadline: new Date(deadline).toISOString(),
        resolutionMethod: parsed?.resolution ?? "ATTESTATION",
        oracleSource: parsed?.oracleSource ?? undefined,
        category: parsed?.category ?? undefined,
        invitePhones: phones
          .split(/[,\n]/)
          .map((p) => p.trim())
          .filter(Boolean),
      });
      router.push(`/w/${res.wager.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the wager");
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
    <Layout title="New challenge">
      {!parsed ? (
        <>
          <h1>What do you want to bet?</h1>
          <p className="muted small">Say it however you would say it to a friend.</p>

          <textarea
            autoFocus
            value={text}
            placeholder="$25 each that Texas beats Ohio State"
            onChange={(e) => setText(e.target.value)}
          />

          <div className="stack" style={{ marginTop: 12 }}>
            <Banner>{error}</Banner>
            <button className="block" onClick={handleParse} disabled={busy || text.trim().length < 3}>
              {busy ? "Reading…" : "Continue"}
            </button>
          </div>

          <h2>Try one of these</h2>
          <div className="stack">
            {EXAMPLES.map((example) => (
              <button key={example} className="side-option" onClick={() => setText(example)}>
                {example}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h1>Check the terms</h1>
          <p className="muted small">
            {parsed.source === "ai" ? "Read from your words" : "Read from your words"} — edit anything before
            you send it. Once funds lock, terms cannot change.
          </p>

          <div className="field">
            <label htmlFor="proposition">Proposition</label>
            <input id="proposition" value={proposition} onChange={(e) => setProposition(e.target.value)} />
          </div>

          <h2>Pick your side</h2>
          <div className="stack">
            <button
              className={`side-option ${side === 0 ? "selected" : ""}`}
              onClick={() => setSide(0)}
            >
              {sideA || "Side A"}
            </button>
            <button
              className={`side-option ${side === 1 ? "selected" : ""}`}
              onClick={() => setSide(1)}
            >
              {sideB || "Side B"}
            </button>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="sideA">Side A label</label>
            <input id="sideA" value={sideA} onChange={(e) => setSideA(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sideB">Side B label</label>
            <input id="sideB" value={sideB} onChange={(e) => setSideB(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="stake">Stake per person (USD)</label>
            <input
              id="stake"
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="deadline">Outcome known by</label>
            <input
              id="deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          {groups.length > 0 && (
            <div className="field">
              <label htmlFor="group">Group</label>
              <select id="group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">No group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="phones">Challenge by phone number</label>
            <textarea
              id="phones"
              placeholder="(512) 555-1234, (512) 555-9876"
              value={phones}
              onChange={(e) => setPhones(e.target.value)}
              style={{ minHeight: 64 }}
            />
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              They get a text with the terms and a code that signs them in.
            </p>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="between small">
              <span className="muted">Your stake</span>
              <span>{usd(Math.round(parseFloat(stake || "0") * 100))}</span>
            </div>
            <div className="between small" style={{ marginTop: 6 }}>
              <span className="muted">Resolution bond</span>
              <span>{usd(100)}</span>
            </div>
            <div className="between small" style={{ marginTop: 6 }}>
              <span className="muted">Resolved by</span>
              <span>{parsed.resolution === "ORACLE" ? parsed.oracleSource || "Data source" : "Group attestation"}</span>
            </div>
            <div className="divider" style={{ margin: "12px 0" }} />
            <div className="between">
              <b>Total commitment</b>
              <b>{usd(Math.round(parseFloat(stake || "0") * 100) + 100)}</b>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              The bond comes back when you resolve on time. 1% platform fee on settlement.
            </p>
          </div>

          <div className="stack" style={{ marginTop: 16 }}>
            <Banner>{error}</Banner>
            <button className="block" onClick={handleCreate} disabled={busy || !proposition || !stake}>
              {busy ? "Sending…" : "Send challenge"}
            </button>
            <button className="ghost block" onClick={() => setParsed(null)} disabled={busy}>
              Start over
            </button>
          </div>
        </>
      )}
    </Layout>
  );
}
