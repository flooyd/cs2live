// The CS2 Game State Integration config template. CS2 reads every
// `gamestate_integration_*.cfg` in its cfg folder at startup.

export const GSI_CONFIG_FILENAME = 'gamestate_integration_cs2live.cfg';

/**
 * Data sections we ask for. While you are playing, CS2 only fills the `player_*` sections for
 * you (or the teammate you spectate). The `allplayers_*`, `bomb`, `grenades` and probably
 * `phase_countdowns` sections are generally only sent to spectators and observers. We request
 * them anyway and use them when present, but never depend on them.
 */
export const GSI_DATA_SECTIONS = [
	'provider',
	'map',
	'map_round_wins',
	'round',
	'player_id',
	'player_state',
	'player_weapons',
	'player_match_stats',
	'player_position',
	'phase_countdowns',
	'bomb',
	'grenades',
	'allplayers_id',
	'allplayers_state',
	'allplayers_match_stats',
	'allplayers_weapons',
	'allplayers_position'
] as const;

export function renderGsiConfig({ url, token }: { url: string; token: string }): string {
	const q = (s: string) => `"${s.replace(/"/g, '')}"`;
	const data = GSI_DATA_SECTIONS.map((k) => `\t\t${q(k).padEnd(28)}"1"`).join('\n');
	return `"CS2Live"
{
	"uri"        ${q(url)}
	"timeout"    "5.0"
	"buffer"     "0.1"
	"throttle"   "0.1"
	"heartbeat"  "10.0"
	"auth"
	{
		"token"  ${q(token)}
	}
	"data"
	{
${data}
	}
}
`;
}
