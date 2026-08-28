# youbet.space — web

Mobile-first PWA for creating and settling friendly wagers. Next.js pages router,
no UI framework, styles in `styles/globals.css`.

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at the API
npm run dev
```

## Screens

| Route          | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `/signin`      | Phone + SMS code. No passwords, no seed phrases.                |
| `/`            | Home: what needs your call, open challenges, active, results.   |
| `/create`      | Natural-language input, then reviewable terms before sending.   |
| `/w/[id]`      | Challenge: terms, sides, join, attest, concede, claim, comments.|
| `/groups`      | Your groups.                                                    |
| `/groups/[id]` | Members, leaderboard, wagers, SMS invites.                      |
| `/wallet`      | Balance, embedded wallet address, monthly limit, record.        |

The session token lives in `localStorage` and is sent as a bearer token by
`lib/api.ts`. `lib/useSession.ts` redirects anyone without a live session to
`/signin`, preserving where they were headed.
