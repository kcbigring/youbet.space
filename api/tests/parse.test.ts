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
