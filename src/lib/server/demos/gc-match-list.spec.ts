import { describe, expect, it } from 'vitest';
import { decodeMatchInfo, decodeMatchList, ProtobufError } from './gc-match-list.ts';

// A minimal protobuf encoder, enough to build the Game Coordinator's messages.
const varint = (value: bigint | number): number[] => {
	let n = BigInt.asUintN(64, BigInt(value));
	const out: number[] = [];
	do {
		let byte = Number(n & 0x7fn);
		n >>= 7n;
		if (n) byte |= 0x80;
		out.push(byte);
	} while (n);
	return out;
};
const key = (field: number, wt: number) => varint((field << 3) | wt);
const int = (field: number, v: bigint | number) => [...key(field, 0), ...varint(v)];
const msg = (field: number, body: number[]) => [...key(field, 2), ...varint(body.length), ...body];
const str = (field: number, s: string) => msg(field, [...new TextEncoder().encode(s)]);
const fixed32 = (field: number) => [...key(field, 5), 1, 2, 3, 4];

const URL_A = 'http://replay404.valve.net/730/003800000000000000001_0123456789.dem.bz2';

function roundStats(opts: {
	accounts?: number[];
	packed?: boolean;
	url?: string;
	scores?: number[];
}) {
	const reserve = opts.packed
		? msg(
				1,
				(opts.accounts ?? []).flatMap((a) => varint(a))
			)
		: (opts.accounts ?? []).flatMap((a) => int(1, a));
	return [
		...int(1, 7_000_000_000_000_000_001n),
		...(opts.accounts ? msg(2, [...reserve, ...int(2, 4106)]) : []),
		...(opts.url ? str(3, opts.url) : []),
		...(opts.scores ?? []).flatMap((s) => int(12, s)),
		...int(15, 733),
		...fixed32(40)
	];
}

const matchInfo = (id: bigint, time: number, rounds: number[][], legacy?: number[]) => [
	...int(1, id),
	...int(2, time),
	...msg(3, [...int(1, 404), ...str(10, 'de_inferno')]),
	...(legacy ? msg(4, legacy) : []),
	...rounds.flatMap((r) => msg(5, r))
];

describe('decodeMatchList', () => {
	it('reads matches, players, scores and the demo address from the last round', () => {
		const bytes = new Uint8Array([
			...int(1, 1),
			...int(2, 4_294_900_100),
			...int(3, 1_795_000_000),
			...msg(
				4,
				matchInfo(3_800_000_000_000_000_001n, 1_795_000_000, [
					roundStats({ accounts: [11, 22, 0, 0, 0, 33, 4_294_900_100] }),
					roundStats({ url: URL_A, scores: [9, 7] })
				])
			),
			...msg(
				4,
				matchInfo(3_800_000_000_000_000_002n, 1_795_003_600, [
					roundStats({ accounts: [44, 4_294_900_100], packed: true, scores: [13, 11] })
				])
			)
		]);
		const list = decodeMatchList(bytes);
		expect(list.accountId).toBe(4_294_900_100);
		expect(list.matches).toEqual([
			{
				matchId: '3800000000000000001',
				matchTime: 1_795_000_000_000,
				accountIds: [11, 22, 33, 4_294_900_100],
				teamScores: [9, 7],
				demoUrl: URL_A,
				durationS: 733
			},
			{
				matchId: '3800000000000000002',
				matchTime: 1_795_003_600_000,
				accountIds: [44, 4_294_900_100],
				teamScores: [13, 11],
				demoUrl: null,
				durationS: 733
			}
		]);
	});

	it('reads a .dem.info file (round stats in the legacy field, no demo address)', () => {
		const info = decodeMatchInfo(
			new Uint8Array(
				matchInfo(
					3_800_000_000_000_000_003n,
					1_795_000_000,
					[],
					roundStats({ accounts: [1, 2], scores: [8, 8] })
				)
			)
		);
		expect(info).toMatchObject({
			matchId: '3800000000000000003',
			accountIds: [1, 2],
			teamScores: [8, 8],
			demoUrl: null
		});
	});

	it('reads negative int32 values', () => {
		const info = decodeMatchInfo(
			new Uint8Array(matchInfo(1n, 1, [roundStats({ scores: [-1, 3] })]))
		);
		expect(info.teamScores).toEqual([-1, 3]);
	});

	it('handles an empty list and rejects malformed input', () => {
		expect(decodeMatchList(new Uint8Array())).toEqual({ accountId: null, matches: [] });
		const truncated = new Uint8Array(msg(4, matchInfo(1n, 1, [])).slice(0, 5));
		expect(() => decodeMatchList(truncated)).toThrow(ProtobufError);
		expect(() => decodeMatchList(new Uint8Array([0x0b, 0x01]))).toThrow(ProtobufError);
	});
});
