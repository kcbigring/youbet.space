// Attestation rate gates how much someone may stake, so what counts as a missed
// duty has to be exactly what the escrow treats as one.

jest.mock("../src/prisma", () => ({ __esModule: true, default: {} }));

import { rateFor } from "../src/lib/reputation";

const settled = (
  winningSide: number,
  participants: Array<{ side: number; conceded?: boolean }>,
  mine: { side: number; attested: boolean }
) => ({
  status: "SETTLED" as const,
  winningSide,
  participants: participants.map((p) => ({ side: p.side, conceded: p.conceded ?? false })),
  mine,
});

describe("what counts as an attestation you owed", () => {
  // The bug that prompted this: a clean win where the loser conceded drove the
  // winner's rate to zero, pinning them at the lowest stake limit with no way
  // to climb out — the wager was already settled, so it could never be fixed.
  it("asks nothing of the winner when the loser conceded", () => {
    expect(
      rateFor([settled(0, [{ side: 0 }, { side: 1, conceded: true }], { side: 0, attested: false })])
    ).toBeNull();
  });

  it("counts it when the wager was settled by people voting", () => {
    expect(
      rateFor([settled(0, [{ side: 0 }, { side: 1 }], { side: 0, attested: true })])
    ).toBe(100);
    expect(
      rateFor([settled(0, [{ side: 0 }, { side: 1 }], { side: 0, attested: false })])
    ).toBe(0);
  });

  // Mirrors the contract: the concede path needs *every* member of the losing
  // side, so one holdout means the rest still owed an answer.
  it("still counts when only part of the losing side conceded", () => {
    expect(
      rateFor([
        settled(
          0,
          [{ side: 0 }, { side: 1, conceded: true }, { side: 1 }],
          { side: 0, attested: false }
        ),
      ])
    ).toBe(0);
  });

  it("is unknown until something has settled", () => {
    expect(rateFor([])).toBeNull();
  });
});
