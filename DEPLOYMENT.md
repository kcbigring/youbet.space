# Deployment

| Piece | Where | URL |
| --- | --- | --- |
| Web | Vercel (`youbet-space`) | https://youbet.space |
| API | Cloud Run (`youbet-506923`, us-central1) | https://youbet-api-843347838760.us-central1.run.app |
| Database | Neon (via Vercel integration) | pooled at runtime, direct for migrations |
| Contracts | Base mainnet | `WagerBook` `0xaA0626d80083f8946DA6b4D45C73f42E45Df7228` |

## Web

The Vercel project's **Framework Preset was "Other"**, which meant Vercel built
Next.js correctly and then served the directory as static files — every route
404'd while the build log looked perfect. It is now set to `nextjs`. If routes
start 404ing after a settings change, check that first.

```bash
cd web && vercel deploy --prod --yes
vercel alias set <deployment-url> youbet.space
```

`youbet.space` is registered through Vercel and on Vercel nameservers, so DNS
needs nothing.

## API

Built from the repository root because the image needs `api/` alone — contract
ABIs are committed to `api/src/abi.ts` rather than read from Hardhat's
gitignored build output.

```bash
gcloud builds submit --project youbet-506923 --region us-central1 \
  --config cloudbuild.yaml --substitutions SHORT_SHA=$(git rev-parse --short HEAD) .

gcloud run deploy youbet-api --project youbet-506923 --region us-central1 \
  --image us-central1-docker.pkg.dev/youbet-506923/youbet/api:latest \
  --service-account youbet-api@youbet-506923.iam.gserviceaccount.com \
  --env-vars-file <(...) --set-secrets "DATABASE_URL=database-url:latest,..."
```

Secrets live in Secret Manager (`database-url`, `direct-url`, `api-key`,
`otp-pepper`, `openai-api-key`) and are mounted as environment variables. The
service account has `secretAccessor` on each.

**`DEPLOYER_PRIVATE_KEY` is deliberately not deployed.** Since users hold their
own passkey wallets, the API signs nothing — the relayer key is only needed to
deploy contracts and manage resolvers, both of which are run locally. The
`/admin/relayer` and `/admin/resolvers` endpoints therefore return 503 in
production, which is the correct trade.

## Public access

The org policy `constraints/iam.allowedPolicyMemberDomains` restricted IAM
members to one Workspace customer, so `allUsers` could not be granted
`roles/run.invoker`. Resolved with a project-scoped override — **Replace**, not
merge: merging leaves the parent's restriction in force, which is the thing that
was blocking it.

That override removes domain-restricted sharing for everything in
`youbet-506923`, not just Cloud Run, so the project is worth keeping narrow.

IAM enforcement of the change lags the policy write by a minute or two; the
binding fails with `FAILED_PRECONDITION` until it catches up.

```bash
gcloud run services add-iam-policy-binding youbet-api \
  --region us-central1 --project youbet-506923 \
  --member=allUsers --role=roles/run.invoker
```

## Sign-in in production

`smsEnabled` is false — Twilio is not configured — and the API correctly
withholds the development one-time code outside development. Together that
would have made the front door unusable: no code sent, none returned.

Sign-in therefore runs on Identity Platform, where Google delivers the SMS.
`/signin` uses Firebase when `NEXT_PUBLIC_FIREBASE_API_KEY` is set and falls
back to the API's own codes locally, where Firebase is not configured. Invite
links never needed SMS at all.

## Reminders

Once the API is public, schedule the attestation nudges — see
[NOTIFICATIONS.md](NOTIFICATIONS.md).
