<script lang="ts">
	import type { PageProps } from './$types';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import MatchTable from '#lib/components/MatchTable.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import RemoteNote from '#lib/components/RemoteNote.svelte';
	import { isFiltered } from '#lib/match-filters.ts';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Matches · CS2Live</title></svelte:head>

{#if data.remote}
	<RemoteNote siteUrl={data.siteUrl} path="/matches" />
{:else}
	<h1>Matches</h1>
	<p class="muted intro">
		Every game recorded by someone running CS2Live, newest first. A game recorded by several players
		is listed once; the score is from the recorder's side.
	</p>
	<FilterBar filters={data.filters} maps={data.options.maps} modes={data.options.modes} />
	{#if data.list.rows.length}
		<MatchTable rows={data.list.rows} global />
		<Pager filters={data.filters} {...data.list} />
	{:else}
		<div class="panel empty">
			<p class="muted">
				{isFiltered(data.filters)
					? 'No matches fit these filters.'
					: 'No matches yet. They appear here when someone running CS2Live finishes one.'}
			</p>
		</div>
	{/if}
{/if}

<style>
	h1 {
		font-size: 1.8rem;
	}
	.intro {
		margin: 0.3rem 0 1.2rem;
	}
	.empty {
		padding: 1.5rem;
		text-align: center;
	}
	.empty p {
		margin: 0;
	}
</style>
