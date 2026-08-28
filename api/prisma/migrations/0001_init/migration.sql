-- Prisma Migrate SQL migration (skeleton)
-- Creates WagerFactory table matching schema.prisma

CREATE TABLE IF NOT EXISTS wager_factory (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  deployer TEXT NOT NULL,
  stake TEXT,
  bond TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
