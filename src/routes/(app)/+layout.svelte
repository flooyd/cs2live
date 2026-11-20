<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const ctx = $derived(data.ctx);

	const active = (prefix: string) =>
		prefix === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(prefix);
</script>

<div class="shell">
	<header class="top">
		<a class="brand" href={resolve('/(app)')}>
			<span class="logo" aria-hidden="true">
				<span class="ct">CS2</span><span class="t">Live</span>
			</span>
		</a>
		<nav>
			<a href={resolve('/(app)')} class:on={active('/')}>Lookup</a>
			{#if ctx.hasDb}
				<a href={resolve('/(app)/matches')} class:on={active('/matches')}>Matches</a>
			{/if}
			{#if ctx.mySteamId && ctx.hasDb}
				<a
					href={resolve('/(app)/players/[steamid]', { steamid: ctx.mySteamId })}
					class:on={active(`/players/${ctx.mySteamId}`)}
				>
					My matches
				</a>
				<a href={resolve('/(app)/stats')} class:on={active('/stats')}>Stats</a>
			{/if}
			{#if ctx.liveEnabled}
				<a href={resolve('/(screen)/live')}>Live</a>
				<a href={resolve('/(app)/setup')} class:on={active('/setup')}>Setup</a>
			{/if}
		</nav>
		<div class="account">
			{#if ctx.hasDb}
				{#if ctx.user}
					<a href={resolve('/(app)/account')} class:on={active('/account')}>{ctx.user.name}</a>
				{:else}
					<a href={resolve('/(app)/account/login')}>Sign in</a>
				{/if}
			{/if}
		</div>
	</header>

	<main>
		{@render children()}
	</main>

	<footer class="foot">
		<span>CS2Live reads Counter-Strike 2's Game State Integration feed.</span>
		<span class="dim">
			Values marked <span class="inferred" title="Example of an inferred value">like this</span> are inferred
			or estimated.
		</span>
	</footer>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto 1fr auto;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.7rem 1.5rem;
		border-bottom: 1px solid var(--line);
		background: var(--bg-2);
		position: sticky;
		top: 0;
		z-index: 10;
	}
	.brand:hover {
		text-decoration: none;
	}
	.logo {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.25rem;
		letter-spacing: 0.02em;
	}
	nav {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}
	nav a,
	.account a {
		color: var(--muted);
		padding: 0.35rem 0.7rem;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}
	nav a:hover,
	.account a:hover {
		color: var(--text);
		text-decoration: none;
		background: var(--panel);
	}
	nav a.on,
	.account a.on {
		color: var(--text);
		background: var(--panel-2);
	}
	.account {
		margin-left: auto;
	}
	main {
		width: 100%;
		max-width: 1280px;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--line);
		color: var(--muted);
		font-size: 0.82rem;
	}
	@media (max-width: 640px) {
		.top {
			flex-wrap: wrap;
			gap: 0.5rem;
			padding: 0.6rem 1rem;
		}
		main {
			padding: 1rem;
		}
	}
</style>
