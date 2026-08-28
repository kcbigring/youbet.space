# Monitoring

## Endpoints

| Endpoint   | Use                                                                    |
| ---------- | ---------------------------------------------------------------------- |
| `/health`  | Liveness. Never touches the database, so it stays green during a DB blip. Point the container probe here. |
| `/ready`   | Readiness. Checks Postgres, the Base RPC, contract configuration and SMS. Returns 503 if any dependency is down. |
| `/metrics` | Prometheus text exposition.                                            |
| `/config`  | Client bootstrap — chain id, factory address, limits.                  |

## Metrics exposed

`youbet_users_total`, `youbet_groups_total`, `youbet_wagers_total`,
`youbet_wagers_settled_total`, `youbet_wagers_locked`,
`youbet_process_uptime_seconds`, `youbet_process_heap_bytes`.

## What to alert on

- `/ready` returning 503 for more than a minute.
- Relayer balance running low — check `GET /admin/relayer` with the admin key.
  If it empties, nobody can create a wager or attest.
- `youbet_wagers_locked` climbing while `youbet_wagers_settled_total` is flat:
  wagers are reaching their resolution window and nobody is attesting.

## Not yet wired

- Error tracking. Add `@sentry/node` and initialise it in `api/src/app.ts` when
  `SENTRY_DSN` is present.
- A reminder job for the T+24h / T+48h attestation nudges in §16 of the plan.
  The deadlines are enforced on-chain, but nobody is being reminded yet.
- Per-route latency and error-rate histograms.
