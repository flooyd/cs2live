<script lang="ts" module>
	export interface Column {
		key: string | number;
		/** Axis label under the column (thinned out when columns are narrow). */
		label: string;
		value: number;
		/** CSS color for the mark; defaults to --viz-single. */
		color?: string;
		/** Small marker under the axis label, e.g. W / L. Text color, not the mark color. */
		mark?: string;
		/** Tooltip: first line is the value, the rest describe it. */
		tip: string[];
	}
</script>

<script lang="ts">
	// Vertical columns on one baseline, one per category. Thin marks (<= 24 px), 4 px rounded
	// data end, hairline grid, a tooltip per column on hover and keyboard focus. The data also
	// has a table elsewhere on the page, so the tooltip never gates a value.
	import { niceTicks } from './scale.ts';

	interface Props {
		columns: Column[];
		height?: number;
		format?: (n: number) => string;
		/** Accessible name of the chart. */
		label: string;
	}

	let { columns, height = 180, format = (n) => String(n), label }: Props = $props();

	let width = $state(600);
	let active = $state<number | null>(null);

	const M = { top: 10, right: 6, bottom: 34, left: 40 };
	const plotW = $derived(Math.max(10, width - M.left - M.right));
	const plotH = $derived(height - M.top - M.bottom);
	const ticks = $derived(niceTicks(Math.max(1, ...columns.map((c) => c.value)), 4));
	const yMax = $derived(ticks.at(-1) ?? 1);
	const band = $derived(columns.length ? plotW / columns.length : plotW);
	// Bars never fill the slot: <= 24 px, and a 2 px gap to the next one at least.
	const barW = $derived(Math.max(2, Math.min(24, band - 2)));
	const labelEvery = $derived(Math.max(1, Math.ceil(26 / band)));
	const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

	/** Column path: square at the baseline, 4 px rounded at the data end. */
	function bar(x: number, v: number): string {
		const top = y(v);
		const h = M.top + plotH - top;
		if (h <= 0) return '';
		const r = Math.min(4, h, barW / 2);
		const bottom = M.top + plotH;
		return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${bottom}Z`;
	}

	const tipX = $derived(
		active === null ? 0 : Math.min(Math.max(M.left + band * (active + 0.5), 80), width - 80)
	);
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	<svg {width} {height} role="img" aria-label={label}>
		{#each ticks as t (t)}
			<line class="grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
			<text class="tick" x={M.left - 6} y={y(t)} dy="0.32em" text-anchor="end">{format(t)}</text>
		{/each}
		{#each columns as c, i (c.key)}
			{@const x = M.left + band * i + (band - barW) / 2}
			<path
				d={bar(x, c.value)}
				fill={c.color ?? 'var(--viz-single)'}
				class:dim={active !== null && active !== i}
			/>
			{#if i % labelEvery === 0}
				<text class="tick" x={x + barW / 2} y={M.top + plotH + 14} text-anchor="middle">
					{c.label}
				</text>
			{/if}
			{#if c.mark}
				<text class="mark" x={x + barW / 2} y={M.top + plotH + 28} text-anchor="middle">
					{c.mark}
				</text>
			{/if}
			<!-- Hit target: the whole band, taller than the mark. -->
			<rect
				class="hit"
				x={M.left + band * i}
				y={M.top}
				width={band}
				height={plotH}
				tabindex="0"
				role="button"
				aria-label={c.tip.join(', ')}
				onpointerenter={() => (active = i)}
				onpointerleave={() => (active = null)}
				onfocus={() => (active = i)}
				onblur={() => (active = null)}
			/>
		{/each}
		<line class="axis" x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} />
	</svg>
	{#if active !== null && columns[active]}
		{@const c = columns[active]}
		<div class="tip" style:left="{tipX}px" style:top="{Math.max(0, y(c.value) - 8)}px">
			<strong>{c.tip[0]}</strong>
			{#each c.tip.slice(1) as line, j (j)}<span>{line}</span>{/each}
		</div>
	{/if}
</div>

<style>
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
	.axis {
		stroke: var(--line-2);
		stroke-width: 1;
	}
	.tick {
		fill: var(--dim);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.mark {
		fill: var(--muted);
		font-size: 10px;
		font-weight: 700;
	}
	path {
		transition: opacity 0.12s;
	}
	path.dim {
		opacity: 0.45;
	}
	.hit {
		fill: transparent;
		cursor: default;
		outline: none;
	}
	.hit:focus-visible {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.tip {
		position: absolute;
		transform: translate(-50%, -100%);
		pointer-events: none;
		display: grid;
		gap: 0.1rem;
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
	.tip strong {
		color: var(--text);
		font-size: 0.95rem;
	}
</style>
