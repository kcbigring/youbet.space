-- How many people can take a side in a wager.
--
-- The contract locks a wager the moment it fills and refuses anyone after, so
-- the number has to be settled before it goes on-chain. It used to be derived
-- at publish time from however many participants the draft happened to have,
-- which is always the creator alone — so every wager was capped at two and a
-- three-way bet could not be created.
--
-- Additive with a default, so existing rows keep the behaviour they had.
ALTER TABLE "Wager" ADD COLUMN "maxParticipants" INTEGER NOT NULL DEFAULT 2;
