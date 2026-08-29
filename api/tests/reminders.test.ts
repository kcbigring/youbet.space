import { STAGES } from "../src/lib/reminders";

describe("attestation reminder schedule", () => {
  it("matches the windows in the execution plan", () => {
    expect(STAGES.map((s) => s.afterHours)).toEqual([24, 48, 72]);
  });

  it("warns about the bond only once the deadline is close", () => {
    const first = STAGES[0].body({ proposition: "Texas wins", bondCents: 100, closesAt: new Date() });
    const second = STAGES[1].body({ proposition: "Texas wins", bondCents: 100, closesAt: new Date() });

    expect(first).not.toMatch(/forfeit/i);
    expect(second).toMatch(/forfeit/i);
    expect(second).toMatch(/\$1\.00/);
  });

  it("names the wager in every message, so a notification stands alone", () => {
    for (const stage of STAGES) {
      const body = stage.body({ proposition: "Texas beats Ohio State", bondCents: 100, closesAt: new Date() });
      expect(body).toContain("Texas beats Ohio State");
    }
  });

  it("uses a distinct kind per stage, which is what makes sends idempotent", () => {
    const kinds = STAGES.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
