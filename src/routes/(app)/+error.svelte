<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const notFound = $derived(page.status === 404);
	const serverSide = $derived(page.status >= 500);
</script>

<svelte:head><title>{notFound ? 'Not found' : 'Error'} · CS2Live</title></svelte:head>

<section class="panel err">
	<p class="code num">{page.status}</p>
	<h1>{notFound ? 'Nothing here' : serverSide ? 'Something went wrong' : 'That did not work'}</h1>
	<p class="muted">
		{page.error?.message ??
			(notFound ? 'This page does not exist.' : 'The page could not be loaded.')}
	</p>
	{#if page.error?.ref}
		<p class="dim small">Reference <code>{page.error.ref}</code>, also in the server log.</p>
	{/if}
	<p class="links">
		<a class="btn primary" href={resolve('/(app)')}>Look up a player</a>
		{#if serverSide}
			<button class="btn" type="button" onclick={() => location.reload()}>Try again</button>
		{/if}
	</p>
</section>

<style>
	.err {
		max-width: 34rem;
		margin: 3rem auto;
		padding: 2rem;
		text-align: center;
	}
	.code {
		margin: 0;
		font-size: 3rem;
		font-weight: 800;
		color: var(--dim);
		line-height: 1;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0.6rem 0 0.4rem;
	}
	.small {
		font-size: 0.85rem;
	}
	.links {
		display: flex;
		justify-content: center;
		gap: 0.6rem;
		margin: 1.4rem 0 0;
	}
</style>
