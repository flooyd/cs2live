<script lang="ts" module>
	export interface SparkRow {
		name: string;
		value: string;
		/** Bold, and listed first in the tooltip. */
		strong?: boolean;
	}

	export interface SparkDivider {
		/** Category index the divider is drawn before. */
		before: number;
		label: string;
	}
</script>

<script lang="ts">
	// A small single-series area chart for tight spaces (the live screen). Sized in em so it
	// scales with the surrounding text. One y axis from 0, a crosshair that snaps to the
	// nearest category with data, optional dividers (halftime), and a visually hidden table
	// with the same numbers. Nulls break the line.
	import { niceTicks } from './scale.ts';

	interface Props {
		/** One per category, in order (e.g. round numbers). */
		labels: string[];
		values: (number | null)[];
		/** Line and fill color. */
		color?: string;
		/** Axis tick format. */
		format?: (n: number) => string;
		/** CSS height, em by default so it follows the font size. */
		height?: string;
		/** Tooltip and table heading for category i. */
		title?: (i: number) => string;
		/** Tooltip and table rows for category i (only asked for categories with a value). */
		rows: (i: number) => SparkRow[];
		dividers?: SparkDivider[];
		label: string;
	}

	let {
		labels,
		values,
		color = 'var(--viz-1)',
		format = (n) => String(n),
		height = '6em',
		title = (i) => labels[i],
		rows,
		dividers = [],
		label
	}: Props = $props();

	let width = $state(300);
	let boxH = $state(96);
	let em = $state(16);
	let tipW = $state(120);
	let active = $state<number | null>(null);

	// Divider labels get their own band above the plot so they never sit on the line.
	const M = $derived({
		top: em * (dividers.length ? 0.9 : 0.5),
		right: em * 0.5,
		bottom: em * 1.2,
		left: em * 2.3
	});
	const plotW = $derived(Math.max(10, width - M.left - M.right));
	const plotH = $derived(Math.max(10, boxH - M.top - M.bottom));
	const n = $derived(Math.max(2, labels.length));
	const step = $derived(plotW / (n - 1));
	const ticks = $derived(
		niceTicks(Math.max(1, ...values.filter((v): v is number => v !== null)), 2)
	);
	const yMax = $derived(ticks.at(-1) ?? 1);
	const x = (i: number) => M.left + i * step;
	const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
	const base = $derived(M.top + plotH);
	const lastIndex = $derived(values.findLastIndex((v) => v !== null));

	/** Runs of consecutive non-null values. */
	const runs = $derived.by(() => {
		const out: { i: number; v: number }[][] = [];
		let run: { i: number; v: number }[] = [];
		values.forEach((v, i) => {
			if (v === null) {
				if (run.length) out.push(run);
				run = [];
			} else run.push({ i, v });
		});
		if (run.length) out.push(run);
		return out;
	});
	const line = (run: { i: number; v: number }[]) =>
		run.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
	const area = (run: { i: number; v: number }[]) =>
		`${line(run)}L${x(run.at(-1)!.i).toFixed(1)},${base}L${x(run[0].i).toFixed(1)},${base}Z`;

	// Round labels: a "nice" spacing that leaves about 2em between them.
	const every = $derived(
		[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50].find((k) => k * step >= em * 2) ?? 100
	);
	const shownLabels = $derived(
		labels.flatMap((l, i) => {
			const nth = (i + 1) % every === 0;
			const first = i === 0 && (every === 1 || (every - 1) * step >= em * 2);
			return nth || first ? [{ i, l }] : [];
		})
	);

	function move(e: PointerEvent) {
		if (lastIndex < 0) return;
		const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
		const i = Math.round((e.clientX - box.left) / step);
		active = Math.max(0, Math.min(lastIndex, i));
	}

	const tip = $derived.by(() => {
		if (active === null) return null;
		const v = values[active];
		const list = v === null ? [] : [...rows(active)].sort((a, b) => +!!b.strong - +!!a.strong);
		return { title: title(active), rows: list };
	});
	const tipLeft = $derived(
		active === null ? 0 : Math.min(Math.max(x(active), tipW / 2), width - tipW / 2)
	);

	const tableHead = $derived.by(() => {
		const first = values.findIndex((v) => v !== null);
		return first < 0 ? [] : rows(first).map((r) => r.name);
	});
