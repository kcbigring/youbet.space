import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, usd, timeUntil, ApiError } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import type { Wager } from "../../lib/types";
import { encodeFunctionData } from "viem";
import { Layout, Banner, Avatar, Empty } from "../../components/Layout";
import { ShareInvite } from "../../components/ShareInvite";
import { Players } from "../../components/Players";
import { ConnectWallet } from "../../components/ConnectWallet";
import { TestMoney } from "../../components/TestMoney";
import { FoundingSlots } from "../../components/FoundingSlots";
import { useWallet } from "../../lib/useWallet";
import { wagerBookAbi } from "../../lib/abi";
import { publishWager } from "../../lib/publish";
import { wagerBookAddress } from "../../lib/contracts";

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; displayName: string | null };
}

interface Detail {
  wager: Wager;
  comments: Comment[];
  onchain: {
    status: string;
    participants: number;
    attestationsRequired: number;
    attestations: number[];
  } | null;
}

export default function WagerDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useSession();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const wallet = useWallet();

  const load = useCallback(async () => {
    if (typeof id !== "string") return;
    try {
      setDetail(await api.get<Detail>(`/wagers/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this wager");
    }
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  /// Sends a call from the user's smart account, then asks the API to re-read
  /// the chain. The API never signs, so the chain is what settles the record.
  async function onChain(id: string, calls: Parameters<typeof wallet.send>[0]) {
    await wallet.send(calls);
    await api.post(`/wagers/${id}/sync`);
  }

  /// Puts a draft on-chain. A wager created before its author had a wallet
  /// exists only in our database, where it reaches nobody.
  async function publish(id: string) {
    await publishWager(id, wallet.send);
  }

  /// The API returns the exact calls for joining — approving the stake, then
  /// joining — so the amounts are never guessed client-side. They go out as one
  /// batch, so an ERC-20 stake still costs the user a single passkey prompt.
  async function join(id: string, side: number) {
    const res = await api.post<{ calls: { to: string; data: string }[] }>(`/wagers/${id}/join`, {
      side,
    });
    await onChain(
      id,
      res.calls.map((c) => ({ to: c.to as `0x${string}`, data: c.data as `0x${string}` }))
    );
  }

  /// Every wager action targets the one book contract, with the wager id as the
  /// first argument. `withdraw` takes none — credits are global, so a single
  /// call collects winnings across every wager.
  const bookCall = (fn: "attest" | "concede" | "withdraw" | "expire", args: readonly unknown[] = []) => ({
    to: wagerBookAddress,
    data: encodeFunctionData({ abi: wagerBookAbi, functionName: fn, args: args as never }),
  });

  if (loading || !user || !detail) {
    return (
      <Layout>
        <Banner>{error}</Banner>
        <div className="skeleton" />
      </Layout>
    );
  }

  const { wager, comments, onchain } = detail;
  const me = wager.participants.find((p) => p.userId === user.id);
  const joined = wager.participants.filter((p) => p.state === "JOINED");
  const invited = wager.participants.filter((p) => p.state === "INVITED" && p.userId !== user.id);
  const pot = wager.stakeCents * joined.length;
  const eventOver = new Date(wager.eventDeadline) < new Date();

  const sideCount = (list: typeof wager.participants, s: number) =>
    list.filter((p) => p.side === s).length;

  const canJoin = wager.status === "OPEN" && me?.state !== "JOINED" && new Date(wager.fundingDeadline) > new Date();
  /// A bet with nobody opposite is not a bet yet, which is the one thing the
  /// page should be pushing on.
  const needsOpponent = wager.status === "OPEN" && sideCount(joined, 1 - (me?.side ?? 0)) === 0;
  const canResolve = wager.status === "LOCKED" && me?.state === "JOINED" && !me.attestedAt;
  const canWithdraw = ["SETTLED", "REFUNDED", "CANCELLED"].includes(wager.status) && me?.state === "JOINED";

  return (
    <Layout title={wager.group?.name ?? "Challenge"}>
      <div className="between" style={{ marginBottom: 10 }}>
        <span className="pill">{wager.resolutionMethod === "ORACLE" ? "Auto-resolved" : "Group attested"}</span>
        <span className="small muted">
          {wager.status === "OPEN" ? timeUntil(wager.fundingDeadline) : wager.status.toLowerCase()}
        </span>
      </div>

      <h1 style={{ lineHeight: 1.3 }}>{wager.proposition}</h1>
      <p className="muted small" style={{ marginTop: 4 }}>
        {usd(wager.stakeCents)} each · {usd(pot)} pot · started by{" "}
        {wager.creatorId === user.id ? "you" : wager.creator.displayName || "a friend"}
      </p>

      {wager.status === "DRAFT" && wager.creatorId === user.id && (
        <div className="next-step">
          <span className="next-step-tag">Step 1 of 2</span>
          <b>Publish it before you send it</b>
          <p className="small muted" style={{ margin: "6px 0 12px" }}>
            Right now this only exists here. Publishing locks the terms on-chain so nobody can
            change them &mdash; then you get a link to send.
          </p>
          {!wallet.isConnected ? (
            <ConnectWallet />
          ) : (
            <button
              className="block"
              disabled={busy || wallet.busy}
              onClick={() => act(() => publish(wager.id))}
            >
              Publish this challenge
            </button>
          )}
        </div>
      )}

      {wager.status === "OPEN" && me?.state !== "JOINED" && wager.creatorId === user.id && (
        <div className="next-step">
          <span className="next-step-tag">Step 2 of 2</span>
          <b>Put your money on it</b>
          <p className="small muted" style={{ margin: "6px 0 12px" }}>
            You started this one but haven&rsquo;t funded your side yet. Pick it below, then send
            the link.
          </p>
        </div>
      )}

      {needsOpponent && (
        <div style={{ marginTop: 18 }}>
          <ShareInvite
            endpoint={`/wagers/${wager.id}/invites`}
            shareTitle="I'll bet you"
            heading="Nobody has taken the other side yet"
          />
        </div>
      )}

      {wager.status === "LOCKED" || wager.status === "SETTLED" ? (
        <Players wager={wager} meId={user.id} required={onchain?.attestationsRequired} />
      ) : null}

      <h2>Sides</h2>
      <div className="stack">
        {wager.sideLabels.map((label, index) => {
          const takers = joined.filter((p) => p.side === index);
          const won = wager.status === "SETTLED" && wager.winningSide === index;
          return (
            <div key={index} className={`side-option ${me?.side === index ? "selected" : ""} ${won ? "won" : ""}`}>
              <div className="between">
                <span>{label}</span>
                {won && <span className="pill live">Won</span>}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {takers.length ? takers.map((p) => p.user.displayName || "Friend").join(", ") : "Nobody yet"}
              </div>
            </div>
          );
        })}
      </div>

      {canJoin && !wallet.isConnected && (
        <>
          <h2>Take a side</h2>
          <p className="small muted" style={{ marginTop: -4 }}>
            You need a wallet to put money on this. It takes one tap.
          </p>
          <ConnectWallet />
        </>
      )}

      {canJoin && wallet.isConnected && (
        <>
          <h2>Take a side</h2>
          <p className="small muted" style={{ marginTop: -4 }}>
            {usd(wager.stakeCents)} stake + {usd(wager.bondCents)} bond = {usd(wager.stakeCents + wager.bondCents)}{" "}
            committed. The bond comes back when you resolve on time.
          </p>
          <div className="stack">
            {/* An invited friend arrives with nothing; this is where they get
                something to bet with, and what being early is worth. */}
            <FoundingSlots compact />
            <TestMoney />
            {wager.sideLabels.map((label, index) => (
              <button
                key={index}
                className="side-option"
                disabled={busy || wallet.busy}
                onClick={() => act(() => join(wager.id, index))}
              >
                Back: {label}
              </button>
            ))}
            <button
              className="ghost block"
              disabled={busy || wallet.busy}
              onClick={() => act(() => api.post(`/wagers/${wager.id}/decline`))}
            >
              Not this time
            </button>
          </div>
        </>
      )}

      {canResolve && (
        <>
          <h2>{eventOver ? "How did it go?" : "Not settled yet"}</h2>
          {/* Before the outcome is due, the contract will not accept a vote for
              either side — so conceding is genuinely the only thing on offer.
              Saying that outright beats presenting one button and letting it
              look like the app has decided you lost. */}
          <p className="small muted" style={{ marginTop: -4 }}>
            {eventOver
              ? `Say who won. ${onchain?.attestationsRequired ?? 0} of ${onchain?.participants ?? 0} have to agree before it pays out.`
              : `Nobody votes until the outcome is due on ${new Date(wager.eventDeadline).toLocaleString()}. Until then the only way to end it early is to give it up.`}
          </p>
          <div className="stack">
            {eventOver &&
              wager.sideLabels.map((label, index) => (
                <button
                  key={index}
                  className="side-option"
                  disabled={busy || wallet.busy}
                  onClick={() =>
                    act(() => onChain(wager.id, [bookCall("attest", [BigInt(wager.onchainId!), index])]))
                  }
                >
                  {label} won
                </button>
              ))}
            <button
              className="ghost block"
              disabled={busy || wallet.busy}
              onClick={() => act(() => onChain(wager.id, [bookCall("concede", [BigInt(wager.onchainId!)])]))}
            >
              I lost &mdash; pay them now
            </button>
          </div>
          <p className="small muted">
            Vote by {new Date(wager.resolutionDeadline).toLocaleString()} or your {usd(wager.bondCents)} bond
            goes to whoever did.
          </p>
        </>
      )}

      {/* The voting window closed without enough agreement. Anyone can call
          this; stakes come back and the bonds of everyone who did not vote go
          to those who did. Without it a wager sits locked forever, and the
          deadline is a threat nothing carries out. */}
      {wager.status === "LOCKED" &&
        me?.state === "JOINED" &&
        new Date(wager.resolutionDeadline) < new Date() && (
          <>
            <h2>Voting has closed</h2>
            <p className="small muted" style={{ marginTop: -4 }}>
              Not enough people voted in time, so nobody wins. Stakes go back, and the bonds of
              whoever did not vote are split between those who did.
            </p>
            <button
              className="block"
              disabled={busy || wallet.busy}
              onClick={() => act(() => onChain(wager.id, [bookCall("expire", [BigInt(wager.onchainId!)])]))}
            >
              Close it out and return the stakes
            </button>
          </>
        )}

      {me?.attestedAt && wager.status === "LOCKED" && (
        <div className="banner info" style={{ marginTop: 20 }}>
          You said {me.conceded ? "you lost" : `"${wager.sideLabels[me.attestedChoice ?? 0]}" won`}. Waiting on the
          others until {new Date(wager.resolutionDeadline).toLocaleDateString()}.
        </div>
      )}

      {wager.status === "SETTLED" && me?.netCents != null && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="between">
            <b>Your result</b>
            <b className={me.netCents >= 0 ? "pos" : "neg"}>
              {me.netCents >= 0 ? "+" : ""}
              {usd(me.netCents)}
            </b>
          </div>
        </div>
      )}

      {canWithdraw && (
        <button
          className="block"
          style={{ marginTop: 12 }}
          disabled={busy || wallet.busy}
          onClick={() => act(() => onChain(wager.id, [bookCall("withdraw")]))}
        >
          Claim everything you are owed
        </button>
      )}

      {invited.length > 0 && (
        <>
          <h2>Invited</h2>
          <div className="stack">
            {invited.map((p) => (
              <div key={p.id} className="row">
                <Avatar name={p.user.displayName} />
                <span className="grow">{p.user.displayName || "Waiting on a friend"}</span>
                <span className="small muted">not in yet</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* One link, one panel. While the other side is empty the urgent copy up
          top is the one to show; this is for adding a third or fourth person to
          a wager that already has both sides covered. */}
      {wager.status === "OPEN" && !needsOpponent && (
        <>
          <h2>Bring someone in</h2>
          <ShareInvite
            endpoint={`/wagers/${wager.id}/invites`}
            shareTitle="I'll bet you"
            heading="Invite more people"
          />
        </>
      )}

      <h2>Trash talk</h2>
      <div className="stack">
        {comments.length === 0 && <Empty>Nothing said yet.</Empty>}
        {comments.map((c) => (
          <div key={c.id} className="row" style={{ alignItems: "flex-start" }}>
            <Avatar name={c.user.displayName} />
            <div className="grow">
              <div className="small muted">{c.user.displayName || "Friend"}</div>
              <div>{c.body}</div>
            </div>
          </div>
        ))}
        <div className="row">
          <input
            className="grow"
            placeholder="Say something"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="subtle"
            disabled={busy || !comment.trim()}
            onClick={() =>
              act(async () => {
                await api.post(`/wagers/${wager.id}/comments`, { body: comment });
                setComment("");
              })
            }
          >
            Post
          </button>
        </div>
      </div>

      <Banner>{error}</Banner>

      {wager.onchainId && (
        <p className="small muted mono break" style={{ marginTop: 24 }}>
          Wager #{wager.onchainId} · {wagerBookAddress}
        </p>
      )}
    </Layout>
  );
}
