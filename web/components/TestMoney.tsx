import { useState } from "react";
import { encodeFunctionData } from "viem";
import { useWallet } from "../lib/useWallet";
import { hasStakeToken, stakeTokenAddress, testUSDAbi } from "../lib/contracts";
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

  if (!hasStakeToken || !wallet.isConnected) return null;

  async function drip() {
    setBusy(true);
    setError(null);
    try {
      await wallet.send([
        {
          to: stakeTokenAddress,
          data: encodeFunctionData({ abi: testUSDAbi, functionName: "drip", args: [] }),
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

  if (done) return <Banner kind="info">$500 in test money added.</Banner>;

  return (
    <div className="stack">
      <button className="subtle block" onClick={drip} disabled={busy || wallet.busy}>
        {busy ? "Adding…" : "Get $500 test money"}
      </button>
      <Banner>{error}</Banner>
    </div>
  );
}
