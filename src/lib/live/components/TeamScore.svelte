<script lang="ts">
	import { scale } from 'svelte/transition';
	import type { TeamView } from '#lib/live/types.ts';
	import type { Side } from '#lib/cs2/rounds.ts';

	interface Props {
		side: Side;
		team: TeamView;
		mine: boolean;
		align?: 'left' | 'right';
	}

	let { side, team, mine, align = 'left' }: Props = $props();
</script>

<div class="team {side.toLowerCase()}" class:right={align === 'right'} class:mine>
	<div class="meta">
		<span class="side">{side}</span>
		{#if mine}<span class="you">YOU</span>{/if}
		{#if team.name}<span class="name">{team.name}</span>{/if}
	</div>
	<div class="score num">
		{#key team.score}
			<span in:scale={{ start: 1.35, duration: 380 }}>{team.score}</span>
		{/key}
	</div>
	<div class="sub">
		{#if team.consecutiveLosses > 0}
			<span title="Consecutive round losses (sets the loss bonus)">
				Loss streak {team.consecutiveLosses}
			</span>
		{/if}
		{#if team.timeoutsRemaining !== null}
			<span title="Tactical timeouts left">
				{team.timeoutsRemaining} timeout{team.timeoutsRemaining === 1 ? '' : 's'} left
			</span>
		{/if}
	</div>
</div>

<style>
	.team {
		display: grid;
		gap: 0.1em;
		justify-items: start;
	}
	.team.right {
		justify-items: end;
		text-align: right;
	}
	.meta {
		display: flex;
		gap: 0.5em;
		align-items: center;
		font-weight: 700;
		letter-spacing: 0.08em;
		font-size: 0.85em;
	}
	.right .meta {
		flex-direction: row-reverse;
	}
	.side {
		font-size: 1.1em;
	}
	.ct .side,
	.ct .score {
		color: var(--ct);
	}
	.t .side,
	.t .score {
		color: var(--t);
	}
	.you {
		background: var(--text);
		color: var(--bg);
		padding: 0.05em 0.45em;
		border-radius: 0.3em;
		font-size: 0.75em;
	}
	.name {
		color: var(--muted);
		letter-spacing: 0.02em;
		font-weight: 600;
	}
	.score {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 4.6em;
		line-height: 0.95;
	}
	.score span {
		display: inline-block;
	}
	.mine .score {
		text-shadow: 0 0 0.35em currentColor;
	}
	.sub {
		display: flex;
		gap: 0.75em;
		color: var(--muted);
		font-size: 0.8em;
		font-variant-numeric: tabular-nums;
		min-height: 1.2em;
	}
</style>
