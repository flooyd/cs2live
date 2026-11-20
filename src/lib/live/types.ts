// The live state the server streams to /live and /overlay over SSE. Shared by server and
// browser; types only.
import type { Side, WinKind } from '#lib/cs2/rounds.ts';

export type TrackerStateName = 'idle' | 'warmup' | 'in_match' | 'gameover';

export interface TeamView {
	score: number;
	name: string | null;
	timeoutsRemaining: number | null;
	consecutiveLosses: number;
}

export interface RoundPip {
	round: number;
	winner: Side | null;
	kind: WinKind;
	reason: string;
	/** Your side that round, when the tracker saw it. */
	mySide: Side | null;
	iWon: boolean | null;
	/** Draw a halftime / side-switch marker before this pip. */
	switchBefore: boolean;
	overtime: boolean;
}

export interface WeaponView {
	name: string;
	label: string;
	type: string | null;
	clip: number | null;
	clipMax: number | null;
	reserve: number | null;
}

export interface MeView {
	steamId: string;
	name: string | null;
	team: Side | null;
	alive: boolean;
	health: number;
	armor: number;
	helmet: boolean;
	defuseKit: boolean;
	flashed: number;
	smoked: number;
	burning: number;
	money: number;
	equipValue: number;
	activeWeapon: WeaponView | null;
	primary: WeaponView | null;
	secondary: WeaponView | null;
	grenades: { name: string; count: number }[];
	hasBomb: boolean;
	/** True while we show your last known state because `player` is someone else. */
	stale: boolean;
}

export interface SpectatingView {
	steamId: string;
	name: string | null;
	team: Side | null;
	health: number | null;
	kills: number | null;
	assists: number | null;
	deaths: number | null;
	weapon: string | null;
}

export interface TimerView {
	/** freezetime | live | bomb | over | intermission | warmup | ... */
	phase: string;
	/** Server epoch ms when the phase is expected to end. */
	endsAt: number;
	/** True when derived from phase-change timestamps and standard timings, not from CS2. */
	estimated: boolean;
}

export interface SyncView {
	mode: 'direct' | 'upload' | 'none';
	target: string | null;
	pending: number;
	/** Matches the target refused, kept in outbox/rejected/. */
	rejected: number;
	lastError: string | null;
	lastSyncedAt: number | null;
	lastSyncedMatchId: string | null;
}

export interface ObserverPlayerView {
	steamId: string;
	name: string | null;
	team: Side | null;
	kills: number;
	assists: number;
	deaths: number;
	health: number | null;
	money: number | null;
}

/** One of your finished rounds in the current match. */
export interface RecentRound {
	number: number;
	mySide: Side | null;
	iWon: boolean | null;
	winKind: WinKind;
	kills: number;
	hsKills: number;
	damage: number;
	survived: boolean | null;
	buyType: string | null;
	equipValue: number | null;
}

export interface LiveView {
	serverTime: number;
	connection: {
		lastPayloadAt: number | null;
		payloadCount: number;
		providerSteamId: string | null;
		providerName: string | null;
		gsiVersion: number | null;
		tokenConfigured: boolean;
		capturing: boolean;
	};
	setup: {
		steamId: string | null;
		/** A different Steam account is sending data. */
		accountMismatch: boolean;
		sync: SyncView;
	};
	tracking: {
		state: TrackerStateName;
		matchId: string | null;
		/** A match is being recorded right now. */
		recording: boolean;
		ignoredReason: string | null;
		lastSavedMatchId: string | null;
		lastSavedAt: number | null;
	};
	activity: string | null;
	inGame: boolean;
	observer: boolean;
	map: {
		name: string;
		label: string;
		mode: string;
		modeLabel: string;
		phase: string;
		/** 1-based number of the round being played (or just finished). */
		round: number;
		ct: TeamView;
		t: TeamView;
		regulationRounds: number | null;
		halfLength: number | null;
	} | null;
	round: {
		phase: string | null;
		bomb: string | null;
		winTeam: Side | null;
	} | null;
	timer: TimerView | null;
	bombTimer: TimerView | null;
	history: RoundPip[];
	me: MeView | null;
	spectating: SpectatingView | null;
	matchStats: {
		kills: number;
		assists: number;
		deaths: number;
		mvps: number;
		score: number;
		adr: number | null;
		hsPct: number | null;
		kd: number | null;
		roundsCompleted: number;
	} | null;
	roundStats: { kills: number; hsKills: number; damage: number } | null;
	economy: {
		money: number;
		consecutiveLosses: number;
		ifWin: number;
		ifLoss: number;
		ifLossPlanted: number | null;
		/** Next round starts a new half, so money resets. */
		resetNext: boolean;
	} | null;
	allPlayers: ObserverPlayerView[] | null;
	/** Your finished rounds this match, newest first. */
	recentRounds: RecentRound[];
}