</script>

<!-- The svg is hidden from assistive tech; the table below carries the same numbers. -->
<div class="chart" style:height bind:clientWidth={width} bind:clientHeight={boxH}>
	<span class="em" bind:clientWidth={em} aria-hidden="true"></span>
	<svg {width} height={boxH} aria-hidden="true">
		{#each ticks as t (t)}
			<line class="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
			<text class="tick" x={M.left - em * 0.35} y={y(t)} dy="0.32em" text-anchor="end">
				{format(t)}
			</text>
		{/each}
		{#each shownLabels as s (s.i)}
			<text class="tick" x={x(s.i)} y={base + em * 0.95} text-anchor="middle">{s.l}</text>
		{/each}
		{#each dividers as d (d.before)}
			{#if d.before > 0 && d.before < n}
				{@const dx = x(d.before - 0.5)}
				<line class="divider" x1={dx} x2={dx} y1={M.top} y2={base} />
				<text class="div-label" x={dx} y={M.top - em * 0.2} text-anchor="middle">{d.label}</text>
			{/if}
		{/each}
		{#each runs as run, k (k)}
			{#if run.length > 1}
				<path class="area" d={area(run)} fill={color} />
				<path class="line" d={line(run)} stroke={color} />
			{:else if run[0].i !== lastIndex}
				<circle class="dot" cx={x(run[0].i)} cy={y(run[0].v)} r="3.5" fill={color} />
			{/if}
		{/each}
		{#if active !== null}
			<line class="cross" x1={x(active)} x2={x(active)} y1={M.top} y2={base} />
		{/if}
		{#if lastIndex >= 0 && active !== lastIndex}
			<circle class="dot" cx={x(lastIndex)} cy={y(values[lastIndex]!)} r="4.5" fill={color} />
		{/if}
		{#if active !== null && values[active] !== null}
			<circle class="dot" cx={x(active)} cy={y(values[active]!)} r="5" fill={color} />
		{/if}
		<rect
			class="hit"
			x={M.left - step / 2}
			y={0}
			width={plotW + step}
			height={boxH}
			role="presentation"
			onpointermove={move}
			onpointerleave={() => (active = null)}
		/>
	</svg>
	{#if tip}
		<div class="tip" style:left="{tipLeft}px" bind:clientWidth={tipW}>
			<span class="title">{tip.title}</span>
			{#each tip.rows as row (row.name)}
				<span class="row" class:strong={row.strong}>
					<span>{row.name}</span><strong>{row.value}</strong>
				</span>
			{:else}
				<span class="row"><span>Not seen</span></span>
			{/each}
		</div>
	{/if}
	<table class="sr-only">
		<caption>{label}</caption>
		<thead>
			<tr>
				<th></th>
				{#each tableHead as h (h)}<th>{h}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each values as v, i (i)}
				{#if v !== null}
					<tr>
						<th>{title(i)}</th>
						{#each rows(i) as r (r.name)}<td>{r.value}</td>{/each}
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	.em {
		position: absolute;
		display: block;
		width: 1em;
		height: 0;
		visibility: hidden;
	}
	/* Out of flow, so the svg's last measured width can't hold a flex or grid parent open
	   when the window shrinks. The box's own height comes from the height prop. */
	svg {
		position: absolute;
		inset: 0;
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--viz-grid);
		stroke-width: 1;
	}
	.divider {
		stroke: var(--line-2);
		stroke-width: 1;
	}
	.cross {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.tick,
	.div-label {
		fill: var(--dim);
		font-size: 0.62em;
		font-variant-numeric: tabular-nums;
	}
	.div-label {
		font-weight: 700;
		letter-spacing: 0.06em;
	}
	.area {
		fill-opacity: 0.12;
		stroke: none;
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
		/* Above the chart, so it never runs past the bottom of its panel. */
		bottom: calc(100% + 0.3em);
		transform: translateX(-50%);
		pointer-events: none;
		display: grid;
		gap: 0.1em;
		padding: 0.4em 0.6em;
		border-radius: var(--radius-sm);
		background: var(--panel-2);
		border: 1px solid var(--line-2);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
		font-size: 0.72em;
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
		justify-content: space-between;
		gap: 1.2em;
	}
	.row strong {
		color: var(--text);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.row.strong strong {
		font-weight: 700;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
