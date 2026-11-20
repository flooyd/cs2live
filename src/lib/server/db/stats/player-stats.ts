// Aggregate stats for one player over the matches they recorded. Everything is computed in
// SQL. Sightings are left out: they are partial (stats as last seen, no rounds).
// See STATS.md for what each number means and how sure it is.
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { periodStart, type MatchFilters } from '#lib/match-filters.ts';

type Filters = Pick<MatchFilters, 'map' | 'mode' | 'period'>;

/** `m` is the player's recorded matches with the filters applied. */
function scope(steamId: string, f: Filters): SQL {
	const parts: SQL[] = [sql`m.recorder_steam_id = ${steamId}`];
	if (f.map) parts.push(sql`m.map = ${f.map}`);
	if (f.mode) parts.push(sql`m.mode = ${f.mode}`);
	const from = periodStart(f.period);
	if (from) parts.push(sql`m.started_at >= ${from.toISOString()}::timestamptz`);
	return sql.join(parts, sql` and `);
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export interface Totals {
	matches: number;
	wins: number;
	losses: number;
	ties: number;
	incomplete: number;
	rounds: number;
	roundsWon: number;
	roundsLost: number;
	kills: number;
	deaths: number;
	assists: number;
	mvps: number;
	damage: number;
	hsKills: number;
	/** Kills counted round by round (the base for HS%). */
	roundKills: number;
	seconds: number;
}

export interface Rates {
	/** Wins / (wins + losses + ties); incomplete matches are left out. */
	winRate: number | null;
	adr: number | null;
	kd: number | null;
	hsPct: number | null;
	kpr: number | null;
}

export function rates(t: Totals): Rates {
	return {
		winRate: ratio(t.wins, t.wins + t.losses + t.ties),
		adr: ratio(t.damage, t.rounds),
		kd: t.deaths > 0 ? t.kills / t.deaths : t.kills > 0 ? t.kills : null,
		hsPct: t.roundKills > 0 ? (100 * t.hsKills) / t.roundKills : null,
		kpr: ratio(t.kills, t.rounds)
	};
}

const TOTALS = sql`
	count(*)::int as matches,
	count(*) filter (where m.result = 'win')::int as wins,
	count(*) filter (where m.result = 'loss')::int as losses,
	count(*) filter (where m.result = 'tie')::int as ties,
	count(*) filter (where m.status = 'incomplete')::int as incomplete,
	coalesce(sum(m.rounds_played), 0)::int as rounds,
	coalesce(sum(m.score_mine), 0)::int as rounds_won,
	coalesce(sum(m.score_theirs), 0)::int as rounds_lost,
	coalesce(sum(m.kills), 0)::int as kills,
	coalesce(sum(m.deaths), 0)::int as deaths,
	coalesce(sum(m.assists), 0)::int as assists,
	coalesce(sum(m.mvps), 0)::int as mvps,
	coalesce(sum(m.damage), 0)::int as damage,
	coalesce(sum(m.hs_kills), 0)::int as hs_kills,
	coalesce(sum((select sum(r.kills) from rounds r where r.match_id = m.id)), 0)::int as round_kills,
	coalesce(sum(m.duration_s), 0)::int as seconds
`;

type TotalsRow = {
	matches: number;
	wins: number;
	losses: number;
	ties: number;
	incomplete: number;
	rounds: number;
	rounds_won: number;
	rounds_lost: number;
	kills: number;
	deaths: number;
	assists: number;
	mvps: number;
	damage: number;
	hs_kills: number;
	round_kills: number;
	seconds: number;
};

function totals(r: TotalsRow): Totals {
	return {
		matches: r.matches,
		wins: r.wins,
		losses: r.losses,
		ties: r.ties,
		incomplete: r.incomplete,
		rounds: r.rounds,
		roundsWon: r.rounds_won,
		roundsLost: r.rounds_lost,
		kills: r.kills,
		deaths: r.deaths,
		assists: r.assists,
		mvps: r.mvps,
		damage: r.damage,
		hsKills: r.hs_kills,
		roundKills: r.round_kills,
		seconds: r.seconds
	};
}

export async function playerStats(db: Db, steamId: string, f: Filters) {
	const where = scope(steamId, f);

	const [overview, byMap, byMode, sides, buys, weapons, multi, form] = await Promise.all([
		db.execute<TotalsRow>(sql`select ${TOTALS} from matches m where ${where}`),
		db.execute<TotalsRow & { key: string }>(
			sql`select m.map as key, ${TOTALS} from matches m where ${where} group by m.map order by matches desc, key`
		),
		db.execute<TotalsRow & { key: string }>(
			sql`select m.mode as key, ${TOTALS} from matches m where ${where} group by m.mode order by matches desc, key`
		),
		db.execute<{
			side: string;
			rounds: number;
			won: number;
			kills: number;
			damage: number;
			survived: number;
			known: number;
		}>(sql`
			select r.my_side as side, count(*)::int as rounds,
				count(*) filter (where r.i_won)::int as won,
				coalesce(sum(r.kills), 0)::int as kills,
				coalesce(sum(r.damage), 0)::int as damage,
				count(*) filter (where r.survived)::int as survived,
				count(r.survived)::int as known
			from rounds r join matches m on m.id = r.match_id
			where ${where} and r.my_side in ('CT', 'T')
			group by r.my_side order by r.my_side
		`),
		db.execute<{
			buy: string;
			rounds: number;
			won: number;
			kills: number;
			damage: number;
			equip: number | null;
		}>(sql`
			select r.buy_type as buy, count(*)::int as rounds,
				count(*) filter (where r.i_won)::int as won,
				coalesce(sum(r.kills), 0)::int as kills,
				coalesce(sum(r.damage), 0)::int as damage,
				avg(r.equip_value)::float8 as equip
			from rounds r join matches m on m.id = r.match_id
			where ${where} and r.buy_type is not null
			group by r.buy_type
		`),
		db.execute<{ weapon: string; kills: number; hs: number }>(sql`
			select coalesce(k.weapon, 'unknown') as weapon, count(*)::int as kills,
				count(*) filter (where k.headshot)::int as hs
			from kill_events k join matches m on m.id = k.match_id
			where ${where}
			group by 1 order by kills desc, weapon limit 12
		`),
		db.execute<{ k: number; rounds: number }>(sql`
			select least(r.kills, 5)::int as k, count(*)::int as rounds
			from rounds r join matches m on m.id = r.match_id
			where ${where} and r.kills >= 2
			group by 1 order by 1
		`),
		db.execute<{
			id: string;
			started_at: string;
			map: string;
			result: string;
			kills: number;
			deaths: number;
			adr: number | null;
			kd: number | null;
			hs_pct: number | null;
			score_mine: number;
			score_theirs: number;
		}>(sql`
			select m.id, m.started_at, m.map, m.result, m.kills, m.deaths, m.adr, m.kd, m.hs_pct,
				m.score_mine, m.score_theirs
			from matches m where ${where}
			order by m.started_at desc limit 20
		`)
	]);

	const all = totals(overview[0]);
	const BUY_ORDER = ['pistol', 'eco', 'save', 'force', 'full'];
	return {
		totals: all,
		rates: rates(all),
		maps: byMap.map((r) => ({ key: r.key, totals: totals(r), rates: rates(totals(r)) })),
		modes: byMode.map((r) => ({ key: r.key, totals: totals(r), rates: rates(totals(r)) })),
		sides: sides.map((s) => ({
			side: s.side as 'CT' | 'T',
			rounds: s.rounds,
			won: s.won,
			winRate: ratio(s.won, s.rounds),
			adr: ratio(s.damage, s.rounds),
			kpr: ratio(s.kills, s.rounds),
			survival: ratio(s.survived, s.known)
		})),
		buys: buys
			.map((b) => ({
				buy: b.buy,
				rounds: b.rounds,
				winRate: ratio(b.won, b.rounds),
				kpr: ratio(b.kills, b.rounds),
				adr: ratio(b.damage, b.rounds),
				equip: b.equip
			}))
			.sort((a, b) => BUY_ORDER.indexOf(a.buy) - BUY_ORDER.indexOf(b.buy)),
		weapons: weapons.map((w) => ({ ...w, hsPct: ratio(100 * w.hs, w.kills) })),
		multiKills: [2, 3, 4, 5].map((k) => ({ k, rounds: multi.find((m) => m.k === k)?.rounds ?? 0 })),
		form: form
			.map((m) => ({
				id: m.id,
				startedAt: new Date(m.started_at),
				map: m.map,
				result: m.result,
				kills: m.kills,
				deaths: m.deaths,
				adr: m.adr,
				kd: m.kd,
				hsPct: m.hs_pct,
				scoreMine: m.score_mine,
				scoreTheirs: m.score_theirs
			}))
			.reverse()
	};
}

export type PlayerStats = Awaited<ReturnType<typeof playerStats>>;
