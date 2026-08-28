import { centsToWei, weiToCents, formatUsd } from "../src/lib/money";

describe("dollar and wei conversion", () => {
  it("round-trips a stake without drift", () => {
    expect(weiToCents(centsToWei(2500, 3000), 3000)).toBe(2500);
    expect(weiToCents(centsToWei(100, 3000), 3000)).toBe(100);
    expect(weiToCents(centsToWei(10_000, 3000), 3000)).toBe(10_000);
  });

  it("tracks the configured rate", () => {
    // $30 at $3,000/ETH is 0.01 ETH.
    expect(centsToWei(3000, 3000)).toBe(10_000_000_000_000_000n);
  });

  it("formats limits the way the product states them", () => {
    expect(formatUsd(10_000)).toBe("$100.00");
    expect(formatUsd(100)).toBe("$1.00");
  });
});
