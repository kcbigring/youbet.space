import { usd } from "../lib/api";
import type { Standing as StandingType } from "../lib/types";

/// Shows where someone stands and what is next. Limits people cannot see feel
/// arbitrary when they hit them, so the ceiling and the way up are both stated
/// before anyone runs into either.
export function Standing({ standing }: { standing: StandingType }) {
  const { tier, next, toNext, limits } = standing;

  return (
    <div className="card">
      <div className="between">
        <div>
          <div className="small muted">Standing</div>
          <b style={{ fontSize: 18 }}>{tier.name}</b>
        </div>
        <span className="pill live">{usd(limits.maxStakeCents)} a bet</span>
      </div>

      <p className="small muted" style={{ margin: "10px 0 0" }}>
        {tier.blurb}
      </p>

      <div className="divider" style={{ margin: "14px 0" }} />

      <div className="stats">
        <div className="stat">
          <b>{limits.openWagers}</b>
          <span>Bets at once</span>
        </div>
        <div className="stat">
          <b>{limits.invitesPerDay}</b>
          <span>Invites a day</span>
        </div>
        <div className="stat">
          <b>{limits.canCreateGroups ? "Yes" : "Not yet"}</b>
          <span>Own groups</span>
        </div>
      </div>

      {next && toNext && (
        <>
          <div className="divider" style={{ margin: "14px 0" }} />
          <div className="small muted">
            <b style={{ color: "var(--text)" }}>Next: {next.name}</b> — {usd(next.maxStakeCents)} a
            bet.{" "}
            {toNext.settled > 0 && (
              <>
                Settle {toNext.settled} more bet{toNext.settled === 1 ? "" : "s"}
                {toNext.attestation !== null ? " and keep " : "."}
              </>
            )}
            {toNext.attestation !== null && (
              <>
                {toNext.settled > 0 ? "" : "Keep "}your attestation rate at {toNext.attestation}% or
                better.
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
