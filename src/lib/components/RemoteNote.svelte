<script lang="ts">
	import { resolve } from '$app/paths';

	// Shown on history pages of a local copy without a database: the data is on the site.
	interface Props {
		siteUrl: string | null;
		/** Path of the same page on the site, e.g. /players/7656… */
		path: string;
	}

	let { siteUrl, path }: Props = $props();
</script>

<div class="panel note">
	<h1>Match history lives on the site</h1>
	{#if siteUrl}
		<p>This copy of CS2Live uploads matches to <code>{siteUrl}</code>.</p>
		<p><a class="btn primary" href="{siteUrl}{path}" rel="external">Open this page there ↗</a></p>
	{:else}
		<p class="muted">
			This copy of CS2Live has no database, so it doesn't keep match history itself. Set the site
			URL and your upload key on the <a href={resolve('/(app)/setup')}>Setup</a> page.
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
	code {
		font-family: var(--mono);
	}
</style>
