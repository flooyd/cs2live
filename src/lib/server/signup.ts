/**
 * Whether an email may create an account.
 * - allowlist `*`: anyone
 * - allowlist of emails (comma separated, case-insensitive): only those
 * - no allowlist: only the very first account (the site owner)
 */
export function signupAllowed(email: string, allowlist: string | undefined, existingUsers: number) {
	const list = (allowlist ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (list.includes('*')) return true;
	if (list.length === 0) return existingUsers === 0;
	return list.includes(email.trim().toLowerCase());
}
