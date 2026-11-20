<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ctx = $derived(data.ctx);
</script>

<svelte:head><title>CS2Live</title></svelte:head>

<section class="hero">
	<h1><span class="ct">CS2</span><span class="t">Live</span></h1>
	<p class="muted">Live Counter-Strike 2 tracking, match history and stats.</p>
	{#if ctx.liveEnabled}
		<a class="btn primary" href={resolve('/(screen)/live')}>Open the live view</a>
	{/if}
</section>
