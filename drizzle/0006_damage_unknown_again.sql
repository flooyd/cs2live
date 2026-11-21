-- Copies of CS2Live built before Nov 21 2026 still write 0 damage for matches CS2 sent no damage
-- for, and 0005 labelled those zeros 'gsi'. Same rule as 0003, safe to run again: exactly 0 damage
-- that did not come from a demo is unknown.
UPDATE "rounds" SET "damage" = NULL WHERE "match_id" IN (SELECT "id" FROM "matches" WHERE "damage" = 0 AND "damage_source" IS DISTINCT FROM 'demo');--> statement-breakpoint
UPDATE "matches" SET "damage" = NULL, "adr" = NULL, "damage_source" = NULL WHERE "damage" = 0 AND "damage_source" IS DISTINCT FROM 'demo';
