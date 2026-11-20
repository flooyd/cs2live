<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PlayerProfile } from '#lib/server/db/stats/players.ts';
	import { isFakeSteamId, profileUrl } from '#lib/cs2/steamid.ts';
	import { date } from '#lib/format.ts';

	interface Props {
		steamId: string;
		profile: PlayerProfile | null;
		isMe?: boolean;
	}

	let { steamId, profile, isMe = false }: Props = $props();
	const onStats = $derived(page.url.pathname.endsWith('/stats'));
</script>

<header class="player">
	<div class="who">
		<h1>{profile?.name ?? 'Unknown player'}</h1>
		<div class="meta">
			<code>{steamId}</code>
			<a href={profileUrl(steamId)} rel="external noopener" target="_blank">Steam profile ↗</a>
			{#if isMe}<span class="chip ct">You</span>{/if}
			{#if profile?.claimed}<span class="chip" title="Claimed by a CS2Live account">
					CS2Live user
				</span>{/if}
			{#if isFakeSteamId(steamId)}<span class="chip warn" title="Created by yarn db:seed">
					Simulated data
				</span>{/if}
		</div>
		{#if profile}
			<p class="muted counts">
				{profile.recorded} match{profile.recorded === 1 ? '' : 'es'} recorded ·
				{#if profile.sighted}
					<span class="inferred" title="Games where someone running CS2Live spectated this player">
						seen in {profile.sighted} more
					</span>
					·
				{/if}
				first seen {date(profile.firstSeenAt)}
			</p>
		{/if}
	</div>
	<nav class="tabs">
		<a href={resolve('/(app)/players/[steamid]', { steamid: steamId })} class:on={!onStats}>
			Matches
		</a>
		<a href={resolve('/(app)/players/[steamid]/stats', { steamid: steamId })} class:on={onStats}>
			Stats
		</a>
	</nav>
</header>

<style>
	.player {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		margin-bottom: 1.2rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--line);
	}
	h1 {
		font-size: 1.9rem;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.8rem;
		align-items: center;
		margin-top: 0.3rem;
	}
	code {
		font-family: var(--mono);
		color: var(--muted);
	}
	.counts {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: var(--radius);
		background: var(--panel);
		border: 1px solid var(--line);
	}
	.tabs a {
		padding: 0.4rem 1rem;
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-weight: 600;
	}
	.tabs a:hover {
		text-decoration: none;
		color: var(--text);
	}
	.tabs a.on {
		background: var(--panel-2);
		color: var(--text);
	}
</style>
