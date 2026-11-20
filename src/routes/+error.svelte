<script lang="ts">
	// Fallback for errors outside the app shell: the full-screen live view and overlay, or a
	// failing app layout. Kept bare so it works on a second monitor or in OBS.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head><title>Error · CS2Live</title></svelte:head>

<main class="err">
	<p class="code num">{page.status}</p>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	{#if page.error?.ref}<p class="dim">Reference <code>{page.error.ref}</code></p>{/if}
	<p><a href={resolve('/(app)')}>CS2Live home</a></p>
</main>

<style>
	.err {
		min-height: 100dvh;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.2rem;
		padding: 1rem;
		text-align: center;
		background: var(--bg);
	}
	.code {
		font-size: 3rem;
		font-weight: 800;
		color: var(--dim);
		margin: 0;
	}
	p {
		margin: 0.2rem 0;
	}
</style>
