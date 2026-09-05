import { useCallback, useEffect, useState } from "react";
import { decodeEventLog, encodeFunctionData, toEventSelector } from "viem";
import { api, ApiError } from "../lib/api";
import { useWallet } from "../lib/useWallet";
import { groupRegistryAbi, groupRegistryAddress, hasGroupRegistry } from "../lib/contracts";
import { Banner } from "./Layout";
import { ConnectWallet } from "./ConnectWallet";

interface Params {
  registry: string | null;
  onchainId: number | null;
  metadataHash: `0x${string}`;
  maxStakeUnits: string;
  maxPotUnits: string;
  memberAddresses: `0x${string}`[];
}

const GROUP_CREATED = toEventSelector("GroupCreated(uint256,address,bytes32)");

/// Puts a group on-chain, and keeps its roster there.
///
/// This is not bookkeeping. `createWager` asks the registry whether the person
/// opening a group wager is a member, and reads the group's limits from it — so
/// a group that exists only in our database cannot hold a wager at all, and the
/// failure arrives as a wallet error nobody can act on.
///
/// The API signs nothing, so the owner does this from their own wallet: create
/// the group, then add everyone. Two prompts, once, and then a sync whenever
/// somebody new turns up.
export function GroupOnChain({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const wallet = useWallet();
  const [params, setParams] = useState<Params | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Params>(`/groups/${groupId}/onchain-params`)
      .then(setParams)
      .catch(() => setParams(null));
  }, [groupId]);

  useEffect(load, [load]);

  if (!hasGroupRegistry || !params) return null;

  const call = (functionName: string, args: readonly unknown[]) => ({
    to: groupRegistryAddress,
    data: encodeFunctionData({ abi: groupRegistryAbi, functionName, args } as never),
  });

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setDone(await work());
      load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  /// Adding someone already on-chain is a no-op in the registry, so this sends
  /// the whole roster rather than working out who is missing.
  const syncMembers = async (onchainId: number) => {
    const addresses = params!.memberAddresses;
    if (!addresses.length) return "Nobody has a wallet yet.";
    await wallet.send([call("addMembers", [BigInt(onchainId), addresses])]);
    return `${addresses.length} on the roster.`;
  };

  const create = () =>
    run(async () => {
      const result = await wallet.send([
        call("createGroup", [
          params!.metadataHash,
          BigInt(params!.maxStakeUnits),
          BigInt(params!.maxPotUnits),
        ]),
      ]);

      // The id comes out of the event rather than a follow-up read: the
      // registry hands out ids in order, and reading "the latest" races anyone
      // else creating one.
      let onchainId: number | null = null;
      for (const receipt of result.receipts ?? []) {
        for (const log of receipt.logs) {
          if (log.topics[0] !== GROUP_CREATED) continue;
          const decoded = decodeEventLog({
            abi: groupRegistryAbi,
            data: log.data,
            topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          });
          const args = decoded.args as { groupId?: bigint };
          if (args?.groupId !== undefined) onchainId = Number(args.groupId);
        }
      }
      if (onchainId === null) throw new Error("The group went on-chain but did not report its id.");

      await api.post(`/groups/${groupId}/link`, { onchainId });
      // The owner is not a member of their own group until they say so, which
      // would otherwise leave them unable to bet in it.
      await syncMembers(onchainId);
      return "This group is on-chain.";
    });

  if (!isOwner) {
    return params.onchainId ? null : (
      <p className="small muted">
        This group is not on-chain yet, so nobody can open a wager in it. Ask whoever owns it.
      </p>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>{params.onchainId ? "Roster on-chain" : "Put this group on-chain"}</b>
      <p className="small muted" style={{ margin: "6px 0 12px" }}>
        {params.onchainId
          ? "The escrow checks this roster before letting anyone open a wager here. Add people after they join."
          : "Until you do, nobody can open a wager in this group — the escrow checks the group's roster, not ours."}
      </p>

      {!wallet.isConnected ? (
        <ConnectWallet />
      ) : (
        <button
          className={params.onchainId ? "subtle block" : "block"}
          disabled={busy || wallet.busy}
          onClick={() =>
            params.onchainId
              ? run(() => syncMembers(params.onchainId!))
              : create()
          }
        >
          {busy
            ? "Sending…"
            : params.onchainId
              ? `Add everyone to the roster (${params.memberAddresses.length})`
              : "Put it on-chain"}
        </button>
      )}

      {done && <Banner kind="info">{done}</Banner>}
      <Banner>{error}</Banner>
    </div>
  );
}
