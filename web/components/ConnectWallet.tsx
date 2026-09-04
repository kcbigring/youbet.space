import { useEffect, useRef } from "react";
import { useWallet } from "../lib/useWallet";
import { Banner } from "./Layout";

/// Creates (or reconnects) the user's passkey-owned smart account. The passkey
/// lives in the device keychain — there is no seed phrase, and the platform
/// holds nothing it could spend from.
///
/// Registering the address with the API is deliberately not this component's
/// job: it renders only while there is no wallet, so it disappears at the exact
/// moment there is something to report. `useWallet` does it instead.
export function ConnectWallet({ onReady }: { onReady?: (address: string) => void }) {
  const { address, isConnected, signIn, connecting, error } = useWallet();
  const announced = useRef(false);

  useEffect(() => {
    if (!isConnected || !address || announced.current) return;
    announced.current = true;
    onReady?.(address);
  }, [isConnected, address, onReady]);

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
