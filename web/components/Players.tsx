import { Avatar } from "./Layout";
import { timeUntil } from "../lib/api";
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
  /// False until the outcome is due. The contract refuses a vote before then,
  /// so "has not voted" would be blaming people for a door that is still shut.
  votingOpen,
}: {
  wager: Wager;
  meId: string;
  required?: number;
  votingOpen: boolean;
}) {
  const joined = wager.participants.filter((p) => p.state === "JOINED");
  if (!joined.length) return null;

  const voted = joined.filter((p) => p.attestedAt).length;

  const vote = (p: Participant) => {
    if (p.conceded) return { text: "Conceded", tone: "conceded" as const };
    if (p.attestedAt) {
      return { text: `Says "${wager.sideLabels[p.attestedChoice ?? 0]}"`, tone: "voted" as const };
    }
    // Before the outcome is due nobody can have voted, so say what is actually
    // true — that it is not their turn yet — rather than marking everyone
    // delinquent for a deadline that has not arrived.
    return votingOpen
      ? { text: "Has not voted", tone: "waiting" as const }
      : { text: "Not yet", tone: "waiting" as const };
  };

  return (
    <>
      <h2>Who is in</h2>
      <p className="small muted" style={{ marginTop: -4 }}>
        {votingOpen
          ? `${voted} of ${joined.length} have voted${required != null ? `. ${required} must agree to settle it.` : "."}`
          : `Voting opens in ${timeUntil(wager.eventDeadline).replace(" left", "")}, when the outcome is due — ${new Date(wager.eventDeadline).toLocaleString()}.`}
      </p>
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
