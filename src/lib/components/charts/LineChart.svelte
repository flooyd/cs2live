<script lang="ts" module>
	export interface Series {
		name: string;
		/** CSS color for the line and its markers. */
		color: string;
		values: (number | null)[];
	}
</script>

<script lang="ts">
	// Lines over ordered categories (rounds, matches) on one y axis. 2 px lines, a legend
	// with line keys, direct end labels when they don't collide, and a crosshair that snaps
	// to the nearest category and lists every series. Nulls break the line.
	import { niceTicks } from './scale.ts';

	interface Props {
		labels: string[];
		series: Series[];
		height?: number;
		format?: (n: number) => string;
		/** Tooltip title for category i, e.g. "Round 7". */
		title?: (i: number) => string;
		label: string;
	}

	let {
		labels,
		series,
		height = 200,
		format = (n) => String(n),
		title = (i) => labels[i],
		label
	}: Props = $props();

	let width = $state(600);
	let active = $state<number | null>(null);

	// End labels need room on the right; on narrow charts the legend alone names the lines.
	const endRoom = $derived.by(() => {
		if (series.length > 4 || width < 520) return 0;
		const longest = Math.max(0, ...series.map((s) => s.name.length));
		return Math.min(Math.round(longest * 6.2) + 14, Math.round(width * 0.28));
	});
	const M = $derived({ top: 12, right: Math.max(12, endRoom), bottom: 24, left: 46 });
	const plotW = $derived(Math.max(10, width - M.left - M.right));
	const plotH = $derived(height - M.top - M.bottom);
	const all = $derived(series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
	const ticks = $derived(niceTicks(Math.max(1, ...all), 4));
	const yMax = $derived(ticks.at(-1) ?? 1);
	const step = $derived(labels.length > 1 ? plotW / (labels.length - 1) : plotW);
	const labelEvery = $derived(Math.max(1, Math.ceil(28 / step)));
	const x = (i: number) => M.left + (labels.length > 1 ? i * step : plotW / 2);
	const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

	function path(values: (number | null)[]): string {
		let d = '';
		let pen = false;
		values.forEach((v, i) => {
			if (v === null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}

	/** End labels at each series' last value, skipping any that would overlap a previous one. */
	const ends = $derived.by(() => {
		const placed: { name: string; y: number; x: number }[] = [];
		if (endRoom === 0) return placed;
		for (const s of series) {
			const i = s.values.findLastIndex((v) => v !== null);
			if (i < 0) continue;
			const yy = y(s.values[i]!);
			if (placed.some((p) => Math.abs(p.y - yy) < 13)) continue;
			placed.push({ name: s.name, y: yy, x: x(i) });
		}
		return placed;
	});

	function move(e: PointerEvent) {
		const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
		const px = e.clientX - box.left;
		active = Math.max(
			0,
			Math.min(labels.length - 1, Math.round(px / (labels.length > 1 ? step : 1)))
		);
	}

	// Every series at the hovered category, for the tooltip.
	const tipRows = $derived.by(() => {
		const at = active;
		if (at === null) return [];
		return series.map((s) => ({ name: s.name, color: s.color, value: s.values[at] ?? null }));
	});

	const tipLeft = $derived(active === null ? 0 : Math.min(Math.max(x(active), 90), width - 90));
</script>

<div class="wrap">
	<ul class="legend">
		{#each series as s (s.name)}
			<li><span class="key" style:background={s.color}></span>{s.name}</li>
		{/each}
	</ul>
	<div class="chart" bind:clientWidth={width} style:height="{height}px">
		<svg {width} {height} role="img" aria-label={label}>
			{#each ticks as t (t)}
				<line class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
				<text class="tick" x={M.left - 6} y={y(t)} dy="0.32em" text-anchor="end">{format(t)}</text>
			{/each}
			{#each labels as l, i (i)}
				{#if i % labelEvery === 0}
					<text class="tick" x={x(i)} y={M.top + plotH + 16} text-anchor="middle">{l}</text>
				{/if}
			{/each}
			{#if active !== null}
				<line class="cross" x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} />
			{/if}
			{#each series as s (s.name)}
				<path class="line" d={path(s.values)} stroke={s.color} />
				{#if active !== null && s.values[active] !== null}
					<circle class="dot" cx={x(active)} cy={y(s.values[active]!)} r="4.5" fill={s.color} />
				{/if}
			{/each}
			{#each ends as e (e.name)}
				<text class="end" x={e.x + 8} y={e.y} dy="0.32em">{e.name}</text>
			{/each}
			<rect
				class="hit"
				x={M.left - step / 2}
				y={M.top}
				width={plotW + step}
				height={plotH}
				role="presentation"
				onpointermove={move}
				onpointerleave={() => (active = null)}
			/>
		</svg>
		{#if active !== null}
			<div class="tip" style:left="{tipLeft}px">
				<span class="title">{title(active)}</span>
				{#each tipRows as row (row.name)}
					<span class="row">
						<span class="key" style:background={row.color}></span>
						<strong>{row.value === null ? '—' : format(row.value)}</strong>
						<span>{row.name}</span>
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: grid;
		/* minmax(0, 1fr) so the svg cannot hold the track at its old width. */
		grid-template-columns: minmax(0, 1fr);
		gap: 0.4rem;
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: 1rem;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.key {
		display: inline-block;
		width: 14px;
		height: 2px;
		border-radius: 1px;
	}
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--viz-grid);
		stroke-width: 1;
	}
	.cross {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.tick {
		fill: var(--dim);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.end {
		fill: var(--muted);
		font-size: 11px;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.dot {
		stroke: var(--panel);
		stroke-width: 2;
	}
	.hit {
		fill: transparent;
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		pointer-events: none;
		display: grid;
		gap: 0.15rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-sm);
		background: var(--panel-2);
		border: 1px solid var(--line-2);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
		font-size: 0.8rem;
		color: var(--muted);
		white-space: nowrap;
		z-index: 2;
	}
	.title {
		color: var(--text);
		font-weight: 600;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.row strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
</style>
