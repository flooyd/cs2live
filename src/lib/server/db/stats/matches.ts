// Match lists and the match page. Aggregation and dedupe happen here, in SQL.
import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { killEvents, matches, players, rounds, sightings } from '../schema.ts';
import { PAGE_SIZE, periodStart, type MatchFilters } from '#lib/match-filters.ts';

export interface MatchListRow {
	id: string;
	gameId: string;
	map: string;
	mode: string;
	startedAt: Date;
	durationS: number;
	status: string;
	/** From the listed player's point of view; null when unknown (sighting with no side). */
	result: string | null;
	scoreMine: number;
	scoreTheirs: number;
	kills: number | null;
	assists: number | null;
	deaths: number | null;
	adr: number | null;
	hsPct: number | null;
	recorderSteamId: string;
	recorderName: string | null;
	/** recorded = their own recording; sighting = PARTIAL, seen in someone else's recording. */
	kind: 'recorded' | 'sighting';
	/** For sightings: on the recorder's team (true), against them (false), unknown (null). */
	teammate: boolean | null;
	/** Recordings of this game (global list). */
	recordings: number;
}

export interface Page<T> {
	rows: T[];
	total: number;
	page: number;
	pages: number;
}

type Row = Record<string, unknown> & { total: number };

function toRow(r: Record<string, unknown>): MatchListRow {
	const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
	return {
		id: String(r.id),
		gameId: String(r.game_id ?? r.id),
		map: String(r.map),
		mode: String(r.mode),
		startedAt: new Date(String(r.started_at)),
		durationS: Number(r.duration_s),
		status: String(r.status),
		result: typeof r.result === 'string' ? r.result : null,
		scoreMine: Number(r.score_mine),
		scoreTheirs: Number(r.score_theirs),
		kills: n(r.kills),
		assists: n(r.assists),
		deaths: n(r.deaths),
		adr: n(r.adr),
		hsPct: n(r.hs_pct),
		recorderSteamId: String(r.recorder_steam_id),
		recorderName: typeof r.recorder_name === 'string' ? r.recorder_name : null,
		kind: r.kind === 'sighting' ? 'sighting' : 'recorded',
		teammate: r.teammate === null || r.teammate === undefined ? null : Boolean(r.teammate),
		recordings: Number(r.recordings ?? 1)
	};
}

function page<T>(rows: Row[], f: MatchFilters, map: (r: Row) => T): Page<T> {
	const total = rows[0] ? Number(rows[0].total) : 0;
	return {
		rows: rows.map(map),
		total,
		page: f.page,
		pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
	};
}

/** Filters applied to the unified rows (columns: map, mode, result, started_at). */
function where(f: MatchFilters, opts: { result: boolean }): SQL {
	const parts: SQL[] = [sql`true`];
	if (f.map) parts.push(sql`map = ${f.map}`);
	if (f.mode) parts.push(sql`mode = ${f.mode}`);
	if (opts.result && f.result) parts.push(sql`result = ${f.result}`);
	const from = periodStart(f.period);
	if (from) parts.push(sql`started_at >= ${from.toISOString()}::timestamptz`);
	return sql.join(parts, sql` and `);
}

/**
 * A player's matches: their own recordings plus (optionally) PARTIAL sightings in other
 * people's recordings. A game they recorded themselves is never listed again as a sighting,
 * and a game several recorders spectated them in is listed once.
 */
export async function playerMatches(
	db: Db,
	steamId: string,
	f: MatchFilters
): Promise<Page<MatchListRow>> {
	const rows = await db.execute<Row>(sql`
		with own as (
			select m.id, m.game_id, m.map, m.mode, m.started_at, m.duration_s, m.status, m.result,
				m.score_mine, m.score_theirs, m.kills, m.assists, m.deaths, m.adr, m.hs_pct,
				m.recorder_steam_id, null::text as recorder_name, 'recorded'::text as kind,
				null::boolean as teammate
			from matches m
			where m.recorder_steam_id = ${steamId}
		),
		seen as (
			select distinct on (coalesce(m.game_id, m.id))
				m.id, m.game_id, m.map, m.mode, m.started_at, m.duration_s, m.status,
				case
					when s.teammate then m.result
					when not s.teammate then case m.result when 'win' then 'loss' when 'loss' then 'win' else m.result end
				end as result,
				case when s.teammate = false then m.score_theirs else m.score_mine end as score_mine,
				case when s.teammate = false then m.score_mine else m.score_theirs end as score_theirs,
				s.kills, s.assists, s.deaths, null::real as adr, null::real as hs_pct,
				m.recorder_steam_id, p.name as recorder_name, 'sighting'::text as kind, s.teammate
			from sightings s
			join matches m on m.id = s.match_id
			join players p on p.steam_id = m.recorder_steam_id
			where s.steam_id = ${steamId}
				and ${f.sightings}
				and not exists (
					select 1 from matches o
					where o.recorder_steam_id = ${steamId} and o.game_id = coalesce(m.game_id, m.id)
				)
			order by coalesce(m.game_id, m.id), s.last_round desc nulls last
		),
		listed as (select * from own union all select * from seen)
		select *, count(*) over ()::int as total
		from listed
		where ${where(f, { result: true })}
		order by started_at desc
		limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}
	`);
	return page(rows, f, toRow);
}

