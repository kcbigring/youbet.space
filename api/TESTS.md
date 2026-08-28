API tests

This directory contains guidelines to add API tests.

Recommended stack:
- Jest + supertest for endpoint testing
- Use a test SQLite `DATABASE_URL="file:./test.db"` for Prisma migrations (or a Docker Postgres)

Example test command to add to `api/package.json`:

"test": "jest --runInBand"

Simple test skeleton (not included): create `api/tests/parse.test.ts` using supertest to exercise `/parse` endpoint.
