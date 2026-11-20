CREATE TABLE "kill_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"weapon" text,
	"headshot" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recorder_steam_id" text NOT NULL,
	"game_id" uuid,
	"map" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"status" text NOT NULL,
	"result" text NOT NULL,
	"joined_mid_match" boolean DEFAULT false NOT NULL,
	"first_round" integer DEFAULT 1 NOT NULL,
	"my_team_start" text,
	"score_mine" integer NOT NULL,
	"score_theirs" integer NOT NULL,
	"kills" integer NOT NULL,
	"assists" integer NOT NULL,
	"deaths" integer NOT NULL,
	"mvps" integer NOT NULL,
	"score" integer NOT NULL,
	"hs_kills" integer NOT NULL,
	"damage" integer NOT NULL,
	"rounds_played" integer NOT NULL,
	"adr" real,
	"hs_pct" real,
	"kd" real,
	"round_wins" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gsi_version" integer,
	"app_version" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('complete', 'incomplete')),
	CONSTRAINT "matches_result_check" CHECK ("matches"."result" in ('win', 'loss', 'tie', 'incomplete')),
	CONSTRAINT "matches_side_check" CHECK ("matches"."my_team_start" is null or "matches"."my_team_start" in ('CT', 'T'))
);
--> statement-breakpoint
CREATE TABLE "players" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"match_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"my_side" text,
	"winner_side" text,
	"win_reason" text,
	"i_won" boolean,
	"bomb" text,
	"kills" integer NOT NULL,
	"hs_kills" integer NOT NULL,
	"damage" integer NOT NULL,
	"assists" integer NOT NULL,
	"survived" boolean,
	"health_end" integer,
	"money_freeze_start" integer,
	"money_freeze_end" integer,
	"money_end" integer,
	"equip_value" integer,
	"weapons_freeze_end" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_weapon" text,
	"buy_type" text,
	"mvp" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_s" real,
	"partial" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rounds_match_id_number_pk" PRIMARY KEY("match_id","number"),
	CONSTRAINT "rounds_buy_type_check" CHECK ("rounds"."buy_type" is null or "rounds"."buy_type" in ('pistol', 'eco', 'force', 'full', 'save'))
);
--> statement-breakpoint
CREATE TABLE "sightings" (
	"match_id" uuid NOT NULL,
	"steam_id" text NOT NULL,
	"name" text,
	"side" text,
	"teammate" boolean,
	"kills" integer,
	"assists" integer,
	"deaths" integer,
	"mvps" integer,
	"score" integer,
	"first_round" integer,
	"last_round" integer,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sightings_match_id_steam_id_pk" PRIMARY KEY("match_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "steam_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"upload_key_hash" text,
	"upload_key_prefix" text,
	"key_created_at" timestamp with time zone,
	"last_upload_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steam_links_steam_id_unique" UNIQUE("steam_id"),
	CONSTRAINT "steam_links_upload_key_hash_unique" UNIQUE("upload_key_hash")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kill_events" ADD CONSTRAINT "kill_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_recorder_steam_id_players_steam_id_fk" FOREIGN KEY ("recorder_steam_id") REFERENCES "public"."players"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "sightings_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "sightings_steam_id_players_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."players"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_links" ADD CONSTRAINT "steam_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kill_events_match_idx" ON "kill_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "kill_events_weapon_idx" ON "kill_events" USING btree ("weapon");--> statement-breakpoint
CREATE INDEX "matches_recorder_started_idx" ON "matches" USING btree ("recorder_steam_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_started_idx" ON "matches" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_map_idx" ON "matches" USING btree ("map");--> statement-breakpoint
CREATE INDEX "matches_game_idx" ON "matches" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "players_name_idx" ON "players" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "raw_payloads_received_idx" ON "raw_payloads" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "raw_payloads_match_idx" ON "raw_payloads" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "rounds_buy_type_idx" ON "rounds" USING btree ("buy_type");--> statement-breakpoint
CREATE INDEX "sightings_steam_idx" ON "sightings" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");