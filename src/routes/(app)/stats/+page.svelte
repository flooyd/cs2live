<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ctx = $derived(data.ctx);
</script>

<svelte:head><title>Stats · CS2Live</title></svelte:head>

<div class="panel note">
	<h1>Your stats</h1>
	{#if !ctx.mySteamId}
		{#if ctx.liveEnabled}
			<p>
				Set your Steam ID on the <a href={resolve('/(app)/setup')}>Setup</a> page first.
			</p>
		{:else if ctx.user}
			<p>
				Claim your Steam ID on your <a href={resolve('/(app)/account')}>account page</a> first.
			</p>
		{:else}
			<p>
				<a href={resolve('/(app)/account/login')}>Sign in</a> to see your own stats, or
				<a href={resolve('/(app)')}>look up</a> any player.
			</p>
		{/if}
	{:else}
		<p class="muted">
			This copy of CS2Live keeps no match history. Add the site URL on the
			<a href={resolve('/(app)/setup')}>Setup</a> page.
		</p>
	{/if}
</div>

<style>
	.note {
		max-width: 640px;
		margin: 2rem auto;
		padding: 1.5rem;
		display: grid;
		gap: 0.6rem;
	}
	h1 {
		font-size: 1.4rem;
	}
	p {
		margin: 0;
	}
</style>
