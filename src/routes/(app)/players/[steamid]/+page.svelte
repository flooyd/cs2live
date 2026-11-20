<script lang="ts">
	import type { PageProps } from './$types';
	import PlayerHeader from '#lib/components/PlayerHeader.svelte';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import MatchTable from '#lib/components/MatchTable.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import RemoteNote from '#lib/components/RemoteNote.svelte';
	import { isFiltered } from '#lib/match-filters.ts';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.remote ? 'Player' : (data.profile?.name ?? data.steamId)} · Matches · CS2Live</title>
</svelte:head>

{#if data.remote}
	<RemoteNote siteUrl={data.siteUrl} path="/players/{data.steamId}" />
{:else}
	<PlayerHeader steamId={data.steamId} profile={data.profile} isMe={data.isMe} />

	{#if !data.profile}
		<div class="panel empty">
			<h2>No matches with this player yet</h2>
			<p class="muted">
				Matches show up here when this player records one with CS2Live, or when a friend who runs it
				spectates them. Only players someone has played with are known to the site.
			</p>
		</div>
	{:else}
		<FilterBar
			filters={data.filters}
			maps={data.options.maps}
			modes={data.options.modes}
			showResult
			showSightings
		/>
		{#if data.list.rows.length}
			<MatchTable rows={data.list.rows} />
			<Pager filters={data.filters} {...data.list} />
			{#if data.filters.sightings && data.list.rows.some((r) => r.kind === 'sighting')}
				<p class="dim note">
					<span class="inferred">Partial</span> rows come from someone else's recording: CS2 only sends
					another player's stats while you spectate them, so their K/A/D is as last seen and ADR is unknown.
				</p>
			{/if}
		{:else}
			<div class="panel empty">
				<p class="muted">
					{isFiltered(data.filters)
						? 'No matches fit these filters.'
						: 'No matches to show. Turn on partial sightings to see games where this player was spectated.'}
				</p>
			</div>
		{/if}
	{/if}
{/if}

<style>
	.empty {
		padding: 1.5rem;
		text-align: center;
	}
	.empty p {
		margin: 0.5rem 0 0;
	}
	.note {
		font-size: 0.85rem;
		margin-top: 1rem;
	}
</style>
