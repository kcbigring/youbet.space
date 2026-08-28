import Link from "next/link";
import type { Wager } from "../lib/types";
import { usd, timeUntil } from "../lib/api";

function statusPill(wager: Wager) {
  switch (wager.status) {
    case "OPEN":
      return <span className="pill live">Open · {timeUntil(wager.fundingDeadline)}</span>;
    case "LOCKED":
      return new Date(wager.eventDeadline) < new Date() ? (
        <span className="pill warn">Needs your call</span>
      ) : (
        <span className="pill live">Live</span>
      );
    case "SETTLED":
      return <span className="pill done">Settled</span>;
    case "REFUNDED":
      return <span className="pill done">Refunded</span>;
    case "CANCELLED":
      return <span className="pill done">Cancelled</span>;
    default:
      return <span className="pill">Draft</span>;
  }
}

export function WagerCard({ wager, userId }: { wager: Wager; userId?: string }) {
  const me = wager.participants.find((p) => p.userId === userId);
  const joined = wager.participants.filter((p) => p.state === "JOINED");
  const won = wager.status === "SETTLED" && me?.side === wager.winningSide;

  return (
    <Link href={`/w/${wager.id}`} className="card card-link">
      <div className="between" style={{ marginBottom: 8 }}>
        {statusPill(wager)}
        <span className="small muted">{usd(wager.stakeCents)} each</span>
      </div>

      <div style={{ fontWeight: 600, lineHeight: 1.4, marginBottom: 8 }}>{wager.proposition}</div>

      <div className="between small muted">
        <span>
          {joined.length} in · {usd(wager.stakeCents * joined.length)} pot
          {wager.group ? ` · ${wager.group.name}` : ""}
        </span>
        {wager.status === "SETTLED" && me?.netCents != null && (
          <span className={won ? "pos" : "neg"}>
            {me.netCents >= 0 ? "+" : ""}
            {usd(me.netCents)}
          </span>
        )}
      </div>
    </Link>
  );
}
