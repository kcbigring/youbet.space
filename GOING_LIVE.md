# Going live on Base Sepolia

Four steps. The whole thing costs less than a tenth of a cent in gas.

Check where you stand at any point:

```bash
cd contracts && npm run status
```

---

## 1. Fund the deployer

**Address:** `0x7651597885567cbBCAc344C6139bBB057d5C9E47`

This key deploys the platform's four contracts. It never signs for a user —
users hold their own passkey-owned smart accounts.

Deploying all four costs **~0.00006 ETH** at the current 0.011 gwei. Any faucet
gives 0.05–0.1 ETH, which is roughly a thousand deploys. One drip is plenty.

### Option A — Coinbase Developer Platform (you already have an account)

1. Go to <https://portal.cdp.coinbase.com/products/faucet>
2. Network: **Base Sepolia**. Token: **ETH**
3. Paste `0x7651597885567cbBCAc344C6139bBB057d5C9E47`
4. Request. Limit is 0.1 ETH per day, no mainnet balance required.

### Option B — Alchemy

<https://www.alchemy.com/faucets/base-sepolia> — requires ≥0.001 ETH on
Ethereum mainnet in the connected wallet, as anti-sybil.

### Option C — bridge from Sepolia

If you already hold Sepolia ETH: <https://superbridge.app/base-sepolia>.
Slower (a few minutes), but no faucet limits.

### Or from the command line

Once you have a secret API key from the `youbet` project in `.env.local`:

```bash
cd contracts && npm run faucet
```

### Confirm it landed

```bash
cd contracts && npm run status
```

Should print a non-zero balance and `READY`.

---

## 2. Deploy

```bash
cd contracts
npm run compile
npm run deploy:base
```

This deploys `Treasury`, `GroupRegistry`, `ResolverRegistry` and `WagerFactory`,
writes `deployments/base_sepolia.json`, and then **syncs the addresses into your
env files automatically** — `FACTORY_ADDRESS` and friends into `.env.local`,
`NEXT_PUBLIC_FACTORY_ADDRESS` into `web/.env.local`. Nothing to copy by hand.

Risk limits are applied at deploy time from the execution plan: $100 max per
person per wager, $500 max pot, converted at `DEPLOY_ETH_USD` (default 3000).

### Verify

```bash
npm run status          # lists the deployed addresses
```

Optionally publish source to Basescan (set `BASESCAN_API_KEY` first):

```bash
npx hardhat verify --network base_sepolia <factory-address> \
  <owner> <treasury> <groupRegistry> <resolverRegistry> <maxStakeWei> <maxPotWei>
```

---

## 3. Restart and try it

```bash
cd api && npm run dev        # /ready should now show contracts ok
cd web && npm run dev
```

Open <http://localhost:3000>, sign in, create a wager. The first time you fund
one, the browser will ask you to create a passkey — that is your smart account
being created. Nothing to write down.

---

## 4. Paymaster (gas sponsorship)

Optional. Without it everything works; users just pay their own gas, which on
testnet is free from the faucet.

1. <https://portal.cdp.coinbase.com> → **Paymaster**
2. Select **Base Sepolia**, enable it
3. Copy the RPC endpoint. It looks like
   `https://api.developer.coinbase.com/rpc/v1/base-sepolia/<TOKEN>`
4. Put it in `web/.env.local`:

   ```
   NEXT_PUBLIC_PAYMASTER_URL="https://api.developer.coinbase.com/rpc/v1/base-sepolia/<TOKEN>"
   ```

5. Restart `next dev`.

### Read this before you configure the policy

CDP's paymaster sponsors calls to **allowlisted contract addresses**. Our
architecture deploys a brand-new `Wager` contract for every wager, so:

- `createWager` on the factory — one fixed address, allowlists fine.
- `join`, `attest`, `concede`, `withdraw` — a **different address every wager**,
  so they cannot be allowlisted ahead of time.

That means sponsorship silently covers wager *creation* and nothing else. The
workaround is adding each new wager address to the policy via the CDP API right
after it is created, which is fragile and racy.

The real fix is architectural, and it pays for itself twice — see
[the note in contracts/README.md](contracts/README.md#one-contract-per-wager).

---

## About your Coinbase keys

`keys/cdp_api_key_*.json` and `BASE_API_KEY*` return **401 Unauthorized** on
every CDP Platform call. The id/secret pairs are correctly matched, so this is
not a transcription problem — they are the wrong product.

Those keys live in the **Coinbase Sandbox**, and their scopes are
`Account (Custodial)`, `Transfers`, `Customers` and `Orders`. Those are
Coinbase business/commerce permissions. The faucet, paymaster and wallet APIs
are **CDP Platform**, a separate product with separate keys and separate scopes.

Your real project is **youbet** (`272f4a0c-c072-4b8e-9408-bb6b26774de4`),
recorded as `CDP_PROJECT_ID` in `.env.local`. A project ID identifies a project
but authenticates nothing — the SDK takes only an API key id and secret.

To get keys that work:

1. In the Coinbase portal, use the environment dropdown next to your name
   (currently showing **Sandbox**) and switch to the **youbet** project.
2. **API Keys** → *Create secret API key*.
3. Put them in `.env.local` as `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`
   (already stubbed there).

Then `npm run faucet` works, and the same project is where you enable the
paymaster.

The **web faucet in step 1 needs no keys at all** — it is the fastest path and
does not depend on any of this. Sort the keys out only when you want the
paymaster.

One naming note: the sandbox key is called `YOUBET_OPENAI_KEY_STAGING`, which is
a Coinbase key, not an OpenAI one. Worth renaming before it confuses someone.
