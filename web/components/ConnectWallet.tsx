import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useWallet } from "../lib/useWallet";
import { Banner } from "./Layout";

/// Creates (or reconnects) the user's passkey-owned smart account and records
/// the address with the API. The passkey lives in the device keychain — there is
/// no seed phrase, and the platform holds nothing it could spend from.
export function ConnectWallet({ onReady }: { onReady?: (address: string) => void }) {
  const { address, isConnected, signIn, connecting, error } = useWallet();
  const [linked, setLinked] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address || linked) return;
    api
      .post("/auth/wallet", { address })
      .then(() => {
        setLinked(true);
        onReady?.(address);
      })
      .catch((err) => setLinkError(err.message));
  }, [isConnected, address, linked, onReady]);

  if (isConnected && address) {
    return (
      <div className="card">
        <div className="small muted">Your wallet</div>
        <div className="mono break small" style={{ marginTop: 4 }}>
          {address}
        </div>
        <p className="small muted" style={{ marginBottom: 0, marginTop: 8 }}>
          Secured by a passkey on this device. No seed phrase, and we cannot spend from it.
        </p>
        <Banner>{linkError}</Banner>
      </div>
    );
  }

  return (
    <div className="stack">
      <button className="block" onClick={signIn} disabled={connecting}>
        {connecting ? "Waiting for your passkey…" : "Create your wallet"}
      </button>
      <p className="small muted center">
        Uses Face ID or a fingerprint. Nothing to write down, nothing to lose.
      </p>
      <Banner>{error}</Banner>
    </div>
  );
}
