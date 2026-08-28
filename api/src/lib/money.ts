import { ethers } from "ethers";
import { env } from "../env";

/// The product speaks in dollars; the chain speaks in wei. These conversions are
/// the single place that rate is applied, so limits stay consistent end to end.

export function centsToWei(cents: number, ethUsd = env.ethUsd): bigint {
  const usd = cents / 100;
  return ethers.parseEther((usd / ethUsd).toFixed(18));
}

export function weiToCents(wei: bigint, ethUsd = env.ethUsd): number {
  const eth = Number(ethers.formatEther(wei));
  return Math.round(eth * ethUsd * 100);
}

export const formatUsd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
