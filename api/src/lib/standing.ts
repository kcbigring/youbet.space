import { env } from "../env";
import type { Reputation } from "./reputation";
import { formatUsd } from "./money";

/// Standing earned inside a group, from the reputation the plan already
/// describes (§7): record, settled challenges, and attestation rate.
///
/// The important design rule: **standing never lifts a risk control.** The
/// protocol caps from §9 — $100 a person, $500 a pot, $1,000 a month — are a
/// safety posture, not a reward to be unlocked. Instead a new account starts
/// *below* those caps and earns its way up to them. Progression tightens the
/// floor rather than raising the ceiling, so nothing here can be read as
/// selling relief from our own limits.
///
/// What it rewards is resolving honestly and on time, which is the behaviour
/// the bond exists to encourage and the one thing that cannot be farmed: you
/// cannot inflate an attestation rate by betting more.

export interface Tier {
  key: string;
  name: string;
  blurb: string;
  /// Settled wagers required to reach this tier.
  settled: number;
  /// Minimum attestation rate, as a percentage. Null while nothing has settled.
  attestation: number | null;
  /// Personal stake ceiling in cents. Always at or below the protocol cap.
  maxStakeCents: number;
  /// Wagers a member may have open at once.
  openWagers: number;
  /// Invite links a member may mint per day.
  invitesPerDay: number;
  canCreateGroups: boolean;
}

export const TIERS: Tier[] = [
  {
    key: "NEW",
    name: "New",
    blurb: "Start small. Settle a few bets and the rest opens up.",
    settled: 0,
    attestation: null,
    maxStakeCents: 1_000, // $10
    openWagers: 2,
    invitesPerDay: 3,
    // Groups are how friends organise, so gating them behind settled bets meant
    // nobody could form the group they would have bet in — backwards for a
    // product whose whole premise is betting with people you already know. The
    // three-invites-a-day limit is what actually throttles farming, and a group
    // grants nobody any money.
    canCreateGroups: true,
  },
  {
    key: "REGULAR",
    name: "Regular",
    blurb: "You settle up. Bigger stakes and more people at once.",
    settled: 3,
    attestation: 80,
    maxStakeCents: 2_500, // $25
    openWagers: 5,
    invitesPerDay: 10,
    canCreateGroups: true,
  },
  {
    key: "TRUSTED",
    name: "Trusted",
    blurb: "You call results on time, every time.",
    settled: 10,
    attestation: 90,
    maxStakeCents: 5_000, // $50
    openWagers: 10,
    invitesPerDay: 25,
    canCreateGroups: true,
  },
  {
    key: "CORE",
    name: "Core",
    blurb: "A perfect record for showing up. Full limits.",
    settled: 25,
    attestation: 100,
    maxStakeCents: 10_000, // $100 — the protocol cap, never above it
    openWagers: 25,
    invitesPerDay: 50,
    canCreateGroups: true,
  },
];

export interface Standing {
  tier: Tier;
  next: Tier | null;
  /// What still stands between this member and the next tier.
  toNext: { settled: number; attestation: number | null } | null;
  limits: {
    maxStakeCents: number;
    openWagers: number;
    invitesPerDay: number;
    canCreateGroups: boolean;
  };
}

function qualifies(tier: Tier, rep: Reputation): boolean {
  const settled = rep.wins + rep.losses;
  if (settled < tier.settled) return false;
  if (tier.attestation === null) return true;
  // A missing rate means nothing has settled yet, which cannot clear a bar.
  return rep.attestationRate !== null && rep.attestationRate >= tier.attestation;
}

/// Highest tier the member currently clears. Standing can fall as well as rise:
/// letting an attestation rate slip costs the tier it earned, which is the
/// social pressure the plan asks for rather than a permanent badge.
/// What it would take to raise this person's stake limit, in plain words.
///
/// "Settle a few more" is not something anyone can act on — it does not say how
/// many, or that settling is only half of it.
export function pathToNext(standing: Standing): string {
  if (!standing.next || !standing.toNext) return "That is the highest limit.";

  const parts: string[] = [];
  if (standing.toNext.settled > 0) {
    parts.push(
      standing.toNext.settled === 1 ? "settle one more bet" : `settle ${standing.toNext.settled} more bets`
    );
  }
  if (standing.toNext.attestation !== null) {
    parts.push(`keep saying how they went ${standing.toNext.attestation}% of the time`);
  }
  if (!parts.length) return `Next settlement takes you to ${formatUsd(standing.next.maxStakeCents)}.`;

  return `${parts.join(" and ")} to reach ${formatUsd(standing.next.maxStakeCents)}.`;
}

export function standingFor(rep: Reputation): Standing {
  let earned = TIERS[0];
  for (const tier of TIERS) {
    if (qualifies(tier, rep)) earned = tier;
  }

  const next = TIERS[TIERS.indexOf(earned) + 1] ?? null;
  const settled = rep.wins + rep.losses;

  return {
    tier: earned,
    next,
    toNext: next
      ? {
          settled: Math.max(0, next.settled - settled),
          attestation:
            next.attestation !== null && (rep.attestationRate ?? 0) < next.attestation
              ? next.attestation
              : null,
        }
      : null,
    limits: {
      // Never above the protocol cap, whatever a tier says.
      maxStakeCents: Math.min(earned.maxStakeCents, env.maxStakeCents),
      openWagers: earned.openWagers,
      invitesPerDay: earned.invitesPerDay,
      canCreateGroups: earned.canCreateGroups,
    },
  };
}
