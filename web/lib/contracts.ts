import { wagerBookAbi, playDollarAbi, groupRegistryAbi } from "./abi";

export { wagerBookAbi, playDollarAbi, groupRegistryAbi };

/// Stakes are denominated in a six-decimal dollar token — test dollars on
/// testnet, USDC on mainnet — so "$25" stays $25 rather than tracking ETH.
export const stakeTokenAddress = (process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS || "") as `0x${string}`;
export const hasStakeToken = /^0x[a-fA-F0-9]{40}$/.test(stakeTokenAddress);

/// One contract holds every wager, keyed by id — so there is a single address
/// for a paymaster to allowlist, which is what makes sponsored `join` possible.
export const wagerBookAddress = (process.env.NEXT_PUBLIC_WAGER_BOOK_ADDRESS || "") as `0x${string}`;

export const hasWagerBook = /^0x[a-fA-F0-9]{40}$/.test(wagerBookAddress);

/// On-chain group membership. The escrow reads this to decide whether someone
/// may open a wager inside a group, so a group has to exist here before its
/// wagers can.
export const groupRegistryAddress = (process.env.NEXT_PUBLIC_GROUP_REGISTRY_ADDRESS ||
  "") as `0x${string}`;
export const hasGroupRegistry = /^0x[a-fA-F0-9]{40}$/.test(groupRegistryAddress);

/// Mirrors WagerBook.Status on-chain. Index 0 is an id that was never created.
export const WagerStatus = {
  None: 0,
  Open: 1,
  Locked: 2,
  Settled: 3,
  Refunded: 4,
  Cancelled: 5,
} as const;
