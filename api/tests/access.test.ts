// Two rules that protect people rather than data shapes, and that nothing in
// typechecking can see.

import { redactPhones } from "../src/routes/wagers";

jest.mock("../src/prisma", () => ({ __esModule: true, default: {} }));

describe("participant phone numbers", () => {
  const wager = (...phones: string[]) => ({
    participants: phones.map((phone) => ({ user: { id: "u", phone } })),
  });

  it("shows only the last four digits", () => {
    const out = redactPhones(wager("+17202443415", "+17205149702"));
    expect(out.participants.map((p) => p.user.phone)).toEqual(["3415", "9702"]);
  });

  // Enough to tell two friends called Mike apart before staking money on which
  // of them voted, and no more.
  it("never returns a number anyone could dial", () => {
    const out = redactPhones(wager("+17202443415"));
    expect(out.participants[0].user.phone).not.toContain("720");
  });

  it("yields nothing for an account claimed by link, which has no number", () => {
    const out = redactPhones(wager("pending:Lz2b9LqFXj"));
    expect(out.participants[0].user.phone).toBeNull();
  });
});
