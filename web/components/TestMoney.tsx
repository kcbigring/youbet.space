import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { useReadContract } from "wagmi";
import { useWallet } from "../lib/useWallet";
import { hasStakeToken, stakeTokenAddress, playDollarAbi } from "../lib/contracts";
import { Banner } from "./Layout";

/// Test money for the alpha. The plan calls for handing everyone play funds and
/// letting them bet on whatever they normally argue about; this is that, and it
/// disappears on mainnet where the token is real USDC and this contract is not
/// deployed.
export function TestMoney({ onFunded }: { onFunded?: () => void }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Says what this account would get before it commits, including its place in
  // the founding hundred.
  const { data: preview } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    functionName: "previewDrip",
    args: wallet.address ? [wallet.address] : undefined,
    query: { enabled: Boolean(hasStakeToken && wallet.address) },
  });

  const [amount, position, bonus] = (preview as readonly bigint[] | undefined) ?? [];
  const dollars = (v?: bigint) => (v == null ? null : Number(v) / 1e6);
  const total = dollars(amount);
  const bonusUsd = dollars(bonus);

  if (!hasStakeToken || !wallet.isConnected) return null;

  async function drip() {
    setBusy(true);
    setError(null);
    try {
      await wallet.send([
        {
          to: stakeTokenAddress,
          data: encodeFunctionData({ abi: playDollarAbi, functionName: "drip", args: [] }),
        },
      ]);
      setDone(true);
      onFunded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/already dripped/i.test(message) ? "You already topped up today." : message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Banner kind="info">
        {bonusUsd ? `$${total?.toLocaleString()} added — you're number ${position} to join.` : "Play money added."}
      </Banner>
    );
  }

  return (
    <div className="stack">
      <button className="subtle block" onClick={drip} disabled={busy || wallet.busy}>
        {busy ? "Adding…" : total ? `Get $${total.toLocaleString()} to play with` : "Get play money"}
      </button>
      {bonusUsd ? (
        <p className="small muted" style={{ margin: 0 }}>
          You&rsquo;d be <b style={{ color: "var(--accent)" }}>number {String(position)}</b> — the first
          100 get a founding bonus, and the first 10 get ten times it.
        </p>
      ) : null}
      <Banner>{error}</Banner>
    </div>
  );
}
