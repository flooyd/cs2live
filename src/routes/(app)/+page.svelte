<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import MatchTable from '#lib/components/MatchTable.svelte';
	import { ago } from '#lib/format.ts';

	let { data }: PageProps = $props();
	const ctx = $derived(data.ctx);
	const canLookUp = $derived(ctx.hasDb || !!ctx.siteUrl);
</script>

<svelte:head><title>CS2Live · Counter-Strike 2 match history</title></svelte:head>

<section class="hero">
	<h1>Look up a player</h1>
	<p class="muted">
		Matches recorded by anyone running CS2Live, including games where they spectated you.
	</p>
	<form method="GET" class="search" role="search">
		<input
			class="input"
			name="q"
			value={data.q}
			placeholder="Steam ID, steamcommunity.com/profiles/… link, or name"
			aria-label="Steam ID, profile link or player name"
			autocomplete="off"
			spellcheck="false"
			disabled={!canLookUp}
		/>
		<button class="btn primary" disabled={!canLookUp}>Look up</button>
	</form>
	{#if data.message}<p class="message">{data.message}</p>{/if}

	{#if ctx.mySteamId && ctx.hasDb}
		<p>
			<a class="btn" href={resolve('/(app)/players/[steamid]', { steamid: ctx.mySteamId })}>
				My matches
			</a>
			<a class="btn" href={resolve('/(app)/players/[steamid]/stats', { steamid: ctx.mySteamId })}>
				My stats
			</a>
			{#if ctx.liveEnabled}<a class="btn" href={resolve('/(screen)/live')}>Live view</a>{/if}
		</p>
	{:else if ctx.liveEnabled}
		<p><a class="btn" href={resolve('/(screen)/live')}>Open the live view</a></p>
	{/if}
</section>

{#if data.hits.length}
	<section class="panel hits">
		<h2>Players</h2>
		<ul>
			{#each data.hits as h (h.steamId)}
				<li>
					<a href={resolve('/(app)/players/[steamid]', { steamid: h.steamId })}>
						<strong>{h.name ?? 'Unknown'}</strong>
						<code class="dim">{h.steamId}</code>
					</a>
					<span class="muted small">
						{h.recorded} recorded · seen in {h.sighted} · last seen {ago(h.lastSeenAt.getTime())}
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if !ctx.hasDb}
	<section class="panel note">
		{#if ctx.siteUrl}
			<p>
				This copy of CS2Live uploads to <a href={ctx.siteUrl} rel="external">{ctx.siteUrl}</a>.
				Match history and stats are there; lookups here open on that site.
			</p>
		{:else}
			<p>
				This copy of CS2Live has no database and no upload site yet, so it only does live tracking.
				Add the site URL and your upload key on the <a href={resolve('/(app)/setup')}>Setup</a> page to
				keep your matches.
			</p>
		{/if}
	</section>
{:else}
	<section class="recent">
		<div class="head">
			<h2>Latest matches</h2>
			<a href={resolve('/(app)/matches')}>All matches →</a>
		</div>
		{#if data.recent.length}
			<MatchTable rows={data.recent} global />
		{:else}
			<p class="muted">
				No matches yet. They appear here when someone running CS2Live finishes one.
			</p>
		{/if}
	</section>
{/if}

<style>
	.hero {
		max-width: 760px;
		margin: 2.5rem auto 2rem;
		text-align: center;
		display: grid;
		gap: 0.8rem;
	}
	.hero h1 {
		font-size: clamp(1.8rem, 4vw, 2.6rem);
	}
	.hero p {
		margin: 0;
	}
	.search {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.search .input {
		flex: 1;
		font-size: 1.05rem;
		padding: 0.75rem 0.9rem;
	}
	.message {
		color: var(--warn);
	}
	.hero .btn {
		margin: 0 0.25rem;
	}
	.hits {
		max-width: 760px;
		margin: 0 auto 2rem;
		padding: 1rem 1.2rem;
	}
	.hits ul {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.hits li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.3rem 1rem;
	}
	.hits a {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.small {
		font-size: 0.85rem;
	}
	.note {
		max-width: 760px;
		margin: 0 auto;
		padding: 1rem 1.2rem;
	}
	.note p {
		margin: 0;
	}
	.recent .head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.6rem;
	}
	h2 {
		font-size: 1.15rem;
	}
	@media (max-width: 560px) {
		.search {
			flex-direction: column;
		}
	}
</style>
