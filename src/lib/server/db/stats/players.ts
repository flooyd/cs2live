// Player lookup: search by name, and a profile summary for /players/[steamid].
import { sql } from 'drizzle-orm';
import type { Db } from '../client.ts';

export interface PlayerHit {
	steamId: string;
	name: string | null;
	recorded: number;
	sighted: number;
	lastSeenAt: Date;
}

/** Players whose last known name contains `q` (case-insensitive), most recently seen first. */
export async function searchPlayers(db: Db, q: string, limit = 20): Promise<PlayerHit[]> {
	const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const rows = await db.execute<{
		steam_id: string;
		name: string | null;
		recorded: number;
		sighted: number;
		last_seen_at: string;
	}>(sql`
		select p.steam_id, p.name, p.last_seen_at,
			(select count(*)::int from matches m where m.recorder_steam_id = p.steam_id) as recorded,
			(select count(*)::int from sightings s where s.steam_id = p.steam_id) as sighted
		from players p
		where p.name ilike ${pattern}
		order by p.last_seen_at desc
		limit ${limit}
	`);
	return rows.map((r) => ({
		steamId: r.steam_id,
		name: r.name,
		recorded: r.recorded,
		sighted: r.sighted,
		lastSeenAt: new Date(r.last_seen_at)
	}));
}

export interface PlayerProfile {
	steamId: string;
	name: string | null;
	firstSeenAt: Date;
	lastSeenAt: Date;
	/** Matches this player recorded themselves. */
	recorded: number;
	/** Other games where a recorder spectated this player (not counting games they recorded). */
	sighted: number;
	/** Someone claimed this Steam ID on the site. */
	claimed: boolean;
}

export async function playerProfile(db: Db, steamId: string): Promise<PlayerProfile | null> {
	const rows = await db.execute<{
		steam_id: string;
		name: string | null;
		first_seen_at: string;
		last_seen_at: string;
		recorded: number;
		sighted: number;
		claimed: boolean;
	}>(sql`
		select p.steam_id, p.name, p.first_seen_at, p.last_seen_at,
			(select count(*)::int from matches m where m.recorder_steam_id = p.steam_id) as recorded,
			(select count(distinct coalesce(m.game_id, m.id))::int
				from sightings s join matches m on m.id = s.match_id
				where s.steam_id = p.steam_id
				and not exists (
					select 1 from matches own
					where own.recorder_steam_id = p.steam_id
					and own.game_id = coalesce(m.game_id, m.id)
				)) as sighted,
			exists (select 1 from steam_links l where l.steam_id = p.steam_id) as claimed
		from players p
		where p.steam_id = ${steamId}
	`);
	const r = rows[0];
	if (!r) return null;
	return {
		steamId: r.steam_id,
		name: r.name,
		firstSeenAt: new Date(r.first_seen_at),
		lastSeenAt: new Date(r.last_seen_at),
		recorded: r.recorded,
		sighted: r.sighted,
		claimed: r.claimed
	};
}

/** Distinct maps and modes in the data, for filter dropdowns. */
export async function filterOptions(db: Db, steamId?: string) {
	const where = steamId
		? sql`where m.recorder_steam_id = ${steamId}
			or exists (select 1 from sightings s where s.match_id = m.id and s.steam_id = ${steamId})`
		: sql``;
	const rows = await db.execute<{ kind: string; value: string; n: number }>(sql`
		select 'map' as kind, m.map as value, count(*)::int as n from matches m ${where} group by m.map
		union all
		select 'mode', m.mode, count(*)::int from matches m ${where} group by m.mode
		order by n desc
	`);
	return {
		maps: rows.filter((r) => r.kind === 'map').map((r) => r.value),
		modes: rows.filter((r) => r.kind === 'mode').map((r) => r.value)
	};
}
