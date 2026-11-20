<script lang="ts">
	import { here } from './here.ts';
	import { mapLabel, modeLabel } from '#lib/cs2/modes.ts';
	import { isFiltered, PERIODS, type MatchFilters } from '#lib/match-filters.ts';

	interface Props {
		filters: MatchFilters;
		maps: string[];
		modes: string[];
		/** Result filter (only meaningful from one player's point of view). */
		showResult?: boolean;
		/** "Include partial sightings" toggle (player match lists). */
		showSightings?: boolean;
	}

	let { filters, maps, modes, showResult = false, showSightings = false }: Props = $props();

	const PERIOD_LABELS: Record<keyof typeof PERIODS, string> = {
		'7d': 'Last 7 days',
		'30d': 'Last 30 days',
		'90d': 'Last 90 days',
		'365d': 'Last year'
	};

	const submit = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();
</script>

<!-- A plain GET form, so filters live in the URL and work without JavaScript. -->
<form class="filters" method="GET" data-sveltekit-keepfocus data-sveltekit-noscroll>
	<label>
		<span class="label">Map</span>
		<select class="input" name="map" value={filters.map ?? ''} onchange={submit}>
			<option value="">All maps</option>
			{#each maps as m (m)}<option value={m}>{mapLabel(m)}</option>{/each}
		</select>
	</label>
	<label>
		<span class="label">Mode</span>
		<select class="input" name="mode" value={filters.mode ?? ''} onchange={submit}>
			<option value="">All modes</option>
			{#each modes as m (m)}<option value={m}>{modeLabel(m)}</option>{/each}
		</select>
	</label>
	{#if showResult}
		<label>
			<span class="label">Result</span>
			<select class="input" name="result" value={filters.result ?? ''} onchange={submit}>
				<option value="">Any result</option>
				<option value="win">Wins</option>
				<option value="loss">Losses</option>
				<option value="tie">Ties</option>
				<option value="incomplete">Incomplete</option>
			</select>
		</label>
	{/if}
	<label>
		<span class="label">When</span>
		<select class="input" name="period" value={filters.period ?? ''} onchange={submit}>
			<option value="">All time</option>
			{#each Object.entries(PERIOD_LABELS) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
	</label>
	{#if showSightings}
		<label class="check" title="Games where a recorder spectated this player: stats as last seen">
			<!-- Checked sends sightings=1 first; unchecked sends only the hidden 0. -->
			<input
				type="checkbox"
				name="sightings"
				value="1"
				checked={filters.sightings}
				onchange={submit}
			/>
			<input type="hidden" name="sightings" value="0" />
			<span>Include <span class="inferred">partial</span> sightings</span>
		</label>
	{/if}
	<noscript><button class="btn">Apply</button></noscript>
	{#if isFiltered(filters)}
		<a class="clear" href={here(filters.sightings ? '' : 'sightings=0')}>Clear filters</a>
	{/if}
</form>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
		margin-bottom: 1rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	select {
		min-width: 9.5rem;
		padding-block: 0.45rem;
	}
	.check {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		padding-bottom: 0.5rem;
		cursor: pointer;
	}
	.clear {
		padding-bottom: 0.55rem;
		font-size: 0.9rem;
	}
</style>
