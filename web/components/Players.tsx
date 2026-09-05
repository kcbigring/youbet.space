import { Avatar } from "./Layout";
import { timeUntil } from "../lib/api";
import type { Participant, Wager } from "../lib/types";

/// Everyone in the wager, which side they took, and whether they have said how
/// it turned out.
///
/// Two different acts happen here and the copy has to keep them apart: backing
/// a side is the bet, saying who won is how it settles. Calling both of them
/// "voting" made a roster where somebody had already picked a side read as
/// though they had not.
///
/// The calls are visible to everyone as they land — being one call away from
/// losing $20 with no way to see it is not a detail — alongside enough of each
/// phone number to tell two friends with the same first name apart.
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

  const said = joined.filter((p) => p.attestedAt).length;

  const call = (p: Participant) => {
    if (p.conceded) return { text: "Gave it up", tone: "conceded" as const };
    if (p.attestedAt) {
      return { text: `Said ${wager.sideLabels[p.attestedChoice ?? 0]} won`, tone: "voted" as const };
    }
    // Before the outcome is due nobody can have said anything, so say what is
    // actually true — that it is not their turn yet — rather than marking
    // everyone delinquent for a deadline that has not arrived.
    return votingOpen
      ? { text: "Not said yet", tone: "waiting" as const }
      : { text: "Waiting on the outcome", tone: "waiting" as const };
  };

  return (
    <>
      <h2>Who is in</h2>
      <p className="small muted" style={{ marginTop: -4 }}>
        {votingOpen
          ? `${said} of ${joined.length} have said how it went${
              required != null ? `. ${required} have to agree before the money moves.` : "."
            }`
          : `Nobody says how it went until the outcome is due, ${timeUntil(wager.eventDeadline).replace(
              " left",
              " from now"
            )} — ${new Date(wager.eventDeadline).toLocaleString()}.`}
      </p>
      <div className="stack">
        {joined.map((p) => {
          const { text, tone } = call(p);
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
