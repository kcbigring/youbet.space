# syntax=docker/dockerfile:1

# Built from the repository root so the build context matches cloudbuild.yaml:
#   docker build -f api/Dockerfile .
#
# Contract ABIs are committed at api/src/abi.ts and compiled into dist, so
# nothing outside api/ is needed at runtime.

FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/prisma ./prisma
RUN npx prisma generate

COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

# Drop dev dependencies from what ships.
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY api/prisma ./prisma

# Cloud Run supplies PORT; the app already honours it.
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
