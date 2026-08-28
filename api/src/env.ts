import dotenv from "dotenv";
import path from "path";

// Load the repo-root .env first, then any api-local override.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: num(process.env.PORT, 4000),
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()),

  databaseUrl: process.env.DATABASE_URL,
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 30),

  // Admin-only endpoints (contract deploys, resolver management).
  adminApiKey: process.env.API_KEY,

  // Chain — Base is the primary network.
  chainId: num(process.env.CHAIN_ID, 84532),
  rpcUrl: process.env.BASE_RPC || process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
  factoryAddress: process.env.FACTORY_ADDRESS,
  groupRegistryAddress: process.env.GROUP_REGISTRY_ADDRESS,
  resolverRegistryAddress: process.env.RESOLVER_REGISTRY_ADDRESS,
  treasuryAddress: process.env.TREASURY_ADDRESS,
  /// USD per native token, used to convert the product's cent-denominated limits.
  ethUsd: num(process.env.ETH_USD, 3000),

  // Risk controls from the execution plan.
  maxStakeCents: num(process.env.MAX_STAKE_CENTS, 10_000),
  maxPotCents: num(process.env.MAX_POT_CENTS, 50_000),
  monthlyLimitCents: num(process.env.MONTHLY_LIMIT_CENTS, 100_000),

  // SMS
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_FROM,

  // Natural-language wager parsing.
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",

  appUrl: process.env.APP_URL || "https://youbet.space",
} as const;

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable for "${String(key)}"`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
