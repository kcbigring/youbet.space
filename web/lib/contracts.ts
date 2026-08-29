import { wagerAbi, wagerFactoryAbi } from "./abi";

export { wagerAbi, wagerFactoryAbi };

export const factoryAddress = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "") as `0x${string}`;

export const hasFactory = /^0x[a-fA-F0-9]{40}$/.test(factoryAddress);

/// Mirrors Wager.Status on-chain.
export const WagerStatus = {
  Open: 0,
  Locked: 1,
  Settled: 2,
  Refunded: 3,
  Cancelled: 4,
} as const;
