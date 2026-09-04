// A create transaction can land while the call that links it to our record
// does not — the tab closes, the network drops. That leaves an escrow on-chain
// and a draft off-chain with nothing joining them, and publishing again would
// open a second escrow holding a second set of stakes. These cover the lookup
// that lets a publish resume instead of repeat.

const getWagersByCreator = jest.fn();
const getWager = jest.fn();

jest.mock("../src/lib/chain", () => ({
  ...jest.requireActual("../src/lib/chain"),
  getBook: () => ({ getWagersByCreator, getWager }),
}));

const findUnique = jest.fn();
jest.mock("../src/prisma", () => ({
  __esModule: true,
  default: { wager: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

jest.mock("../src/env", () => ({
  env: { wagerBookAddress: "0xaA0626d80083f8946DA6b4D45C73f42E45Df7228" },
}));

import { orphanedOnchainId } from "../src/routes/wagers";

const TERMS = "0xabc123";
const CREATOR = "0x0229fb97F1b925008216988dd4cf1e002A7b8FB0";

beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockResolvedValue(null);
});

describe("orphanedOnchainId", () => {
  it("finds the escrow this draft already has on-chain", async () => {
    getWagersByCreator.mockResolvedValue([1n, 4n]);
    getWager.mockImplementation(async (id: bigint) =>
      id === 4n ? { termsHash: TERMS } : { termsHash: "0xdead" }
    );

    expect(await orphanedOnchainId(TERMS, CREATOR)).toBe(4);
  });

  it("matches the terms hash regardless of case", async () => {
    getWagersByCreator.mockResolvedValue([2n]);
    getWager.mockResolvedValue({ termsHash: TERMS.toUpperCase() });

    expect(await orphanedOnchainId(TERMS.toLowerCase(), CREATOR)).toBe(2);
  });

  it("returns nothing when the creator has no matching wager", async () => {
    getWagersByCreator.mockResolvedValue([1n]);
    getWager.mockResolvedValue({ termsHash: "0xdead" });

    expect(await orphanedOnchainId(TERMS, CREATOR)).toBeNull();
  });

  // Two drafts hashing identically would need the same terms down to the
  // millisecond, but linking the wrong escrow is unrecoverable — so an id that
  // already belongs to a record is never offered to another.
  it("refuses an escrow another wager is already linked to", async () => {
    getWagersByCreator.mockResolvedValue([7n]);
    getWager.mockResolvedValue({ termsHash: TERMS });
    findUnique.mockResolvedValue({ id: "wager_other" });

    expect(await orphanedOnchainId(TERMS, CREATOR)).toBeNull();
  });

  it("prefers the newest match, which is what a retry just created", async () => {
    getWagersByCreator.mockResolvedValue([3n, 9n]);
    getWager.mockResolvedValue({ termsHash: TERMS });

    expect(await orphanedOnchainId(TERMS, CREATOR)).toBe(9);
  });

  it("does not touch the chain without a wallet or terms", async () => {
    expect(await orphanedOnchainId(null, CREATOR)).toBeNull();
    expect(await orphanedOnchainId(TERMS, null)).toBeNull();
    expect(getWagersByCreator).not.toHaveBeenCalled();
  });
});
