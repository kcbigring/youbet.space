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
export function TestMoney({
  onFunded,
  /// The wallet page prints the balance in 30px type directly above this, so it
  /// is the one place that does not want it repeated.
  showBalance = true,
}: {
  onFunded?: () => void;
  showBalance?: boolean;
}) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Says what this account would get before it commits, including its place in
  // the founding hundred.
  const enabled = Boolean(hasStakeToken && wallet.address);
  const { data: preview, refetch: refetchPreview } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    functionName: "previewDrip",
    args: wallet.address ? [wallet.address] : undefined,
    query: { enabled },
  });

  // What they hold right now. Read from the token rather than our API: this
  // sits next to the button that changes it, so it has to be the same source
  // the drip writes to or the two disagree for as long as the API lags.
  const { data: held, refetch: refetchBalance } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    functionName: "balanceOf",
    args: wallet.address ? [wallet.address] : undefined,
    query: { enabled },
  });

  const [amount, position, bonus] = (preview as readonly bigint[] | undefined) ?? [];
  const dollars = (v?: bigint) => (v == null ? null : Number(v) / 1e6);
  const total = dollars(amount);
  const bonusUsd = dollars(bonus);
  const balance = dollars(held as bigint | undefined);

  /// Whole dollars unless there are cents to show — play money lands on round
  /// numbers, and "$10,500.00" is harder to read at a glance than "$10,500".
  const money = (v: number) =>
    `$${v.toLocaleString(undefined, { maximumFractionDigits: v % 1 === 0 ? 0 : 2 })}`;

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
      await Promise.all([refetchBalance(), refetchPreview()]);
      onFunded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/already dripped/i.test(message) ? "You already topped up today." : message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const added = bonusUsd && total ? `${money(total)} added — you're number ${position} to join.` : "Play money added.";
    return (
      <Banner kind="info">
        {showBalance && balance != null ? `${added} You have ${money(balance)}.` : added}
      </Banner>
    );
  }

  return (
    <div className="stack">
      {showBalance && balance != null && (
        <div className="between small">
          <span className="muted">Your play money</span>
          <b>{money(balance)}</b>
        </div>
      )}
      <button className="subtle block" onClick={drip} disabled={busy || wallet.busy}>
        {busy
          ? "Adding…"
          : total
            ? `Get ${money(total)} ${balance ? "more " : ""}to play with`
            : "Get play money"}
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
