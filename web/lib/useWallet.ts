import { useCallback, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSendCalls,
  useWaitForCallsStatus,
} from "wagmi";
import { createClient, custom, type EIP1193Provider } from "viem";
import { waitForCallsStatus, type WaitForCallsStatusReturnType } from "viem/actions";
import { callCapabilities, activeChain } from "./wagmi";
import { api, getToken } from "./api";

/// Addresses already reported this session. Module-level, so remounting a page
/// does not repost, and so no component owns the responsibility.
const registered = new Set<string>();

export interface Call {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
}

export type SendResult = WaitForCallsStatusReturnType;

/// Wraps the smart-account connection and transaction path.
///
/// Calls go out as an EIP-5792 batch, which is what lets the paymaster sponsor
/// gas and lets several actions settle in one passkey prompt. The user signs
/// with Face ID; no key ever reaches us.
export function useWallet() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { sendCallsAsync, data: callsResult, isPending: sending, error: sendError } = useSendCalls();
  const { isLoading: confirming } = useWaitForCallsStatus({ id: callsResult?.id });

  // Tell the API which smart account belongs to this person, wherever they
  // happen to be when the wallet connects.
  //
  // This used to live in <ConnectWallet>, which only renders while there is no
  // wallet — so connecting unmounted the very component responsible for
  // reporting the address, and whether the request went out at all came down to
  // React's scheduling. An address we never recorded is an address we cannot
  // map back to a person: that account funded a wager and the app kept showing
  // them as merely invited, because reconciliation had nothing to match on.
  useEffect(() => {
    if (!isConnected || !address || registered.has(address) || !getToken()) return;
    registered.add(address);
    api.post("/auth/wallet", { address }).catch(() => registered.delete(address));
  }, [isConnected, address]);

  /// Creates the passkey on first use and returns the smart-account address.
  const signIn = useCallback(() => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);

  /// Sends a batch and waits for it to actually land.
  ///
  /// `sendCalls` resolves as soon as the wallet accepts the batch, seconds
  /// before the bundler includes it. Returning there hands the caller a promise
  /// that looks finished while the chain still knows nothing — and every caller
  /// here reads the chain back immediately afterwards. So poll
  /// `wallet_getCallsStatus` through to inclusion and return the receipts,
  /// which carry the events the caller would otherwise have to guess at.
  const send = useCallback(
    async (calls: Call[]): Promise<SendResult> => {
      if (!connector) throw new Error("Connect a wallet first");

      const { id } = await sendCallsAsync({
        calls,
        chainId: activeChain.id,
        capabilities: callCapabilities,
      });

      // The status lives with the wallet, not the chain, so this asks the
      // connector rather than our RPC transport.
      const provider = (await connector.getProvider({
        chainId: activeChain.id,
      })) as EIP1193Provider;
      const client = createClient({ chain: activeChain, transport: custom(provider) });

      // A reverted batch is an error, not a result: without this the caller
      // carries on and reports success for a transaction that did nothing.
      return waitForCallsStatus(client, {
        id,
        pollingInterval: 1_500,
        timeout: 120_000,
        throwOnFailure: true,
      });
    },
    [connector, sendCallsAsync]
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
