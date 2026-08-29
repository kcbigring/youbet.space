import { useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSendCalls,
  useWaitForCallsStatus,
} from "wagmi";
import { callCapabilities, activeChain } from "./wagmi";

export interface Call {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
}

/// Wraps the smart-account connection and transaction path.
///
/// Calls go out as an EIP-5792 batch, which is what lets the paymaster sponsor
/// gas and lets several actions settle in one passkey prompt. The user signs
/// with Face ID; no key ever reaches us.
export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { sendCallsAsync, data: callsResult, isPending: sending, error: sendError } = useSendCalls();
  const { isLoading: confirming } = useWaitForCallsStatus({ id: callsResult?.id });

  /// Creates the passkey on first use and returns the smart-account address.
  const signIn = useCallback(() => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);

  const send = useCallback(
    async (calls: Call[]) => {
      const result = await sendCallsAsync({
        calls,
        chainId: activeChain.id,
        capabilities: callCapabilities,
      });
      return result.id;
    },
    [sendCallsAsync]
  );

  return {
    address,
    isConnected,
    /// True when the wallet is connected to something other than our target chain.
    wrongChain: isConnected && chainId !== activeChain.id,
    signIn,
    disconnect,
    send,
    connecting,
    busy: sending || confirming,
    error: (connectError || sendError)?.message ?? null,
  };
}
