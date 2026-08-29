# Reminders and notifications

The execution plan (§16) puts a clock on every wager:

```
T+0     event ends
T+24h   reminder
T+48h   reminder plus bond warning
T+72h   attestation window closes — non-attesters forfeit their bond
```

Those deadlines are enforced on-chain whether or not anyone is told. The point
of these reminders is that a forfeited bond should never be a surprise: the bond
exists to create mild social pressure, not to punish someone who never heard
about it.

## How it runs

Cloud Scheduler hits `POST /jobs/reminders` **hourly**.

Hourly rather than daily, deliberately. The markers sit at 24h and 48h inside a
72-hour window, so a daily run can drift a reminder by up to a day — long enough
to deliver a "your bond is at risk" warning after the deadline it was warning
about. Hourly costs essentially nothing: Cloud Scheduler's free tier covers
three jobs and Cloud Run scales to zero.

The job:

1. Finds every participant on a `LOCKED` wager who has not attested.
2. Picks the **latest** stage that is due, so a job that was down for a day
   sends one nudge rather than three.
3. Writes `Notification` rows.
4. Dispatches whatever is undelivered.

## Why it writes before it sends

`Notification` is unique on `(userId, wagerId, kind)`. Recording first means a
retried or crashed run cannot notify the same person twice — the database
rejects the duplicate rather than the job having to reason about it.

`sentAt` is set only once a channel accepts the message, so a failed send is
retried on the next run instead of being silently dropped.

## Channels

| Channel | Status | Notes |
| --- | --- | --- |
| Console | working | Development. Prints instead of sending. |
| Web push (FCM) | not wired | Free, GCP-native, right fit for a PWA. |
| Email | not wired | The fallback that reaches everyone. |
| SMS | deliberately absent | Same A2P 10DLC queue that pushed invites to share links. |

**Web push has an iOS catch worth knowing before you rely on it.** Safari only
delivers web push to a PWA that has been *added to the home screen*. For a
friends alpha full of iPhones, a large share of users will never do that, so
push alone will quietly under-deliver. Email is the fallback that actually
reaches everyone, which is why both are listed rather than just push.

SMS would be the best channel by open rate, and reminders to opted-in users are
a far easier 10DLC registration than cold invites — worth revisiting once the
alpha proves the loop.

**Coinbase does not offer a user-messaging product**, so there is nothing to use
there. Wallet-to-wallet messaging (XMTP) exists but assumes recipients run an
XMTP client, which yours will not.

## Adding a channel

`src/lib/notify.ts` defines a `Channel` interface and tries each in order until
one accepts. Adding FCM or email means implementing `send` and adding it to
`channels()`; the job itself does not change.

## The schedule (already running)

Cloud Scheduler job `youbet-reminders`, hourly at the top of the hour,
America/Chicago:

```bash
gcloud scheduler jobs create http youbet-reminders \
  --project youbet-506923 --location us-central1 \
  --schedule "0 * * * *" --time-zone "America/Chicago" \
  --uri "https://youbet-api-843347838760.us-central1.run.app/jobs/reminders" \
  --http-method POST \
  --oidc-service-account-email youbet-scheduler@youbet-506923.iam.gserviceaccount.com \
  --oidc-token-audience "https://youbet-api-843347838760.us-central1.run.app"
```

### It authenticates by identity, not a shared secret

The Cloud Run service is public, so IAM does not gate `/jobs/*` — the check has
to happen in the app. Scheduler sends an OIDC token; `src/lib/scheduler.ts`
verifies Google's signature, that the audience is this service, and that the
caller is `youbet-scheduler@`. A leaked token expires on its own and there is no
long-lived key to rotate. The admin API key still works for triggering a run by
hand.

**Cloud Scheduler cannot mint that token without one extra grant**, which is easy
to miss because the job simply never fires and records status `-1`:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  youbet-scheduler@youbet-506923.iam.gserviceaccount.com \
  --member="serviceAccount:service-843347838760@gcp-sa-cloudscheduler.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator
```

Verify a run actually arrived:

```bash
gcloud logging read 'resource.labels.service_name="youbet-api"
  AND httpRequest.requestUrl:"/jobs/reminders"' --project youbet-506923 --limit 5
```
