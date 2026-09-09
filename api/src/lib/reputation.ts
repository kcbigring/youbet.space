import prisma from "../prisma";

export interface Reputation {
  challenges: number;
  wins: number;
  losses: number;
  netCents: number;
  /// Share of settled wagers where the user met their resolution duty.
  attestationRate: number | null;
  pendingAttestations: number;
}

interface SettledView {
  status: string;
  winningSide: number | null;
  participants: Array<{ side: number | null; conceded: boolean }>;
  mine: { side: number | null; attested: boolean };
}

/// Whether the escrow settled a wager without anyone having to attest.
///
/// The condition mirrors the contract exactly: it takes the concede path, and
/// refunds every bond, when every member of the losing side has conceded.
function undisputed(wager: Pick<SettledView, "winningSide" | "participants">): boolean {
  if (wager.winningSide === null) return false;
  const losers = wager.participants.filter((p) => p.side !== null && p.side !== wager.winningSide);
  return losers.length > 0 && losers.every((p) => p.conceded);
}

/// Share of settled wagers where this person met a duty they actually had.
///
/// Null until one has settled: a rate of zero and a rate of "not yet" are very
/// different things to show someone, and only one of them should hold their
/// stake limit down.
export function rateFor(wagers: SettledView[]): number | null {
  let owed = 0;
  let met = 0;

  for (const wager of wagers) {
    if (wager.status !== "SETTLED") continue;
    // A wager nobody disputed asked nothing of the winner. Counting it as a
    // missed attestation meant winning a bet cleanly could drive the rate to
    // zero and pin someone at the lowest stake limit — permanently, since a
    // settled wager can never be attested to afterwards.
    if (undisputed(wager)) continue;
    owed += 1;
    if (wager.mine.attested) met += 1;
  }

  return owed === 0 ? null : Math.round((met / owed) * 100);
}

/// Reputation is derived from participation records rather than stored, so it can
/// never drift from the wagers it summarises (execution plan §7).
export async function reputationFor(userId: string, groupId?: string): Promise<Reputation> {
  const participations = await prisma.wagerParticipant.findMany({
    where: {
      userId,
      state: "JOINED",
      ...(groupId ? { wager: { groupId } } : {}),
    },
    include: {
      wager: {
        select: {
          status: true,
          winningSide: true,
          participants: { select: { side: true, conceded: true } },
        },
      },
    },
  });

  let wins = 0;
  let losses = 0;
  let netCents = 0;

  for (const p of participations) {
    if (p.wager.status !== "SETTLED") continue;
    if (p.wager.winningSide !== null && p.side !== null) {
      if (p.side === p.wager.winningSide) wins += 1;
      else losses += 1;
    }
    netCents += p.netCents ?? 0;
  }

  const pendingAttestations = participations.filter(
    (p) => p.wager.status === "LOCKED" && !p.attestedAt
  ).length;

  return {
    challenges: participations.length,
    wins,
    losses,
    netCents,
    attestationRate: rateFor(
      participations.map((p) => ({
        status: p.wager.status,
        winningSide: p.wager.winningSide,
        participants: p.wager.participants,
        mine: { side: p.side, attested: Boolean(p.attestedAt) },
      }))
    ),
    pendingAttestations,
  };
}

/// Committed volume in the trailing 30 days, used for the per-user monthly cap
/// (execution plan §9).
export async function monthlyVolumeCents(userId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const participations = await prisma.wagerParticipant.findMany({
    where: { userId, state: "JOINED", fundedAt: { gte: since } },
    include: { wager: { select: { stakeCents: true } } },
  });
  return participations.reduce((sum, p) => sum + p.wager.stakeCents, 0);
}
