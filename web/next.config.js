/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_ORIGIN;

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Proxy the API under our own origin. This keeps requests same-origin, so
  // there is no CORS preflight on every call and no Cloud Run URL in the
  // client, and it avoids needing a separately verified api. subdomain.
  async rewrites() {
    if (!API_ORIGIN) return [];
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
  webpack: (config) => {
    // We ship one connector: Coinbase Smart Wallet, a passkey-owned ERC-4337
    // account. The connectors barrel imports every other connector too, so stub
    // their optional peer dependencies rather than installing wallets we do not
    // support. These are declared optional by @wagmi/connectors itself.
    for (const optional of [
      "@walletconnect/ethereum-provider",
      "@metamask/connect-evm",
      "@safe-global/safe-apps-provider",
      "@safe-global/safe-apps-sdk",
      "@base-org/account",
      "accounts",
    ]) {
      config.resolve.alias[optional] = false;
    }

    // Optional deps that wagmi's transitive packages probe for at runtime.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

module.exports = nextConfig;
