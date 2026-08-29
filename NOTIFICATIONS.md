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

## Deploying the schedule

```bash
gcloud scheduler jobs create http youbet-reminders \
  --project youbet-506923 \
  --schedule "0 * * * *" \
  --uri "https://<api-url>/jobs/reminders" \
  --http-method POST \
  --headers "x-api-key=$API_KEY" \
  --location us-central1
```

Better still, drop the key and give the job a service account with an OIDC
token, then check the caller's identity instead.
