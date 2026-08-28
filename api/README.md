# youbet API

Express + Prisma + Postgres. Owns identity, groups, social data and reputation;
the chain owns escrow and settlement.

```bash
npm ci
cp .env.example .env
npx prisma migrate deploy
npm run dev       # http://localhost:4000
npm test
```

Runs without a chain or Twilio configured — wagers stay drafts and SMS codes are
logged to the console, so the social flow is fully testable locally.

## Auth

Phone plus a 6-digit SMS code. Codes are stored hashed with an attempt limit and
rate limiting. Verifying returns a session token; send it as
`Authorization: Bearer <token>`.

An invite code *is* a sign-in code, so a texted challenge takes a non-user from
SMS to funded participant without a separate signup.

## Endpoints

### Public

| Method | Path                 | Purpose                                    |
| ------ | -------------------- | ------------------------------------------- |
| GET    | `/health`            | Liveness.                                   |
| GET    | `/ready`             | Readiness with per-dependency detail.       |
| GET    | `/metrics`           | Prometheus metrics.                         |
| GET    | `/config`            | Chain id, factory address, limits.          |
| POST   | `/auth/request-code` | Send an SMS code.                           |
| POST   | `/auth/verify`       | Exchange a code for a session.              |

### Session required

| Method | Path                            | Purpose                                  |
| ------ | ------------------------------- | ----------------------------------------- |
| GET    | `/auth/me`                      | Current user and groups.                  |
| PATCH  | `/auth/me`                      | Update profile.                           |
| POST   | `/auth/logout`                  | Drop the session.                         |
| POST   | `/groups`                       | Create a group.                           |
| GET    | `/groups`                       | Your groups.                              |
| GET    | `/groups/:id`                   | Members and recent wagers.                |
| PATCH  | `/groups/:id`                   | Governance defaults (owner only).         |
| POST   | `/groups/:id/invites`           | Invite by SMS.                            |
| DELETE | `/groups/:id/members/:userId`   | Remove a member (owner only).             |
| GET    | `/groups/:id/leaderboard`       | Record, net winnings, attestation rate.   |
| POST   | `/wagers/parse`                 | Natural language → structured terms.      |
| POST   | `/wagers`                       | Create and deploy a wager.                |
| GET    | `/wagers`                       | Home feed, bucketed by what you owe.       |
| GET    | `/wagers/:id`                   | Detail, comments and live on-chain state. |
| POST   | `/wagers/:id/join`              | Take a side and fund it.                  |
| POST   | `/wagers/:id/decline`           | Pass on a challenge.                      |
| POST   | `/wagers/:id/attest`            | Attest to the winning side.               |
| POST   | `/wagers/:id/concede`           | Concede.                                  |
| POST   | `/wagers/:id/withdraw`          | Claim winnings, refunds and bonds.        |
| POST   | `/wagers/:id/sync`              | Re-read on-chain state.                   |
| POST   | `/wagers/:id/comments`          | Comment.                                  |
| POST   | `/wagers/:id/invites`           | Invite people by SMS.                     |
| GET    | `/users/me/wallet`              | Address, balance, monthly headroom.       |
| GET    | `/users/me/reputation`          | Your record.                              |
| GET    | `/users/:id/reputation`         | A group-mate's record.                    |

### Admin (`x-api-key`)

`GET /admin/relayer` — relayer address and balance.
`POST /admin/resolvers` — add or remove an oracle resolver.

## Natural-language parsing

`POST /wagers/parse` returns a *proposal* the user reviews before anything is
sent. With `OPENAI_API_KEY` set it uses the model and backfills any gaps from the
deterministic parser; without it, the deterministic parser handles it alone. It
never invents a stake that was not stated.

To swap providers, `api/src/lib/parse.ts` is the only file that talks to a model.

## Risk controls

Stake, pot and monthly volume limits (§9) are checked on create *and* on join,
against the stricter of the protocol limit and the group's own. The monthly limit
is per user and off-chain, since that is where user identity lives.

## Tests

```bash
npm test
```

28 tests: natural-language parsing, dollar/wei conversion, phone and OTP
handling, and the HTTP surface with Prisma stubbed.

`tests/chain.integration.test.ts` additionally drives a full wager — create,
join, attest, settle, withdraw — through the real ABIs. It needs a local node:

```bash
cd ../contracts && npx hardhat node    # in another terminal
cd ../api && npm test
```

Without a node it warns and passes, so CI stays green.
