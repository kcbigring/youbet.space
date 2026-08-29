import { centsToUnits, unitsToCents, formatUsd, stakeTokenDecimals } from "../src/lib/money";

describe("dollars and token units", () => {
  it("uses six decimals, matching USDC", () => {
    expect(stakeTokenDecimals).toBe(6);
    expect(centsToUnits(100)).toBe(1_000_000n); // $1.00
  });

  it("round-trips a stake exactly", () => {
    for (const cents of [1, 100, 2500, 10_000, 99_999]) {
      expect(unitsToCents(centsToUnits(cents))).toBe(cents);
    }
  });

  it("does not drift, because there is no exchange rate", () => {
    // The previous design priced a "$25" stake in ETH at a fixed rate, so the
    // wager stopped being $25 as soon as the market moved. $25 is now $25.
    expect(centsToUnits(2500)).toBe(25_000_000n);
    expect(unitsToCents(25_000_000n)).toBe(2500);
  });

  it("formats limits the way the product states them", () => {
    expect(formatUsd(10_000)).toBe("$100.00");
    expect(formatUsd(100)).toBe("$1.00");
  });
});
