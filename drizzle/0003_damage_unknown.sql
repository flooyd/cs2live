-- CS2 sends no player.state.round_totaldmg (checked against a real match, Nov 2026), so damage is
-- unknown rather than 0. Matches saved before this with no damage at all get NULL, like new ones.
UPDATE "rounds" SET "damage" = NULL WHERE "match_id" IN (SELECT "id" FROM "matches" WHERE "damage" = 0);--> statement-breakpoint
UPDATE "matches" SET "damage" = NULL, "adr" = NULL WHERE "damage" = 0;--> statement-breakpoint
COMMENT ON COLUMN "matches"."damage" IS 'DERIVED: sum of round damage over the rounds that have it. NULL = unknown: CS2 currently sends no round_totaldmg. Can miss damage dealt after death.';--> statement-breakpoint
COMMENT ON COLUMN "matches"."adr" IS 'DERIVED: damage / rounds with known damage. NULL when damage is unknown.';--> statement-breakpoint
COMMENT ON COLUMN "rounds"."damage" IS 'OBSERVED: player.state.round_totaldmg at the last own payload of the round; may miss damage after death. NULL = not sent (CS2 currently never sends it).';
