<script lang="ts">
	import { filterQuery, type MatchFilters } from '#lib/match-filters.ts';
	import { here } from './here.ts';

	interface Props {
		filters: MatchFilters;
		page: number;
		pages: number;
		total: number;
	}

	let { filters, page, pages, total }: Props = $props();
	const href = (p: number) => here(filterQuery(filters, { page: p }));
</script>

{#if pages > 1}
	<nav class="pager" aria-label="Pages">
		{#if page > 1}<a class="btn" href={href(page - 1)} data-sveltekit-noscroll>← Newer</a>{/if}
		<span class="muted">Page {page} of {pages} · {total} matches</span>
		{#if page < pages}<a class="btn" href={href(page + 1)} data-sveltekit-noscroll>Older →</a>{/if}
	</nav>
{:else if total > 0}
	<p class="muted count">{total} match{total === 1 ? '' : 'es'}</p>
{/if}

<style>
	.pager {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: center;
		margin-top: 1rem;
	}
	.count {
		margin-top: 0.75rem;
		font-size: 0.9rem;
	}
</style>
