# Gas sponsorship

Users never hold ETH. Every transaction they send is paid for by the CDP
Paymaster, which is why someone can arrive from a friend's text and take a bet
without knowing what gas is.

Portal: <https://portal.cdp.coinbase.com> → **youbet** project → **Paymaster**

## The three things that must all be true

Sponsorship fails silently if any one of these is missing, and the error you get
back names a different problem than the one you have. In order of how often they
bite:

### 1. Every contract in a batch is allowlisted

**Paymaster → Configuration → Contract allowlist.** Leave *Functions* empty on
each row — the contracts enforce their own access control, and restricting
selectors buys nothing (see below).

| Name | Address | Why |
| --- | --- | --- |
| youbet wagerbook | `0xaA0626d80083f8946DA6b4D45C73f42E45Df7228` | create, join, attest, concede, withdraw |
| youbet play money | `0x11B1d21d7993f1FF4187Bc940b05153695804cdF` | `drip()` and `approve()` |

**Both are required.** Joining a wager is a batch of two calls — `approve` on the
token, then `join` on the book — and a batch is only sponsored when every
contract in it is allowlisted. With only the book listed, joining fails even
though the book itself is allowed.

**These addresses change whenever the contracts are redeployed.** The token is
immutable inside `WagerBook`, so changing one moves both. After any deploy,
`deployments/base.json` has the current pair; update this table and the portal.

### 2. There is a payment method on the CDP account

Account menu → **Billing**. Mainnet sponsorship is real money, so CDP needs a
card or bank attached. Testnet is free and unlimited, which is why this only
bites after moving to mainnet.

The tell is `payment method not found` coming back from the paymaster endpoint.

### 3. The policy caps are not exhausted

**Paymaster → Configuration → Gas policy.**

| Setting | Value | Why |
| --- | --- | --- |
| Global limit | $100 / month | Bounds the worst case |
| Per user limit | $1 / month | **The one that matters** — stops one scripted account draining everything |
| Per user operations | 200 / month | Second tripwire; catches a loop faster than the dollar cap |
| Limit cycle | Monthly | Matches how the product frames volume |
| Per user operation limit | $0.25 | Caps a single pathological operation |

The **balance** and the **cap** are independent. The cap is a ceiling, not a
deposit — funding one does not set the other, and sponsorship stops at whichever
runs out first.

## What it costs

A complete two-person wager is seven sponsored operations: create, two joins,
two attestations, two withdrawals. Around 815k gas of contract calls, plus
roughly 80% again for ERC-4337 verification, paymaster validation and bundler
overhead. CDP adds a 7% markup and invoices monthly in USD.

| Base gas price | Per wager | $100 buys |
| --- | --- | --- |
| 0.011 gwei (typical) | ~$0.05 | ~2,000 wagers |
| 0.05 gwei | ~$0.22 | ~450 wagers |
| 1 gwei (congested) | ~$4.40 | ~22 wagers |

A 50-person alpha doing ten wagers each is about **$25**. Base is usually at the
top of that table; the cap is what stops a congestion spike becoming a bill.

## Wiring in the app

`NEXT_PUBLIC_PAYMASTER_URL` holds the endpoint, and it is network-specific:
`/rpc/v1/base/…` for mainnet, `/rpc/v1/base-sepolia/…` for testnet. The contract
allowlist, confusingly, is *shared* across both networks while the URL is not.

`web/lib/wagmi.ts` turns that URL into an EIP-5792 `paymasterService` capability,
and `web/lib/useWallet.ts` attaches it to every `sendCalls`. Nothing else needs
to know about it — if the URL is unset, users simply pay their own gas and the
app still works.

## Checking it

The honest test is tapping **Get play money** in the app: if it completes without
asking for ETH, everything above is right.

Endpoint reachable, and on the network you think:

```bash
curl -s -X POST "$NEXT_PUBLIC_PAYMASTER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# 0x2105 = 8453 = Base mainnet
```

Synthetic `pm_getPaymasterStubData` probes are not worth the time — sponsorship
simulates against a deployed smart account, so a hand-built UserOperation from an
EOA is rejected whether or not the config is correct. It tells you nothing.

Live spend is on the **Overview** tab as "Sponsored gas globally".

## Credits

Up to $15,000 in gas credits, with bonuses for using Coinbase Smart Wallet and
sponsoring gas — both of which this does. It is a Google Form, not something in
the portal:

<https://docs.google.com/forms/d/e/1FAIpQLScxhJxK_AC0PZ_wMgLU9M93gaxctE7x643tW6CA26CflvTlWQ/viewform>