/** Every game, newest first, one row per game (the first complete recording represents it). */
export async function listGames(db: Db, f: MatchFilters): Promise<Page<MatchListRow>> {
	const rows = await db.execute<Row>(sql`
		with games as (
			select distinct on (coalesce(m.game_id, m.id))
				m.id, m.game_id, m.map, m.mode, m.started_at, m.duration_s, m.status, m.result,
				m.score_mine, m.score_theirs, m.kills, m.assists, m.deaths, m.adr, m.hs_pct,
				m.recorder_steam_id, p.name as recorder_name, 'recorded'::text as kind,
				null::boolean as teammate,
				count(*) over (partition by coalesce(m.game_id, m.id))::int as recordings
			from matches m
			join players p on p.steam_id = m.recorder_steam_id
			order by coalesce(m.game_id, m.id), (m.status = 'complete') desc, m.started_at
		)
		select *, count(*) over ()::int as total
		from games
		where ${where(f, { result: false })}
		order by started_at desc
		limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}
	`);
	return page(rows, f, toRow);
}

export async function recentGames(db: Db, limit = 8): Promise<MatchListRow[]> {
	const { rows } = await listGames(db, {
		map: null,
		mode: null,
		result: null,
		period: null,
		sightings: true,
		page: 1
	});
	return rows.slice(0, limit);
}

export async function matchDetail(db: Db, id: string) {
	const [m] = await db
		.select({ match: matches, recorderName: players.name })
		.from(matches)
		.innerJoin(players, eq(players.steamId, matches.recorderSteamId))
		.where(eq(matches.id, id));
	if (!m) return null;

	const [roundRows, kills, seen, linked, weapons] = await Promise.all([
		db.select().from(rounds).where(eq(rounds.matchId, id)).orderBy(asc(rounds.number)),
		db
			.select()
			.from(killEvents)
			.where(eq(killEvents.matchId, id))
			.orderBy(asc(killEvents.at), asc(killEvents.id)),
		db
			.select({ sighting: sightings, currentName: players.name })
			.from(sightings)
			.innerJoin(players, eq(players.steamId, sightings.steamId))
			.where(eq(sightings.matchId, id))
			.orderBy(asc(sightings.firstRound)),
		m.match.gameId
			? db
					.select({
						id: matches.id,
						recorderSteamId: matches.recorderSteamId,
						recorderName: players.name,
						result: matches.result,
						scoreMine: matches.scoreMine,
						scoreTheirs: matches.scoreTheirs,
						kills: matches.kills,
						deaths: matches.deaths,
						assists: matches.assists,
						adr: matches.adr,
						status: matches.status
					})
					.from(matches)
					.innerJoin(players, eq(players.steamId, matches.recorderSteamId))
					.where(and(eq(matches.gameId, m.match.gameId), ne(matches.id, id)))
					.orderBy(asc(matches.startedAt))
			: Promise.resolve([]),
		// INFERRED: the active weapon when each kill was noticed.
		db
			.select({
				weapon: sql<string>`coalesce(${killEvents.weapon}, 'unknown')`,
				kills: sql<number>`count(*)::int`,
				hs: sql<number>`(count(*) filter (where ${killEvents.headshot}))::int`
			})
			.from(killEvents)
			.where(eq(killEvents.matchId, id))
			.groupBy(sql`1`)
			.orderBy(sql`count(*) desc`, sql`1`)
	]);

	return {
		match: m.match,
		recorderName: m.recorderName,
		rounds: roundRows,
		killEvents: kills,
		sightings: seen.map((s) => ({ ...s.sighting, currentName: s.currentName })),
		linked,
		weapons
	};
}

export type MatchDetail = NonNullable<Awaited<ReturnType<typeof matchDetail>>>;
