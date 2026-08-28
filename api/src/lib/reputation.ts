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

/// Reputation is derived from participation records rather than stored, so it can
/// never drift from the wagers it summarises (execution plan §7).
export async function reputationFor(userId: string, groupId?: string): Promise<Reputation> {
  const participations = await prisma.wagerParticipant.findMany({
    where: {
      userId,
      state: "JOINED",
      ...(groupId ? { wager: { groupId } } : {}),
    },
    include: { wager: { select: { status: true, winningSide: true } } },
  });

  let wins = 0;
  let losses = 0;
  let netCents = 0;
  let resolvable = 0;
  let resolved = 0;

  for (const p of participations) {
    if (p.wager.status !== "SETTLED") continue;
    resolvable += 1;
    if (p.attestedAt) resolved += 1;
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
    attestationRate: resolvable === 0 ? null : Math.round((resolved / resolvable) * 100),
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
