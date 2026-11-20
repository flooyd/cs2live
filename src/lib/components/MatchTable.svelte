<script lang="ts">
	import { resolve } from '$app/paths';
	import type { MatchListRow } from '#lib/server/db/stats/matches.ts';
	import { mapLabel, modeLabel } from '#lib/cs2/modes.ts';
	import { dateTime, duration, fixed, pct, resultLabel } from '#lib/format.ts';

	interface Props {
		rows: MatchListRow[];
		/** Global list: show who recorded each game instead of a personal result. */
		global?: boolean;
	}

	let { rows, global = false }: Props = $props();

	const resultClass = (r: string | null) =>
		r === 'win' ? 'win' : r === 'loss' ? 'loss' : r === 'tie' ? 'tie' : 'none';
</script>

<div class="scroll">
	<table class="data matches">
		<thead>
			<tr>
				<th>When</th>
				<th>Map</th>
				<th>{global ? 'Score' : 'Result'}</th>
				<th class="r">K</th>
				<th class="r">A</th>
				<th class="r">D</th>
				<th class="r" title="Average damage per round">ADR</th>
				<th class="r" title="Headshot kills as a share of kills">HS%</th>
				<th>{global ? 'Recorded by' : ''}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as m (m.id)}
				{@const href = resolve('/(app)/matches/[id]', { id: m.id })}
				<tr class:partial={m.kind === 'sighting'}>
					<td class="when">
						<a {href}>{dateTime(m.startedAt)}</a>
						<span class="dim small">{duration(m.durationS)}</span>
					</td>
					<td>
						<a {href} class="map">{mapLabel(m.map)}</a>
						<span class="dim small">{modeLabel(m.mode)}</span>
					</td>
					<td>
						{#if global}
							<span class="num score">{m.scoreMine}–{m.scoreTheirs}</span>
							{#if m.status === 'incomplete'}<span class="chip warn">Incomplete</span>{/if}
						{:else}
							<span class="res {resultClass(m.result)}">
								{m.result ? resultLabel(m.result) : '?'}
							</span>
							<span class="num score">{m.scoreMine}–{m.scoreTheirs}</span>
						{/if}
					</td>
					<td class="r num">{m.kills ?? '—'}</td>
					<td class="r num">{m.assists ?? '—'}</td>
					<td class="r num">{m.deaths ?? '—'}</td>
					<td class="r num">{fixed(m.adr)}</td>
					<td class="r num">{pct(m.hsPct)}</td>
					<td class="who">
						{#if global}
							<a href={resolve('/(app)/players/[steamid]', { steamid: m.recorderSteamId })}>
								{m.recorderName ?? m.recorderSteamId}
							</a>
							{#if m.recordings > 1}<span class="chip" title="Recorded by more than one player">
									+{m.recordings - 1}
								</span>{/if}
						{:else if m.kind === 'sighting'}
							<span
								class="chip inferred-chip"
								title="Seen while {m.recorderName ??
									'a recorder'} spectated. Stats are as last seen, not final."
							>
								Partial
							</span>
							<span class="dim small">
								{m.teammate === false ? 'vs' : 'with'}
								<a href={resolve('/(app)/players/[steamid]', { steamid: m.recorderSteamId })}>
									{m.recorderName ?? m.recorderSteamId}
								</a>
							</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	.matches {
		min-width: 720px;
	}
	.matches td {
		vertical-align: middle;
	}
	.when,
	td:nth-child(2) {
		white-space: nowrap;
	}
	.when a,
	.map {
		color: var(--text);
		font-weight: 600;
		margin-right: 0.4rem;
	}
	.small {
		font-size: 0.8rem;
	}
	.res {
		display: inline-block;
		min-width: 4.6em;
		font-weight: 700;
	}
	.res.win {
		color: var(--win);
	}
	.res.loss {
		color: var(--loss);
	}
	.res.tie,
	.res.none {
		color: var(--muted);
	}
	.score {
		font-weight: 600;
	}
	.partial td {
		color: var(--muted);
	}
	.inferred-chip {
		border-style: dashed;
	}
	.who {
		white-space: nowrap;
	}
</style>
