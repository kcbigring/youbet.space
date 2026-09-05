import { parseHeuristically } from "../src/lib/parse";

describe("natural-language wager parsing", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("pulls the stake out of a dollar amount", () => {
    const parsed = parseHeuristically("$25 each that Texas beats Ohio State", now);
    expect(parsed.stakeCents).toBe(2500);
    expect(parsed.proposition).toBe("Texas beats Ohio State");
  });

  it("understands stakes written as words", () => {
    expect(parseHeuristically("50 bucks that I run a marathon", now).stakeCents).toBe(5000);
    expect(parseHeuristically("bet 12.50 dollars on it", now).stakeCents).toBe(1250);
  });

  it("names the people being challenged", () => {
    const parsed = parseHeuristically("I'll bet Fred and Mike $50 each that Texas makes the playoff", now);
    expect(parsed.participants).toEqual(["Fred", "Mike"]);
    expect(parsed.stakeCents).toBe(5000);
  });

  it("routes objective events to an oracle and everything else to attestation", () => {
    const sports = parseHeuristically("$20 that the Lakers win the game", now);
    expect(sports.resolution).toBe("ORACLE");
    expect(sports.category).toBe("sports");

    const market = parseHeuristically("$10 that bitcoin closes above 100k", now);
    expect(market.resolution).toBe("ORACLE");

    const personal = parseHeuristically("$5 that Dave cleans the garage", now);
    expect(personal.resolution).toBe("ATTESTATION");
    expect(personal.oracleSource).toBeNull();
  });

  it("reads relative deadlines", () => {
    expect(parseHeuristically("bet $5 that it rains tomorrow", now).eventDeadline).toBe(
      "2026-01-02T00:00:00.000Z"
    );
    expect(parseHeuristically("$5 that I lose 5 pounds in 30 days", now).eventDeadline).toBe(
      "2026-01-31T00:00:00.000Z"
    );
    expect(parseHeuristically("$5 that he shows up", now).eventDeadline).toBeNull();
  });

  it("labels the sides without repeating the proposition", () => {
    // The labels sit right under the proposition, so echoing it there reads as
    // a bug. The old fallback produced "Not: will i use the peloton...".
    const parsed = parseHeuristically("will i use the peloton in the next hour", now);
    expect(parsed.sideLabels).toEqual(["Yes", "No"]);
    expect(parsed.sideLabels.join(" ")).not.toMatch(/peloton|^Not:/i);
  });

  it("never invents a stake that was not stated", () => {
    expect(parseHeuristically("that the Jets miss the playoffs", now).stakeCents).toBeNull();
  });
});

// A bet says when it ends, and the parser used to hear only the day: "before
// 6am tomorrow" became this time tomorrow, so a wager whose outcome was known
// at breakfast could not be voted on until the evening.
describe("clock times in a bet", () => {
  // 2026-09-03 22:48 Mountain (UTC-6), which is when this was found.
  const now = new Date("2026-09-04T04:48:00.000Z");
  const MOUNTAIN = 360;

  const deadline = (text: string) =>
    parseHeuristically(text, now, MOUNTAIN).eventDeadline;

  it("puts 6am tomorrow at 6am, not at whatever time it is now", () => {
    // 06:00 Mountain on the 4th is 12:00 UTC.
    expect(deadline("i'll bet kc it get up before 6am tomorrow")).toBe("2026-09-04T12:00:00.000Z");
  });

  it("reads the time in the bettor's timezone, not the server's", () => {
    // Same words, same instant, different bettor: in UTC it is already the 4th,
    // so their "tomorrow" is the 5th. Six hours of difference moves the day.
    const utc = parseHeuristically("before 6am tomorrow", now, 0).eventDeadline;
    expect(utc).toBe("2026-09-05T06:00:00.000Z");
  });

  it("handles minutes and the evening", () => {
    expect(deadline("done by 9:30 pm tomorrow")).toBe("2026-09-05T03:30:00.000Z");
    expect(deadline("by noon tomorrow")).toBe("2026-09-04T18:00:00.000Z");
  });

  it("takes the next occurrence when no day is named", () => {
    // It is 22:48 local, so "6am" is tomorrow morning.
    expect(deadline("beat me to the gym before 6am")).toBe("2026-09-04T12:00:00.000Z");
  });

  it("still handles a bare day with no time", () => {
    expect(deadline("i'll bet you it rains tomorrow")).toBe("2026-09-05T04:48:00.000Z");
  });
});
