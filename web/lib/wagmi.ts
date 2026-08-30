import { createConfig, http, type Config } from "wagmi";
import { base, baseSepolia } from "viem/chains";
import { baseAccount } from "wagmi/connectors";

/// Wallets are ERC-4337 smart accounts owned by a passkey. The key lives in the
/// user's device keychain, so the platform never holds it and there is no seed
/// phrase to write down — which is what the execution plan asked for, without
/// the custody the earlier custodial design implied.

/// Both chains are registered so the deploy target is an env switch rather than
/// a code change; `activeChain` is the one the app transacts on.
export const activeChain =
  Number(process.env.NEXT_PUBLIC_CHAIN_ID || baseSepolia.id) === base.id ? base : baseSepolia;

export const config: Config = createConfig({
  chains: [baseSepolia, base],
  // We ship one wallet; scanning for injected providers only adds ways to fail.
  multiInjectedProviderDiscovery: false,
  connectors: [
    // Base Account, Coinbase's current SDK. The older wallet-sdk had to be
    // pointed at a key service by hand — production is mainnet-only, and the
    // dev host it left for testnets proved unreliable in practice. This one
    // resolves the wallet host from the chain itself.
    baseAccount({
      appName: "youbet.space",
      // The wallet host is picked per environment, not per chain: the default
      // production host serves mainnet only and answers a Base Sepolia
      // transaction with "this chain is not supported". Testnets need the dev
      // host, and the account lives on whichever host created it — so both
      // sign-up and signing have to point at the same one.
      preference:
        activeChain.id === baseSepolia.id
          ? { walletUrl: "https://keys-dev.coinbase.com/connect" }
          : undefined,
    }),
  ],
  transports: {
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL_MAINNET || undefined),
  },
  ssr: true,
});

/// Paymaster endpoint. When present, gas is sponsored and the user never needs
/// to hold the native token.
export const paymasterUrl = process.env.NEXT_PUBLIC_PAYMASTER_URL || undefined;

/// EIP-5792 capabilities passed with every batch. An absent paymaster simply
/// means the user pays their own gas rather than the call failing.
export const callCapabilities = paymasterUrl
  ? { paymasterService: { url: paymasterUrl } }
  : undefined;

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
