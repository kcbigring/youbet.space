import { Avatar } from "./Layout";
import type { Participant, Wager } from "../lib/types";

/// Everyone in the wager, and how each of them voted.
///
/// A wager is a claim about who owes whom, settled by the people in it. Hiding
/// the tally until it resolves means someone can be one vote from losing $20
/// and have no way to see it — so the votes are visible to every participant as
/// they land, alongside enough of each phone number to tell two friends with
/// the same first name apart.
export function Players({
  wager,
  meId,
  required,
}: {
  wager: Wager;
  meId: string;
  required?: number;
}) {
  const joined = wager.participants.filter((p) => p.state === "JOINED");
  if (!joined.length) return null;

  const voted = joined.filter((p) => p.attestedAt).length;

  const vote = (p: Participant) => {
    if (!p.attestedAt) return { text: "Has not voted", tone: "waiting" as const };
    if (p.conceded) return { text: "Conceded", tone: "conceded" as const };
    return { text: `Says "${wager.sideLabels[p.attestedChoice ?? 0]}"`, tone: "voted" as const };
  };

  return (
    <>
      <h2>Who is in</h2>
      {required != null && (
        <p className="small muted" style={{ marginTop: -4 }}>
          {voted} of {joined.length} have voted. {required} must agree to settle it.
        </p>
      )}
      <div className="stack">
        {joined.map((p) => {
          const { text, tone } = vote(p);
          const name = p.user.displayName || "Friend";
          return (
            <div key={p.id} className="row player-row">
              <Avatar name={p.user.displayName} />
              <div className="grow">
                <div>
                  {name}
                  {p.userId === meId && <span className="muted small"> (you)</span>}
                  {p.user.phone && <span className="muted small mono"> ···{p.user.phone}</span>}
                </div>
                <div className="small muted">
                  Backing {wager.sideLabels[p.side ?? 0]}
                </div>
              </div>
              <span className={`pill vote-${tone}`}>{text}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
