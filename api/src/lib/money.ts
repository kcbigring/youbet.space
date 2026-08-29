import { env } from "../env";

/// The product speaks in dollars and so does the chain: stakes are denominated
/// in a six-decimal dollar token — test dollars on testnet, USDC on mainnet.
///
/// This used to convert cents into ETH at a fixed rate, which meant a wager
/// that said "$25" was really a fraction of ETH and stopped being $25 the moment
/// the market moved. These conversions are exact and have no rate.

const DECIMALS = 6;
const UNITS_PER_DOLLAR = 10 ** DECIMALS;

/// Cents to token base units.
export function centsToUnits(cents: number): bigint {
  return (BigInt(Math.round(cents)) * BigInt(UNITS_PER_DOLLAR)) / 100n;
}

/// Token base units back to cents.
export function unitsToCents(units: bigint): number {
  return Number((units * 100n) / BigInt(UNITS_PER_DOLLAR));
}

export const formatUsd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const stakeTokenDecimals = DECIMALS;
export const stakeTokenAddress = () => env.stakeTokenAddress;
