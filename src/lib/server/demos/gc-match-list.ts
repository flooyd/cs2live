// Decodes what the Steam Game Coordinator says about your recent official matches: the
// CMsgGCCStrike15_v2_MatchList message boiler-writter writes, and the CDataGCCStrike15_v2_MatchInfo
// message CS2 saves next to a downloaded demo (`match730_….dem.info`). Only the fields CS2Live
// uses, with a minimal protobuf reader instead of a dependency. Pure.
//
// Field numbers (SteamDatabase/Protobufs, csgo/cstrike15_gcmessages.proto):
//   MatchList   2 accountid, 4 matches (MatchInfo)
//   MatchInfo   1 matchid, 2 matchtime, 4 roundstats_legacy, 5 roundstatsall (RoundStats)
//   RoundStats  2 reservation (Reserve), 3 map (the demo URL), 12 team_scores, 15 match_duration
//   Reserve     1 account_ids
// Checked against real .dem.info files (Nov 2026).

export interface GcMatch {
	/** uint64, as a decimal string. */
	matchId: string;
	/** Epoch ms of `matchtime`: when the match started. */
	matchTime: number;
	/** Steam account IDs (SteamID64 minus 76561197960265728) of the players. */
	accountIds: number[];
	teamScores: number[];
	/** Where Valve serves the demo (`http://replayNNN.valve.net/730/….dem.bz2`); null when gone. */
	demoUrl: string | null;
	durationS: number | null;
	/** The encoded MatchInfo, which is what CS2 saves next to a demo as `.dem.info`. */
	info?: Uint8Array;
}

export interface GcMatchList {
	/** The account the Game Coordinator answered for (the Steam account that is logged in). */
	accountId: number | null;
	matches: GcMatch[];
}

export class ProtobufError extends Error {}

type Value = { wt: 0; v: bigint } | { wt: 2; v: Uint8Array } | { wt: 1 | 5; v: null };

/** Every field of one message, in order, grouped by field number. */
function readMessage(b: Uint8Array): Map<number, Value[]> {
	const out = new Map<number, Value[]>();
	let i = 0;
	const varint = (): bigint => {
		let v = 0n;
		let shift = 0n;
		for (;;) {
			if (i >= b.length) throw new ProtobufError('truncated varint');
			const x = b[i++];
			v |= BigInt(x & 0x7f) << shift;
			if (x < 0x80) return v;
			shift += 7n;
			if (shift > 63n) throw new ProtobufError('varint too long');
		}
	};
	while (i < b.length) {
		const key = varint();
		const field = Number(key >> 3n);
		const wt = Number(key & 7n);
		let value: Value;
		if (wt === 0) value = { wt, v: varint() };
		else if (wt === 2) {
			const len = Number(varint());
			if (i + len > b.length) throw new ProtobufError('truncated field');
			value = { wt, v: b.subarray(i, i + len) };
			i += len;
		} else if (wt === 1 || wt === 5) {
			i += wt === 1 ? 8 : 4;
			if (i > b.length) throw new ProtobufError('truncated fixed field');
			value = { wt, v: null };
		} else throw new ProtobufError(`unsupported wire type ${wt}`);
		if (field === 0) throw new ProtobufError('field 0');
		const list = out.get(field);
		if (list) list.push(value);
		else out.set(field, [value]);
	}
	return out;
}

/** A repeated integer field, packed or not. */
function ints(m: Map<number, Value[]>, field: number): bigint[] {
	const out: bigint[] = [];
	for (const value of m.get(field) ?? []) {
		if (value.wt === 0) out.push(value.v);
		else if (value.wt === 2) {
			// Packed: the bytes are a run of varints.
			let i = 0;
			const b = value.v;
			while (i < b.length) {
				let v = 0n;
				let shift = 0n;
				for (;;) {
					if (i >= b.length) throw new ProtobufError('truncated packed varint');
					const x = b[i++];
					v |= BigInt(x & 0x7f) << shift;
					if (x < 0x80) break;
					shift += 7n;
				}
				out.push(v);
			}
		}
	}
	return out;
}

const int = (m: Map<number, Value[]>, field: number): bigint | null => {
	const value = m.get(field)?.at(-1);
	return value?.wt === 0 ? value.v : null;
};

const bytes = (m: Map<number, Value[]>, field: number): Uint8Array[] =>
	(m.get(field) ?? []).flatMap((value) => (value.wt === 2 ? [value.v] : []));

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** int32 fields are sign-extended to 64 bits on the wire. */
const int32 = (v: bigint) => Number(BigInt.asIntN(32, v));

function decodeMatch(b: Uint8Array): GcMatch {
	const m = readMessage(b);
	const matchId = int(m, 1);
	if (matchId === null) throw new ProtobufError('match without an id');
	const rounds = [...bytes(m, 4), ...bytes(m, 5)].map(readMessage);
	const last = rounds.at(-1);
	let demoUrl: string | null = null;
	for (const r of rounds.toReversed()) {
		const url = bytes(r, 3)
			.map(text)
			.find((s) => /^https?:\/\//.test(s));
		if (url) {
			demoUrl = url;
			break;
		}
	}
	let accountIds: number[] = [];
	for (const r of rounds) {
		const reserve = bytes(r, 2)[0];
		if (!reserve) continue;
		accountIds = ints(readMessage(reserve), 1)
			.map((v) => Number(BigInt.asUintN(32, v)))
			.filter((id) => id > 0);
		if (accountIds.length) break;
	}
	const duration = last ? int(last, 15) : null;
	return {
		matchId: matchId.toString(),
		matchTime: Number(int(m, 2) ?? 0n) * 1000,
		accountIds,
		teamScores: last ? ints(last, 12).map(int32) : [],
		demoUrl,
		durationS: duration === null ? null : int32(duration),
		info: b
	};
}

/** CMsgGCCStrike15_v2_MatchList (boiler-writter's output). Throws ProtobufError when malformed. */
export function decodeMatchList(b: Uint8Array): GcMatchList {
	const m = readMessage(b);
	const account = int(m, 2);
	return {
		accountId: account === null ? null : Number(BigInt.asUintN(32, account)),
		matches: bytes(m, 4).map(decodeMatch)
	};
}

/** CDataGCCStrike15_v2_MatchInfo (a `.dem.info` file). Throws ProtobufError when malformed. */
export function decodeMatchInfo(b: Uint8Array): GcMatch {
	return decodeMatch(b);
}

/**
 * The name (without `.dem`) CS2 gives a match's demo in its replays folder,
 * `match730_<reservation id>_<tv port>_<replay server>`: Valve's demo address
 * `http://replay<server>.valve.net/730/<reservation id>_<tv port>.dem.bz2` rearranged. Null for an
 * address of another shape. Checked against CS2's own downloads (Nov 2026).
 */
export function cs2DemoName(demoUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(demoUrl);
	} catch {
		return null;
	}
	const server = /^replay(\d+)\./i.exec(url.hostname)?.[1];
	const file = /\/(\d+_\d+)\.dem(?:\.bz2)?$/i.exec(url.pathname)?.[1];
	return server && file ? `match730_${file}_${server}` : null;
}
