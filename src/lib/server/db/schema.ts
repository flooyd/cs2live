// Drizzle schema. Column comments (what is inferred / estimated / partial) are added in a
// custom migration, since drizzle has no column-comment API: see drizzle/*_column_comments.sql.
import { sql } from 'drizzle-orm';
import {
	bigserial,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import type { WeaponSnap } from '#lib/match-record.ts';
import { user } from './auth.schema.ts';

export * from './auth.schema.ts';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Everyone we know by Steam ID: recorders and players seen as partial sightings. */
export const players = pgTable(
	'players',
	{
		steamId: text('steam_id').primaryKey(),
		name: text('name'),
		firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
		lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
		/** Last time this player uploaded/recorded a match of their own. */
		lastRecordedAt: tstz('last_recorded_at')
	},
	(t) => [index('players_name_idx').on(sql`lower(${t.name})`)]
);

/** One recording of a match, by one player (the recorder). */
export const matches = pgTable(
	'matches',
	{
		id: uuid('id').primaryKey(),
		recorderSteamId: text('recorder_steam_id')
			.notNull()
			.references(() => players.steamId),
		/** Recordings believed to be of the same game (several friends recording) share this. */
		gameId: uuid('game_id'),
		map: text('map').notNull(),
		mode: text('mode').notNull(),
		startedAt: tstz('started_at').notNull(),
		endedAt: tstz('ended_at').notNull(),
		durationS: integer('duration_s').notNull(),
		status: text('status').notNull(),
		result: text('result').notNull(),
		joinedMidMatch: boolean('joined_mid_match').notNull().default(false),
		firstRound: integer('first_round').notNull().default(1),
		myTeamStart: text('my_team_start'),
		scoreMine: integer('score_mine').notNull(),
		scoreTheirs: integer('score_theirs').notNull(),
		kills: integer('kills').notNull(),
		assists: integer('assists').notNull(),
		deaths: integer('deaths').notNull(),
		mvps: integer('mvps').notNull(),
		score: integer('score').notNull(),
		hsKills: integer('hs_kills').notNull(),
		damage: integer('damage').notNull(),
		roundsPlayed: integer('rounds_played').notNull(),
		adr: real('adr'),
		hsPct: real('hs_pct'),
		kd: real('kd'),
		roundWins: jsonb('round_wins').$type<Record<string, string>>().notNull().default({}),
		gsiVersion: integer('gsi_version'),
		appVersion: text('app_version'),
		/** direct (written by a local copy with DATABASE_URL) or upload (through /api/upload). */
		source: text('source').notNull(),
		createdAt: tstz('created_at').notNull().defaultNow(),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [
		index('matches_recorder_started_idx').on(t.recorderSteamId, t.startedAt.desc()),
		index('matches_started_idx').on(t.startedAt.desc()),
		index('matches_map_idx').on(t.map),
		index('matches_game_idx').on(t.gameId),
		check('matches_status_check', sql`${t.status} in ('complete', 'incomplete')`),
		check('matches_result_check', sql`${t.result} in ('win', 'loss', 'tie', 'incomplete')`),
		check('matches_side_check', sql`${t.myTeamStart} is null or ${t.myTeamStart} in ('CT', 'T')`)
	]
);

export const rounds = pgTable(
	'rounds',
	{
		matchId: uuid('match_id')
			.notNull()
			.references(() => matches.id, { onDelete: 'cascade' }),
		number: integer('number').notNull(),
		mySide: text('my_side'),
		winnerSide: text('winner_side'),
		winReason: text('win_reason'),
		iWon: boolean('i_won'),
		bomb: text('bomb'),
		kills: integer('kills').notNull(),
		hsKills: integer('hs_kills').notNull(),
		damage: integer('damage').notNull(),
		assists: integer('assists').notNull(),
		survived: boolean('survived'),
		healthEnd: integer('health_end'),
		moneyFreezeStart: integer('money_freeze_start'),
		moneyFreezeEnd: integer('money_freeze_end'),
		moneyEnd: integer('money_end'),
		equipValue: integer('equip_value'),
		weaponsFreezeEnd: jsonb('weapons_freeze_end').$type<WeaponSnap[]>().notNull().default([]),
		primaryWeapon: text('primary_weapon'),
		buyType: text('buy_type'),
		mvp: boolean('mvp').notNull().default(false),
		startedAt: tstz('started_at'),
		liveAt: tstz('live_at'),
		endedAt: tstz('ended_at'),
		durationS: real('duration_s'),
		partial: boolean('partial').notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.matchId, t.number] }),
		index('rounds_buy_type_idx').on(t.buyType),
		check(
			'rounds_buy_type_check',
			sql`${t.buyType} is null or ${t.buyType} in ('pistol', 'eco', 'force', 'full', 'save')`
		)
	]
);

/** Best-effort, INFERRED kill events (from round_kills / round_killhs deltas). */
export const killEvents = pgTable(
	'kill_events',
	{
		id: serial('id').primaryKey(),
		matchId: uuid('match_id')
			.notNull()
			.references(() => matches.id, { onDelete: 'cascade' }),
		round: integer('round').notNull(),
		at: tstz('at').notNull(),
		weapon: text('weapon'),
		headshot: boolean('headshot').notNull()
	},
	(t) => [
		index('kill_events_match_idx').on(t.matchId),
		index('kill_events_weapon_idx').on(t.weapon)
	]
);

/** PARTIAL: other players the recorder spectated while dead, with their stats as last seen. */
export const sightings = pgTable(
	'sightings',
	{
		matchId: uuid('match_id')
			.notNull()
			.references(() => matches.id, { onDelete: 'cascade' }),
		steamId: text('steam_id')
			.notNull()
			.references(() => players.steamId),
		name: text('name'),
		side: text('side'),
		teammate: boolean('teammate'),
		kills: integer('kills'),
		assists: integer('assists'),
		deaths: integer('deaths'),
		mvps: integer('mvps'),
		score: integer('score'),
		firstRound: integer('first_round'),
		lastRound: integer('last_round'),
		lastSeenAt: tstz('last_seen_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.matchId, t.steamId] }),
		index('sightings_steam_idx').on(t.steamId)
	]
);

/** Optional raw GSI payloads (STORE_RAW_PAYLOADS=1, direct mode) for reprocessing. */
export const rawPayloads = pgTable(
	'raw_payloads',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		matchId: uuid('match_id'),
		receivedAt: tstz('received_at').notNull(),
		payload: jsonb('payload').notNull()
	},
	(t) => [
		index('raw_payloads_received_idx').on(t.receivedAt),
		index('raw_payloads_match_idx').on(t.matchId)
	]
);

/** A site account's claimed Steam ID and upload key (only a hash of the key is stored). */
export const steamLinks = pgTable('steam_links', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	steamId: text('steam_id').notNull().unique(),
	uploadKeyHash: text('upload_key_hash').unique(),
	/** First characters of the key, so the account page can show which key is active. */
	uploadKeyPrefix: text('upload_key_prefix'),
	keyCreatedAt: tstz('key_created_at'),
	lastUploadAt: tstz('last_upload_at'),
	createdAt: tstz('created_at').notNull().defaultNow()
});
