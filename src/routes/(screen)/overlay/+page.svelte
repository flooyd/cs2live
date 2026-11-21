<script lang="ts">
	import { untrack } from 'svelte';
	import { scale as pop } from 'svelte/transition';
	import type { PageProps } from './$types';
	import { LiveConnection, formatClock, secondsLeft } from '#lib/live/connection.svelte.ts';
	import RoundStrip from '#lib/live/components/RoundStrip.svelte';
	import { fixed, money } from '#lib/format.ts';

	// For OBS: add a Browser source pointing at http://localhost:5173/overlay (optionally
	// ?scale=1.5), about 720x200. The page background is transparent.
	let { data }: PageProps = $props();

	const conn = new LiveConnection(
		'/api/live/stream',
		untrack(() => data.initial)
	);
	$effect(() => (data.liveEnabled ? conn.start() : undefined));

	const v = $derived(conn.view);
	const now = $derived(conn.serverNow);
	const timer = $derived(v?.timer ? secondsLeft(v.timer.endsAt, now) : null);
	const bomb = $derived(v?.bombTimer ? secondsLeft(v.bombTimer.endsAt, now) : null);
	const mySide = $derived(v?.me?.team ?? null);
</script>

<svelte:head>
	<title>Overlay · CS2Live</title>
</svelte:head>

<div class="overlay" style:font-size="{16 * data.scale}px">
	{#if !data.liveEnabled}
		<div class="card"><span class="muted">Live overlay only runs locally</span></div>
	{:else if v?.map}
		<div class="card">
			<div class="top">
				<span class="score ct num" class:mine={mySide === 'CT'}>
					{#key v.map.ct.score}<span in:pop={{ start: 1.4, duration: 300 }}>
							{v.map.ct.score}
						</span>{/key}
				</span>
				<div class="mid">
					<span class="map">{v.map.label}</span>
					{#if bomb !== null}
						<span class="clock bomb num">💣 {formatClock(bomb)}</span>
					{:else if timer !== null}
						<span class="clock num">{formatClock(timer)}{v.timer?.estimated ? '*' : ''}</span>
					{:else}
						<span class="clock dim">R{v.map.round}</span>
					{/if}
				</div>
				<span class="score t num" class:mine={mySide === 'T'}>
					{#key v.map.t.score}<span in:pop={{ start: 1.4, duration: 300 }}>
							{v.map.t.score}
						</span>{/key}
				</span>
			</div>
			<RoundStrip
				pips={v.history}
				current={v.map.phase === 'gameover' ? null : v.map.round}
				slots={v.map.regulationRounds}
				halfLength={v.map.halfLength}
				compact
			/>
			{#if v.spectating}
				<div class="row spec">Spectating <strong>{v.spectating.name}</strong></div>
			{/if}
			{#if v.me}
				<div class="row num">
					<span class:low={v.me.health <= 25} class:deadtxt={!v.me.alive}>♥ {v.me.health}</span>
					<span>⛨ {v.me.armor}{v.me.helmet ? 'H' : ''}</span>
					<span class="cash">{money(v.me.money)}</span>
					{#if v.me.activeWeapon}
						<span>
							{v.me.activeWeapon.label}{v.me.activeWeapon.clip !== null
								? ` ${v.me.activeWeapon.clip}/${v.me.activeWeapon.reserve ?? 0}`
								: ''}
						</span>
					{/if}
				</div>
			{/if}
			{#if v.matchStats}
				<div class="row num stats">
					<span>{v.matchStats.kills} / {v.matchStats.assists} / {v.matchStats.deaths}</span>
					{#if v.matchStats.adr !== null}<span>ADR {fixed(v.matchStats.adr, 0)}</span>{/if}
					<span>HS {v.matchStats.hsPct === null ? '—' : `${Math.round(v.matchStats.hsPct)}%`}</span>
					{#if v.roundStats && v.roundStats.kills > 0}
						<span class="rk">{v.roundStats.kills}K this round</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* OBS browser sources show the page background; this page is opened on its own there. */
	:global(html),
	:global(body) {
		background: transparent !important;
	}
	/* With color-scheme: dark, Chromium (and OBS) paints the empty canvas dark instead of
	   leaving it transparent. */
	:global(:root) {
		color-scheme: normal;
	}
	.overlay {
		padding: 0.5em;
		display: inline-block;
	}
	.card {
		display: grid;
		gap: 0.45em;
		padding: 0.6em 0.8em;
		border-radius: 0.6em;
		background: rgb(10 13 19 / 0.82);
		border: 1px solid rgb(255 255 255 / 0.08);
		min-width: 22em;
		color: var(--text);
		font-family: var(--font);
	}
	.top {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.8em;
	}
	.score {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 2.2em;
		line-height: 1;
		min-width: 1.4em;
		text-align: center;
	}
	.score span {
		display: inline-block;
	}
	.score.ct {
		color: var(--ct);
	}
	.score.t {
		color: var(--t);
	}
	.score.mine {
		text-shadow: 0 0 0.3em currentColor;
	}
	.mid {
		display: grid;
		justify-items: center;
	}
	.map {
		font-weight: 700;
		font-size: 0.85em;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.clock {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.3em;
	}
	.clock.bomb {
		color: var(--loss);
	}
	.row {
		display: flex;
		gap: 0.9em;
		font-size: 0.95em;
		font-weight: 600;
	}
	.row.spec {
		font-weight: 400;
		color: var(--muted);
	}
	.stats {
		color: var(--muted);
	}
	.cash {
		color: var(--win);
	}
	.low {
		color: var(--loss);
	}
	.deadtxt {
		color: var(--dim);
	}
	.rk {
		color: var(--warn);
	}
</style>
