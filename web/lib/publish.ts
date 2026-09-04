import { decodeEventLog, encodeFunctionData, toEventSelector } from "viem";
import type { SendResult } from "./useWallet";
import { api } from "./api";
import { wagerBookAbi } from "./abi";

const WAGER_CREATED = toEventSelector(
  "WagerCreated(uint256,address,uint256,bytes32,uint256,uint256,uint8)"
);

interface DeployParams {
  book: string | null;
  existingOnchainId?: number | null;
  params: Record<string, string | number>;
}

/// Reads the id the book assigned, out of the receipts of the very batch that
/// created it.
///
/// The alternative — asking the API for this account's newest wager — is a
/// guess twice over: it races inclusion, and it picks the wrong one if the same
/// account has two creates in flight. The event carries the answer exactly.
function createdWagerId(result: SendResult): number | null {
  // EIP-5792 receipts carry only address/data/topics per log, so decode by
  // hand rather than through viem's log parser, which wants full block context.
  for (const receipt of result.receipts ?? []) {
    for (const log of receipt.logs) {
      if (log.topics[0] !== WAGER_CREATED) continue;
      const decoded = decodeEventLog({
        abi: wagerBookAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      const args = decoded.args as { wagerId?: bigint };
      if (args?.wagerId !== undefined) return Number(args.wagerId);
    }
  }
  return null;
}

/// Puts a draft on-chain and links the escrow back to it.
///
/// Both halves have to happen for the wager to be real to anyone else: the
/// escrow without the link is invisible in the app, and the app record without
/// the escrow holds no money. So the create is skipped entirely when the API
/// reports the escrow already exists — a publish interrupted after the
/// transaction landed is resumed, not repeated.
export async function publishWager(
  wagerId: string,
  send: (calls: { to: `0x${string}`; data: `0x${string}` }[]) => Promise<SendResult>
): Promise<number> {
  const res = await api.get<DeployParams>(`/wagers/${wagerId}/deploy-params`);
  if (!res.book) throw new Error("Wagers are not configured on this network yet.");

  let onchainId = res.existingOnchainId ?? null;

  if (onchainId === null) {
    const { params } = res;
    const data = encodeFunctionData({
      abi: wagerBookAbi,
      functionName: "createWager",
      args: [
        {
          groupId: BigInt(params.groupId),
          termsHash: params.termsHash as `0x${string}`,
          stake: BigInt(params.stake),
          bond: BigInt(params.bond),
          ownerSplitBps: BigInt(params.ownerSplitBps),
          attestationThresholdBps: BigInt(params.attestationThresholdBps),
          fundingDeadline: BigInt(params.fundingDeadline),
          eventDeadline: BigInt(params.eventDeadline),
          resolutionDeadline: BigInt(params.resolutionDeadline),
          maxParticipants: Number(params.maxParticipants),
          resolutionMethod: Number(params.resolutionMethod),
        },
      ] as never,
    });

    const result = await send([{ to: res.book as `0x${string}`, data }]);
    onchainId = createdWagerId(result);

    // Some wallets return a status without receipts. Falling back to the
    // account's newest wager is safe here because the batch is already known
    // to have landed — the read that used to race inclusion no longer does.
    if (onchainId === null) {
      const latest = await api.get<{ onchainId: number }>("/wagers/latest-onchain-id");
      onchainId = latest.onchainId;
    }
  }

  // The API verifies the on-chain terms and creator match before linking.
  await api.post(`/wagers/${wagerId}/link`, { onchainId });
  return onchainId;
}
