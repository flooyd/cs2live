// Steam ID parsing. Pure, works in the browser too.
//
// Accepted inputs:
//   76561198012345678                               SteamID64
//   https://steamcommunity.com/profiles/7656119...  profile URL
//   [U:1:52079950] / U:1:52079950                   SteamID3
//   STEAM_0:0:26039975 / STEAM_1:0:26039975         legacy SteamID2
//   52079950                                        bare 32-bit account ID (friend code)
// Vanity URLs (steamcommunity.com/id/name) need the Steam Web API to resolve; see
// `vanityName` for detecting them so the UI can explain that.

/** SteamID64 of account ID 0 for an individual account in the public universe. */
export const STEAMID64_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 0xffffffffn;

export type SteamIdParse =
	| { ok: true; steamId: string }
	| { ok: false; reason: 'empty' | 'vanity' | 'invalid'; vanity?: string };

function fromAccountId(accountId: bigint): string | null {
	if (accountId < 1n || accountId > MAX_ACCOUNT_ID) return null;
	return (STEAMID64_BASE + accountId).toString();
}

/** True for a 17-digit SteamID64 of an individual account. */
export function isSteamId64(value: string): boolean {
	if (!/^\d{17}$/.test(value)) return false;
	const n = BigInt(value);
	return n > STEAMID64_BASE && n <= STEAMID64_BASE + MAX_ACCOUNT_ID;
}

/** The vanity name in a steamcommunity.com/id/<name> URL, if that is what this is. */
export function vanityName(input: string): string | null {
	const m = input.trim().match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
	return m ? decodeURIComponent(m[1]) : null;
}

export function parseSteamId(input: string): SteamIdParse {
	const value = input.trim();
	if (!value) return { ok: false, reason: 'empty' };

	const profile = value.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
	if (profile && isSteamId64(profile[1])) return { ok: true, steamId: profile[1] };

	const vanity = vanityName(value);
	if (vanity) return { ok: false, reason: 'vanity', vanity };

	if (isSteamId64(value)) return { ok: true, steamId: value };

	const id3 = value.match(/^\[?U:1:(\d+)\]?$/i);
	if (id3) {
		const id = fromAccountId(BigInt(id3[1]));
		return id ? { ok: true, steamId: id } : { ok: false, reason: 'invalid' };
	}

	const id2 = value.match(/^STEAM_[01]:([01]):(\d+)$/i);
	if (id2) {
		const id = fromAccountId(BigInt(id2[2]) * 2n + BigInt(id2[1]));
		return id ? { ok: true, steamId: id } : { ok: false, reason: 'invalid' };
	}

	if (/^\d{1,10}$/.test(value)) {
		const id = fromAccountId(BigInt(value));
		return id ? { ok: true, steamId: id } : { ok: false, reason: 'invalid' };
	}

	return { ok: false, reason: 'invalid' };
}

export function profileUrl(steamId: string): string {
	return `https://steamcommunity.com/profiles/${steamId}`;
}

/** Synthetic Steam IDs used by the simulator and seed data sit at the very top of the
 * account-ID range, far above any real account, so they can never collide with a real one. */
export const FAKE_STEAMID_FIRST = STEAMID64_BASE + 4_294_900_000n;

export function fakeSteamId(n: number): string {
	return (FAKE_STEAMID_FIRST + BigInt(n)).toString();
}

export function isFakeSteamId(steamId: string): boolean {
	return isSteamId64(steamId) && BigInt(steamId) >= FAKE_STEAMID_FIRST;
}
