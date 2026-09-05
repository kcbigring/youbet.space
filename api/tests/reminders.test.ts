// Reminders are what keep a forfeited bond from being a trap. The bond exists
// to create mild social pressure, not to punish someone who never heard.

import { STAGES, dueAt } from "../src/lib/reminders";

const EVENT = new Date("2026-09-05T00:00:00.000Z");
const hours = (n: number) => new Date(EVENT.getTime() + n * 3_600_000);
const body = (stage: (typeof STAGES)[number], closesAt = new Date()) =>
  stage.body({ proposition: "Texas beats Ohio State", bondCents: 100, closesAt });

describe("when a reminder falls due", () => {
  // The schedule used to be 24, 48 and 72 hours after the outcome, which
  // assumed every wager gave three days to answer. Once creators could choose
  // anything from six hours to a week, a short window shut and took the bond
  // before the first nudge was even due — so timing is a share of the window.
  it("fits a six-hour window", () => {
    const close = hours(6);
    const due = STAGES.map((s) => dueAt(s, EVENT, close));

    expect(due[0]).toEqual(EVENT); // the moment the outcome is known
    expect(due[1]).toEqual(hours(4.5)); // still time to act on it
    expect(due[2]).toEqual(close);
  });

  it("fits a week just as well", () => {
    const close = hours(24 * 7);
    const due = STAGES.map((s) => dueAt(s, EVENT, close));

    expect(due[0]).toEqual(EVENT);
    expect(due[1]).toEqual(hours(126)); // five and a quarter days in
    expect(due[2]).toEqual(close);
  });

  it("warns before the bond is at risk, never after", () => {
    for (const window of [6, 24, 72, 168]) {
      const lastCall = dueAt(STAGES[1], EVENT, hours(window));
      expect(lastCall.getTime()).toBeGreaterThan(EVENT.getTime());
      expect(lastCall.getTime()).toBeLessThan(hours(window).getTime());
    }
  });
});

describe("what a reminder says", () => {
  it("does not mention the bond until it is actually at stake", () => {
    expect(body(STAGES[0])).not.toMatch(/bond/i);
    expect(body(STAGES[1])).toMatch(/bond/i);
    expect(body(STAGES[1])).toMatch(/\$1\.00/);
  });

  it("names the wager in every message, so a notification stands alone", () => {
    for (const stage of STAGES) expect(body(stage)).toContain("Texas beats Ohio State");
  });

  it("uses a distinct kind per stage, which is what makes sends idempotent", () => {
    const kinds = STAGES.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
