// Small scale helpers for the hand-rolled SVG charts. Pure.

/** Round tick values from 0 to at least `max`, about `count` of them (0, 1/2/2.5/5 × 10^n). */
export function niceTicks(max: number, count = 4): number[] {
	if (!(max > 0)) return [0, 1];
	const raw = max / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
	const ticks: number[] = [];
	for (let v = 0; v < max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
	if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
	return ticks;
}

/** $0, $800, $5K, $12.5K */
export function compactMoney(n: number): string {
	if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
	return `$${n}`;
}
