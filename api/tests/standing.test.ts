import { pathToNext, standingFor, TIERS } from "../src/lib/standing";
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

// "Settle a few more and it goes up" is not something anyone can act on: it
// does not say how many, and it does not mention that settling is only half of
// what the next tier asks for.
describe("what it takes to raise a limit", () => {
  it("says how many bets, not 'a few'", () => {
    const message = pathToNext(standingFor(rep()));
    expect(message).toMatch(/settle 3 more bets/);
    expect(message).toMatch(/\$25/);
    expect(message).not.toMatch(/a few/);
  });

  it("mentions the attestation rate, which settling alone does not satisfy", () => {
    expect(pathToNext(standingFor(rep({ wins: 3, attestationRate: 20 })))).toMatch(/80%/);
  });

  // Somebody who has settled plenty but answers late should not be told to go
  // and settle more; that is not what is holding them.
  it("drops the part already earned", () => {
    const message = pathToNext(standingFor(rep({ wins: 12, attestationRate: 50 })));
    expect(message).not.toMatch(/settle/);
    expect(message).toMatch(/%/);
  });

  it("says so at the top", () => {
    expect(pathToNext(standingFor(rep({ wins: 40, attestationRate: 100 })))).toMatch(/highest/i);
  });
});
