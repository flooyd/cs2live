// Display formatting. Pure.

export function money(n: number | null | undefined): string {
	if (n === null || n === undefined) return '—';
	return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fixed(n: number | null | undefined, digits = 1): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	return n.toFixed(digits);
}

export function pct(n: number | null | undefined, digits = 0): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	return `${n.toFixed(digits)}%`;
}

export function duration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return '—';
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
	return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
});

export function date(value: string | Date | null | undefined): string {
	if (!value) return '—';
	return dateFmt.format(new Date(value));
}

export function dateTime(value: string | Date | null | undefined): string {
	if (!value) return '—';
	return dateTimeFmt.format(new Date(value));
}

/** "4 s ago", "3 min ago", "2 h ago", or a date. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
	if (ms === null || ms === undefined) return 'never';
	const s = Math.max(0, (now - ms) / 1000);
	if (s < 1) return 'just now';
	if (s < 60) return `${Math.floor(s)} s ago`;
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return date(new Date(ms));
}

export function resultLabel(result: string): string {
	switch (result) {
		case 'win':
			return 'Win';
		case 'loss':
			return 'Loss';
		case 'tie':
			return 'Tie';
		default:
			return 'Incomplete';
	}
}
