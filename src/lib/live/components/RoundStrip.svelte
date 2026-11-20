<script lang="ts">
	import type { RoundPip } from '#lib/live/types.ts';
	import { winKindGlyph, winKindLabel } from '#lib/cs2/rounds.ts';

	interface Props {
		pips: RoundPip[];
		/** Round being played now (gets an empty pulsing slot if not decided yet). */
		current: number | null;
		/** Show empty slots up to this many rounds (regulation length). */
		slots: number | null;
		halfLength: number | null;
		compact?: boolean;
	}

	let { pips, current, slots, halfLength, compact = false }: Props = $props();

	type Slot = { round: number; pip: RoundPip | null; switchBefore: boolean; overtime: boolean };

	const all = $derived.by((): Slot[] => {
		const byRound = new Map(pips.map((p) => [p.round, p]));
		const last = Math.max(slots ?? 0, current ?? 0, ...pips.map((p) => p.round));
		const out: Slot[] = [];
		for (let round = 1; round <= last; round++) {
			const pip = byRound.get(round) ?? null;
			const ruleSwitch = halfLength !== null && slots !== null && round === halfLength + 1;
			out.push({
				round,
				pip,
				switchBefore: pip?.switchBefore ?? ruleSwitch,
				overtime: pip?.overtime ?? (slots !== null && round > slots)
			});
		}
		return out;
	});

	function title(s: Slot): string {
		if (!s.pip) return s.round === current ? `Round ${s.round}: in progress` : `Round ${s.round}`;
		const who = s.pip.winner ?? '?';
		const you = s.pip.iWon === null ? '' : s.pip.iWon ? ' (you won)' : ' (you lost)';
		return `Round ${s.round}: ${who} win, ${winKindLabel(s.pip.kind).toLowerCase()}${you}`;
	}
</script>

<ol class="strip" class:compact aria-label="Round history">
	{#each all as s (s.round)}
		{#if s.switchBefore && s.round > 1}
			<li class="marker" aria-hidden="true">
				<span>{s.overtime ? 'OT' : 'HT'}</span>
			</li>
		{/if}
		<li
			class="pip"
			class:ct={s.pip?.winner === 'CT'}
			class:t={s.pip?.winner === 'T'}
			class:mine={s.pip?.iWon === true}
			class:current={!s.pip && s.round === current}
			class:ot={s.overtime}
			title={title(s)}
		>
			{#if s.pip}
				<span class="glyph">{winKindGlyph(s.pip.kind)}</span>
			{:else}
				<span class="n">{s.round}</span>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.strip {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.28em;
	}
	.pip {
		width: 1.75em;
		height: 1.75em;
		border-radius: 0.35em;
		display: grid;
		place-items: center;
		background: var(--panel-2);
		border: 1px solid var(--line-2);
		color: var(--dim);
		font-size: 0.95em;
		position: relative;
	}
	.compact .pip {
		width: 1.2em;
		height: 1.2em;
		font-size: 0.8em;
		border-radius: 0.25em;
	}
	.pip.ct {
		background: var(--ct-strong);
		border-color: var(--ct);
		color: #fff;
	}
	.pip.t {
		background: var(--t-strong);
		border-color: var(--t);
		color: #1a1000;
	}
	/* Rounds your team won get a bright underline. */
	.pip.mine::after {
		content: '';
		position: absolute;
		left: 18%;
		right: 18%;
		bottom: -0.32em;
		height: 0.14em;
		border-radius: 1px;
		background: var(--win);
	}
	.pip.current {
		border-color: var(--text);
		color: var(--text);
		animation: pulse 1.6s ease-in-out infinite;
	}
	.pip.ot:not(.ct):not(.t) {
		border-style: dashed;
	}
	.n {
		font-size: 0.7em;
		font-variant-numeric: tabular-nums;
	}
	.glyph {
		font-size: 0.85em;
		line-height: 1;
	}
	.marker {
		display: grid;
		place-items: center;
		padding: 0 0.15em;
		color: var(--muted);
		font-size: 0.62em;
		font-weight: 700;
		letter-spacing: 0.06em;
		border-left: 2px solid var(--line-2);
		height: 1.9em;
		margin-left: 0.15em;
	}
	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 0.25em rgb(255 255 255 / 0.08);
		}
	}
</style>
