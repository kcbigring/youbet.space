import { wagerBookAbi } from "./abi";

export { wagerBookAbi };

/// One contract holds every wager, keyed by id — so there is a single address
/// for a paymaster to allowlist, which is what makes sponsored `join` possible.
export const wagerBookAddress = (process.env.NEXT_PUBLIC_WAGER_BOOK_ADDRESS || "") as `0x${string}`;

export const hasWagerBook = /^0x[a-fA-F0-9]{40}$/.test(wagerBookAddress);

/// Mirrors WagerBook.Status on-chain. Index 0 is an id that was never created.
export const WagerStatus = {
  None: 0,
  Open: 1,
  Locked: 2,
  Settled: 3,
  Refunded: 4,
  Cancelled: 5,
} as const;
