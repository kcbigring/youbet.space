# youbet API

Minimal TypeScript Express API. Run locally:

```bash
cd api
npm install
npm run dev
```

Endpoints:
- `GET /health` — healthcheck
- `POST /wagers` — placeholder to create wager metadata

Sensitive endpoints (deploy/create) require an API key via the `x-api-key` header or `Authorization: Bearer <key>`. Set `API_KEY` in your environment.

Endpoints:
 - `GET /health` — healthcheck
 - `POST /wagers` — placeholder to create wager metadata
 - `POST /deploy` — deploys `WagerFactory` (protected)
 - `POST /factory/:factoryAddress/create-wager` — creates a `Wager` via factory (protected)
# API backend (placeholder)

This folder will contain the Node.js/TypeScript backend: user accounts, groups, invitations, and Postgres schema.

Suggested start:

```bash
cd api
npm init -y
```
