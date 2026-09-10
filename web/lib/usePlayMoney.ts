import { useReadContract } from "wagmi";
import { hasStakeToken, stakeTokenAddress, playDollarAbi } from "./contracts";
import { activeChain } from "./wagmi";

/// What this account can actually stake, read from the token.
///
/// Read wherever a button is about to spend it. Backing a side is an approve
/// and a transferFrom, so an empty wallet does not fail politely: the whole
/// batch reverts with "insufficient balance", the paymaster declines to sponsor
/// an operation that was going to revert, and the wallet then blames the
/// account for having no ETH. Three misleading errors from one missing balance.
export function usePlayMoney(address?: `0x${string}`) {
  const { data, refetch } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    chainId: activeChain.id,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasStakeToken && address) },
  });

  return {
    /// Null while unknown, which is not the same as zero — a button should not
    /// be disabled because a read has not come back yet.
    cents: data === undefined ? null : Number(data as bigint) / 10_000,
    refetch,
  };
}
