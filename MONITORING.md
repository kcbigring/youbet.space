Monitoring & Observability (basic)

- Add basic heartbeat workflow (already present) to update `HEARTBEAT.md` every 5 minutes.
- Add application-level health endpoints (`/health`) in API and readiness checks for deployments.
- Integrate Sentry or Datadog for error tracking; provide DSN as env var `SENTRY_DSN`.
- Add Prometheus metrics endpoint `/metrics` in the API for process and application metrics.

Next steps:
- Add `@sentry/node` to API and initialize when `SENTRY_DSN` present.
- Add a lightweight `/metrics` handler using `prom-client`.
