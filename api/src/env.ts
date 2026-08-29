import dotenv from "dotenv";
import path from "path";

// Load in precedence order; dotenv does not overwrite what is already set, so
// the first file to define a variable wins.
//   1. api/.env            — service-local overrides
//   2. <repo>/.env.local   — local secrets, gitignored (where Vercel CLI writes)
//   3. <repo>/.env         — shared defaults
const repoRoot = path.resolve(__dirname, "../..");
dotenv.config();
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });

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
  /// Secret mixed into one-time-code hashes. Kept separate from adminApiKey so
  /// rotating the admin key does not invalidate every pending login code.
  otpPepper: process.env.OTP_PEPPER || "youbet-dev-pepper",

  // Chain — Base is the primary network.
  chainId: num(process.env.CHAIN_ID, 84532),
  rpcUrl: process.env.BASE_RPC || process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
  /// ERC-20 the stakes are denominated in: test dollars on testnet, USDC on
  /// mainnet. Six decimals either way.
  stakeTokenAddress: process.env.STAKE_TOKEN_ADDRESS,
  /// The single WagerBook contract holding every wager.
  wagerBookAddress: process.env.WAGER_BOOK_ADDRESS || process.env.FACTORY_ADDRESS,
  groupRegistryAddress: process.env.GROUP_REGISTRY_ADDRESS,
  resolverRegistryAddress: process.env.RESOLVER_REGISTRY_ADDRESS,
  treasuryAddress: process.env.TREASURY_ADDRESS,

  // Risk controls from the execution plan.
  maxStakeCents: num(process.env.MAX_STAKE_CENTS, 10_000),
  maxPotCents: num(process.env.MAX_POT_CENTS, 50_000),
  monthlyLimitCents: num(process.env.MONTHLY_LIMIT_CENTS, 100_000),

  /// Service account Cloud Scheduler runs as. Job endpoints accept its signed
  /// OIDC token instead of a shared secret.
  schedulerServiceAccount: process.env.SCHEDULER_SERVICE_ACCOUNT,
  /// Audience the scheduler mints its token for; defaults to this service's URL.
  schedulerAudience: process.env.SCHEDULER_AUDIENCE,

  // Phone verification via Firebase. Google owns the carrier relationships, so
  // there is no A2P 10DLC registration to wait on.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  /// When on, a user must have a Firebase-verified phone before funding a wager.
  /// Off for the test-token alpha; on before real money.
  requireVerifiedPhone: process.env.REQUIRE_VERIFIED_PHONE === "true",

  // SMS. Optional — invites are share links, so nothing depends on this.
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_FROM,
  /// Off by default: invites are share links the inviter sends themselves, which
  /// avoids app-to-person messaging and the carrier registration behind it.
  sendInviteSms: process.env.SEND_INVITE_SMS === "true",

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
