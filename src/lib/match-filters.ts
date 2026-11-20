// Match list / stats filters, read from and written to the URL query string. Shared by server
// and browser; no framework imports.

export const RESULTS = ['win', 'loss', 'tie', 'incomplete'] as const;
export type ResultFilter = (typeof RESULTS)[number];

export const PERIODS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 } as const;
export type Period = keyof typeof PERIODS;

export interface MatchFilters {
	map: string | null;
	mode: string | null;
	result: ResultFilter | null;
	period: Period | null;
	/** Include matches where this player was only spectated by a recorder (player lists). */
	sightings: boolean;
	page: number;
}

export const PAGE_SIZE = 25;

const MAP_RE = /^[a-z0-9_]{2,40}$/;

export function parseMatchFilters(params: URLSearchParams): MatchFilters {
	const map = params.get('map');
	const mode = params.get('mode');
	const result = params.get('result');
	const period = params.get('period');
	const page = Number(params.get('page') ?? 1);
	return {
		map: map && MAP_RE.test(map) ? map : null,
		mode: mode && MAP_RE.test(mode) ? mode : null,
		result: (RESULTS as readonly string[]).includes(result ?? '') ? (result as ResultFilter) : null,
		period: period && period in PERIODS ? (period as Period) : null,
		sightings: params.get('sightings') !== '0',
		page: Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1
	};
}

/** The query string for `filters` with `patch` applied (defaults are left out). */
export function filterQuery(filters: MatchFilters, patch: Partial<MatchFilters> = {}): string {
	const f = { ...filters, page: 1, ...patch };
	const q = new URLSearchParams();
	if (f.map) q.set('map', f.map);
	if (f.mode) q.set('mode', f.mode);
	if (f.result) q.set('result', f.result);
	if (f.period) q.set('period', f.period);
	if (!f.sightings) q.set('sightings', '0');
	if (f.page > 1) q.set('page', String(f.page));
	const s = q.toString();
	return s ? `?${s}` : '';
}

/** Start of the period, or null for all time. */
export function periodStart(period: Period | null, now = Date.now()): Date | null {
	return period ? new Date(now - PERIODS[period] * 86_400_000) : null;
}

export function isFiltered(f: MatchFilters): boolean {
	return !!(f.map || f.mode || f.result || f.period);
}
