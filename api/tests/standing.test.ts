import { standingFor, TIERS } from "../src/lib/standing";
import type { Reputation } from "../src/lib/reputation";

const rep = (over: Partial<Reputation> = {}): Reputation => ({
  challenges: 0,
  wins: 0,
  losses: 0,
  netCents: 0,
  attestationRate: null,
  pendingAttestations: 0,
  ...over,
});

describe("standing", () => {
  it("starts a new account below the protocol cap, not at it", () => {
    const s = standingFor(rep());
    expect(s.tier.key).toBe("NEW");
    expect(s.limits.maxStakeCents).toBe(1_000); // $10
    expect(s.limits.openWagers).toBe(2);
  });

  // What standing gates is money and volume. Organising is not a risk control:
  // gating groups behind settled bets meant nobody could form the group they
  // would have bet in, which is backwards for a product about betting with
  // people you already know.
  it("lets a new account form a group, and still holds the money back", () => {
    const s = standingFor(rep());
    expect(s.limits.canCreateGroups).toBe(true);
    expect(s.limits.maxStakeCents).toBeLessThan(10_000);
    expect(s.limits.invitesPerDay).toBe(3);
  });

  it("never lets a tier exceed the protocol cap", () => {
    // The point of the system: progression earns up to the risk limit and
    // stops there. No tier may sell relief from it.
    for (const tier of TIERS) {
      expect(tier.maxStakeCents).toBeLessThanOrEqual(10_000);
    }
    const top = standingFor(rep({ wins: 30, losses: 5, attestationRate: 100 }));
    expect(top.tier.key).toBe("CORE");
    expect(top.limits.maxStakeCents).toBe(10_000);
  });

  it("promotes on settled volume and attestation together", () => {
    // Plenty settled, but unreliable about calling results.
    expect(standingFor(rep({ wins: 20, losses: 5, attestationRate: 50 })).tier.key).toBe("NEW");
    // Reliable, but not enough history yet.
    expect(standingFor(rep({ wins: 1, losses: 0, attestationRate: 100 })).tier.key).toBe("NEW");
    // Both.
    expect(standingFor(rep({ wins: 2, losses: 2, attestationRate: 85 })).tier.key).toBe("REGULAR");
  });

  it("falls when the attestation rate slips", () => {
    const good = standingFor(rep({ wins: 8, losses: 4, attestationRate: 95 }));
    expect(good.tier.key).toBe("TRUSTED");

    // Standing is current behaviour, not a badge you keep.
    const slipped = standingFor(rep({ wins: 8, losses: 4, attestationRate: 70 }));
    expect(slipped.tier.key).toBe("NEW");
  });

  it("says what is left to reach the next tier", () => {
    const s = standingFor(rep({ wins: 1, losses: 0, attestationRate: 100 }));
    expect(s.next?.key).toBe("REGULAR");
    expect(s.toNext?.settled).toBe(2);
    expect(s.toNext?.attestation).toBeNull(); // rate already clears it
  });

  it("has nothing left to reach at the top", () => {
    const s = standingFor(rep({ wins: 25, losses: 5, attestationRate: 100 }));
    expect(s.next).toBeNull();
    expect(s.toNext).toBeNull();
  });
});
