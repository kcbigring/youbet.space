import { createConfig, http, type Config } from "wagmi";
import { base, baseSepolia, foundry } from "viem/chains";
import { baseAccount, mock } from "wagmi/connectors";

/// Wallets are ERC-4337 smart accounts owned by a passkey. The key lives in the
/// user's device keychain, so the platform never holds it and there is no seed
/// phrase to write down — which is what the execution plan asked for, without
/// the custody the earlier custodial design implied.

/// Every chain the app can be pointed at, so the deploy target is an env switch
/// rather than a code change. `foundry` is the local node the end-to-end
/// harness runs against.
const CHAINS = { [base.id]: base, [baseSepolia.id]: baseSepolia, [foundry.id]: foundry } as const;

export const activeChain =
  CHAINS[Number(process.env.NEXT_PUBLIC_CHAIN_ID) as keyof typeof CHAINS] ?? baseSepolia;

/// A test account that signs without a passkey, for the end-to-end harness.
///
/// Coinbase's onboarding needs a real email before it will create a passkey,
/// which is where browser automation has always had to stop — and everything
/// past sign-in therefore went untested. wagmi's mock connector answers
/// `wallet_sendCalls` by forwarding each call to the chain's RPC, so a local
/// node signs for it and the batch path runs exactly as it does in production.
/// The address is overridable per browser context, because the thing worth
/// testing is two people betting against each other and a build-time constant
/// only gives you one of them. The override is read only when the build already
/// carries a test account, so it is inert everywhere else.
const testAccount = (() => {
  const configured = process.env.NEXT_PUBLIC_E2E_ACCOUNT as `0x${string}` | undefined;
  if (!configured || typeof window === "undefined") return configured;
  const override = window.localStorage.getItem("youbet.e2e.account");
  return (override as `0x${string}` | null) ?? configured;
})();

// Loud, at module load, rather than a wallet nobody owns appearing in front of
// real money. The harness only ever runs against a local node.
if (testAccount && activeChain.id !== foundry.id) {
  throw new Error(
    `NEXT_PUBLIC_E2E_ACCOUNT is set on chain ${activeChain.id}. The test wallet is only for the local node.`
  );
}

export const config: Config = createConfig({
  // The active chain goes first, and that ordering is load-bearing: a read
  // that does not name a chain uses the config's current one, which before any
  // wallet connects is simply the head of this list. With Sepolia first, every
  // contract read on mainnet went to sepolia.base.org, found no contract, and
  // returned nothing — balances and founding slots silently rendered blank.
  chains: [activeChain, ...Object.values(CHAINS).filter((c) => c.id !== activeChain.id)] as [
    typeof base,
    ...(typeof base)[],
  ],
  // We ship one wallet; scanning for injected providers only adds ways to fail.
  multiInjectedProviderDiscovery: false,
  connectors: [
    // First, so the harness connects to it rather than opening Coinbase.
    ...(testAccount
      ? [
          // `defaultConnected` and `reconnect` together model the state that
          // actually matters: a device whose passkey wallet already exists.
          // Without them the mock wallet is connected only in the tab that
          // called connect(), and forgets on the next navigation — so every
          // page after the first sees no wallet at all.
          mock({ accounts: [testAccount], features: { defaultConnected: true, reconnect: true } }),
        ]
      : []),
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
    [foundry.id]: http(),
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
