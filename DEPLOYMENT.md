# Deployment

| Piece | Where | URL |
| --- | --- | --- |
| Web | Vercel (`youbet-space`) | https://youbet.space |
| API | Cloud Run (`youbet-506923`, us-central1) | https://youbet-api-843347838760.us-central1.run.app |
| Database | Neon (via Vercel integration) | pooled at runtime, direct for migrations |
| Contracts | Base Sepolia | `WagerBook` `0x3Ea3E96189f89C6b198739586C899E2436A16CfA` |

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

## The API is not public yet

The org policy `constraints/iam.allowedPolicyMemberDomains` restricts IAM
members to customer `C02k4bkpt`, so `allUsers` cannot be granted
`roles/run.invoker` and Cloud Run refuses anonymous traffic. The service is
deployed and healthy — `/ready` is green on database, chain, contracts and phone
verification — but only reachable with an identity token.

Project `owner` is not enough to override this; it needs
`roles/orgpolicy.policyAdmin` at organization `319787393607`. Someone with that
role should add a project-scoped exception:

**Console** → IAM & Admin → Organization Policies → *Domain restricted sharing*
→ Manage policy → scope to `youbet-506923` → Override parent's policy → Allow All.

Or:

```bash
gcloud org-policies set-policy policy.yaml --project youbet-506923
# policy.yaml:
#   name: projects/youbet-506923/policies/iam.allowedPolicyMemberDomains
#   spec: { inheritFromParent: false, rules: [{ allowAll: true }] }
```

Then:

```bash
gcloud run services add-iam-policy-binding youbet-api \
  --region us-central1 --project youbet-506923 \
  --member=allUsers --role=roles/run.invoker
```

Until that lands, https://youbet.space loads but every API call fails.

## Reminders

Once the API is public, schedule the attestation nudges — see
[NOTIFICATIONS.md](NOTIFICATIONS.md).
