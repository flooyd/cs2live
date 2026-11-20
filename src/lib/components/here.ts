import { page } from '$app/state';
import type { ResolvedPathname } from '$app/types';

/**
 * A link to the current page with a different query string (filters, paging). The current
 * pathname already carries the base path, so it is a resolved pathname.
 */
export function here(query: string): ResolvedPathname {
	const q = query.replace(/^\?/, '');
	return `${page.url.pathname}${q ? `?${q}` : ''}` as ResolvedPathname;
}
