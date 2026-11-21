-- Damage can now come from the match demo (exact) as well as GSI. Matches that already have damage
-- got it from GSI (round_totaldmg; in practice only simulated data).
UPDATE "matches" SET "damage_source" = 'gsi' WHERE "damage" IS NOT NULL AND "damage_source" IS NULL;--> statement-breakpoint
COMMENT ON COLUMN "matches"."damage_source" IS 'Where damage came from. demo = OBSERVED: player_hurt events in the official match demo, enemies only, each hit capped at the victim''s remaining health. gsi = OBSERVED: player.state.round_totaldmg (current CS2 never sends it; can miss damage after death). NULL while damage is unknown.';--> statement-breakpoint
COMMENT ON COLUMN "matches"."damage" IS 'DERIVED: sum of round damage over the rounds that have it (see damage_source). NULL = unknown: CS2 sends no damage live, and no demo has been read for this match.';--> statement-breakpoint
COMMENT ON COLUMN "matches"."adr" IS 'DERIVED: damage / rounds with known damage. NULL when damage is unknown.';--> statement-breakpoint
COMMENT ON COLUMN "rounds"."damage" IS 'OBSERVED: damage to enemies in the round, from the match demo (capped at each victim''s remaining health) or from player.state.round_totaldmg; matches.damage_source says which. NULL = unknown.';
