<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import RemoteNote from '#lib/components/RemoteNote.svelte';
	import RoundStrip from '#lib/live/components/RoundStrip.svelte';
	import ColumnChart, { type Column } from '#lib/components/charts/ColumnChart.svelte';
	import LineChart from '#lib/components/charts/LineChart.svelte';
	import { compactMoney } from '#lib/components/charts/scale.ts';
	import { mapLabel, modeLabel } from '#lib/cs2/modes.ts';
	import { buyLabel, type BuyType } from '#lib/cs2/economy.ts';
	import { parseWinReason, winKindLabel } from '#lib/cs2/rounds.ts';
	import { weaponLabel } from '#lib/cs2/weapons.ts';
	import { dateTime, duration, fixed, money, pct, resultLabel } from '#lib/format.ts';

	let { data }: PageProps = $props();

	const sideVar = (side: string | null) =>
		side === 'CT' ? 'var(--viz-ct)' : side === 'T' ? 'var(--viz-t)' : 'var(--viz-single)';
	const buy = (b: string | null) => (b ? buyLabel(b as BuyType) : '—');

	// CS2 currently sends no round_totaldmg, so damage is usually unknown (null) for every round.
	const hasDamage = $derived(!data.remote && data.rounds.some((r) => r.damage !== null));

	const damageColumns = $derived.by((): Column[] => {
		if (data.remote || !hasDamage) return [];
		return data.rounds.map((r) => ({
			key: r.number,
			label: String(r.number),
			value: r.damage ?? 0,
			color: sideVar(r.mySide),
			mark: r.iWon === null ? '' : r.iWon ? 'W' : 'L',
			tip: [
				r.damage === null ? 'Damage unknown' : `${r.damage} damage`,
				`Round ${r.number}${r.mySide ? ` · ${r.mySide}` : ''}${r.iWon === null ? '' : r.iWon ? ' · won' : ' · lost'}`,
				`${r.kills} kill${r.kills === 1 ? '' : 's'}${r.hsKills ? ` (${r.hsKills} HS)` : ''}${r.survived === false ? ' · died' : ''}`,
				`Buy: ${buy(r.buyType)} (est.)`
			]
		}));
	});

	const roundTitle = (i: number) => {
		const r = data.remote ? undefined : data.rounds[i];
		return r ? `Round ${r.number} · ${buy(r.buyType)} (est.)` : '';
	};

	const multiKills = $derived(data.remote ? [] : data.rounds.filter((r) => r.kills >= 3));
	const hasEconomy = $derived(
		!data.remote && data.rounds.some((r) => r.moneyFreezeStart !== null || r.equipValue !== null)
	);
	const killsWithWeapon = $derived(data.remote ? 0 : data.weapons.reduce((n, w) => n + w.kills, 0));
</script>

<svelte:head>
	<title
		>{data.remote
			? 'Match'
			: `${mapLabel(data.match.map)} ${data.match.scoreMine}–${data.match.scoreTheirs}`} · CS2Live</title
	>
</svelte:head>

{#if data.remote}
	<RemoteNote siteUrl={data.siteUrl} path="/matches/{data.id}" />
{:else}
	{@const m = data.match}
	<header class="match">
		<div>
			<p class="muted small">
				{modeLabel(m.mode)} · {dateTime(m.startedAt)} · {duration(m.durationS)}
			</p>
			<h1>{mapLabel(m.map)}</h1>
			<p class="by">
				Recorded by
				<a href={resolve('/(app)/players/[steamid]', { steamid: m.recorderSteamId })}>
					{data.recorderName ?? m.recorderSteamId}
				</a>
				{#if m.myTeamStart}<span class="muted">· started {m.myTeamStart}</span>{/if}
			</p>
			<div class="chips">
				{#if m.status === 'incomplete'}
					<span class="chip warn" title="The recorder left, crashed or timed out before the end">
						Incomplete
					</span>
				{/if}
				{#if m.joinedMidMatch}
					<span class="chip" title="The recorder's first payload came in round {m.firstRound}">
						Joined at round {m.firstRound}
					</span>
				{/if}
				{#if m.source === 'upload'}<span class="chip">Uploaded</span>{/if}
			</div>
		</div>
		<div class="score">
			<span class="res {m.result}">{resultLabel(m.result)}</span>
			<span class="big num">{m.scoreMine}<span class="dim">–</span>{m.scoreTheirs}</span>
			<span class="muted small">recorder's team first</span>
		</div>
	</header>

	<section class="tiles">
		<div>
			<span class="v">
				{m.kills}<span class="dim"> / </span>{m.assists}<span class="dim"> / </span>{m.deaths}
			</span><span class="label">K / A / D</span>
		</div>
		<div><span class="v">{fixed(m.kd, 2)}</span><span class="label">K/D</span></div>
		<div>
			<span class="v">{fixed(m.adr)}</span>
			<span
				class="label inferred"
				title={m.adr === null
					? "Unknown: CS2 doesn't send damage (round_totaldmg)"
					: 'Damage from round_totaldmg per round seen; misses damage after death'}
			>
				ADR
			</span>
		</div>
		<div><span class="v">{pct(m.hsPct)}</span><span class="label">HS%</span></div>
		<div><span class="v">{m.mvps}</span><span class="label">MVPs</span></div>
		<div><span class="v">{m.score}</span><span class="label">Score</span></div>
	</section>

	{#if data.pips.length}
		<section class="panel block">
			<h2>Rounds</h2>
			<RoundStrip
				pips={data.pips}
				current={null}
				slots={data.regulationRounds}
				halfLength={data.halfLength}
			/>
		</section>
	{/if}

	{#if data.rounds.length}
		{#if hasDamage || multiKills.length}
			<section class="panel block">
				{#if hasDamage}
					<div class="head">
						<h2>Damage per round</h2>
						<span class="legend">
							<span><i style:background="var(--viz-ct)"></i>CT</span>
							<span><i style:background="var(--viz-t)"></i>T</span>
							<span class="muted">W / L under each round</span>
						</span>
					</div>
					<ColumnChart columns={damageColumns} label="Damage dealt by the recorder in each round" />
				{:else}
					<h2>Highlights</h2>
				{/if}
				{#if multiKills.length}
					<p class="highlights">
						{#each multiKills as r (r.number)}
							<span class="chip warn">
								Round {r.number}: {r.kills === 5 ? 'ace' : `${r.kills} kills`}{r.hsKills
									? `, ${r.hsKills} HS`
									: ''}
							</span>
						{/each}
					</p>
				{/if}
			</section>
		{/if}

		{#if hasEconomy}
			<section class="panel block">
				<h2>Economy</h2>
				<LineChart
					labels={data.rounds.map((r) => String(r.number))}
					title={(i: number) => roundTitle(i)}
					series={[
						{
							name: 'Money at round start',
							color: 'var(--viz-1)',
							values: data.rounds.map((r) => r.moneyFreezeStart)
						},
						{
							name: 'Equipment value',
							color: 'var(--viz-2)',
							values: data.rounds.map((r) => r.equipValue)
						}
					]}
					format={compactMoney}
					label="Recorder's money at the start of each round and equipment value after buying"
				/>
			</section>
		{/if}

		<section class="panel block">
			<h2>Round by round</h2>
			<div class="scroll">
				<table class="data rounds">
					<thead>
						<tr>
							<th>Round</th>
							<th>Side</th>
							<th>Result</th>
							<th class="r">K</th>
							<th class="r">HS</th>
							{#if hasDamage}<th class="r">Dmg</th>{/if}
							<th>Survived</th>
							<th class="r">Money</th>
							<th class="r">Equip</th>
							<th>
								<span class="inferred" title="Estimated from equipment value and money">Buy</span>
							</th>
							<th>Weapon</th>
						</tr>
					</thead>
					<tbody>
						{#each data.rounds as r (r.number)}
							<tr class:partial={r.partial}>
								<td class="num">{r.number}{r.mvp ? ' ★' : ''}</td>
								<td class={r.mySide?.toLowerCase()}>{r.mySide ?? '—'}</td>
								<td>
									<span class:win={r.iWon === true} class:loss={r.iWon === false}>
										{r.iWon === null ? '—' : r.iWon ? 'Won' : 'Lost'}
									</span>
									<span class="dim small">{winKindLabel(parseWinReason(r.winReason).kind)}</span>
								</td>
								<td class="r num">{r.kills}</td>
								<td class="r num">{r.hsKills}</td>
								{#if hasDamage}<td class="r num">{r.damage ?? '—'}</td>{/if}
								<td>{r.survived === null ? '?' : r.survived ? 'Yes' : 'No'}</td>
								<td class="r num">{money(r.moneyFreezeStart)}</td>
								<td class="r num">{money(r.equipValue)}</td>
								<td>{buy(r.buyType)}</td>
								<td class="muted">{r.primaryWeapon ? weaponLabel(r.primaryWeapon) : ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.rounds.some((r) => r.partial)}
				<p class="dim small">
					Dimmed rounds were joined part-way through, so some values are missing.
				</p>
			{/if}
		</section>
	{/if}

	<div class="cols">
		{#if data.weapons.length}
			<section class="panel block">
				<h2>
					<span
						class="inferred"
						title="GSI has no kill feed: a kill is noticed when round_kills goes up, and the weapon is whatever was in hand"
					>
						Kills by weapon
					</span>
				</h2>
				<ul class="bars">
					{#each data.weapons as w (w.weapon)}
						<li>
							<span class="name">{w.weapon === 'unknown' ? 'Unknown' : weaponLabel(w.weapon)}</span>
							<span class="track">
								<span style:width="{(100 * w.kills) / data.weapons[0].kills}%"></span>
							</span>
							<span class="num">{w.kills}{w.hs ? ` (${w.hs} HS)` : ''}</span>
						</li>
					{/each}
				</ul>
				<p class="dim small">
					Inferred from {killsWithWeapon} kills: the weapon in hand when the kill count went up.
				</p>
			</section>
		{/if}

		{#if data.sightings.length}
			<section class="panel block">
				<h2>
					<span
						class="inferred"
						title="Only what CS2 sent while the recorder spectated these players"
					>
						Players spectated
					</span>
				</h2>
				<table class="data">
					<thead>
						<tr>
							<th>Player</th>
							<th>Team</th>
							<th class="r">K</th>
							<th class="r">A</th>
							<th class="r">D</th>
							<th>Seen</th>
						</tr>
					</thead>
					<tbody>
						{#each data.sightings as s (s.steamId)}
							<tr>
								<td>
									<a href={resolve('/(app)/players/[steamid]', { steamid: s.steamId })}>
										{s.currentName ?? s.name ?? s.steamId}
									</a>
								</td>
								<td>{s.teammate === null ? '—' : s.teammate ? 'Teammate' : 'Opponent'}</td>
								<td class="r num">{s.kills ?? '—'}</td>
								<td class="r num">{s.assists ?? '—'}</td>
								<td class="r num">{s.deaths ?? '—'}</td>
								<td class="muted small">
									{s.firstRound === s.lastRound
										? `round ${s.firstRound}`
										: `rounds ${s.firstRound}–${s.lastRound}`}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="dim small">Stats as of the last time the recorder spectated them, not final.</p>
			</section>
		{/if}

		{#if data.linked.length}
			<section class="panel block">
				<h2>Also recorded by</h2>
				<ul class="linked">
					{#each data.linked as l (l.id)}
						<li>
							<a href={resolve('/(app)/matches/[id]', { id: l.id })}>
								{l.recorderName ?? l.recorderSteamId}
							</a>
							<span class="res {l.result}">
								{resultLabel(l.result)}
								{l.scoreMine}–{l.scoreTheirs}
							</span>
							<span class="muted num">
								{l.kills}/{l.assists}/{l.deaths}{l.adr === null ? '' : ` · ADR ${fixed(l.adr)}`}
							</span>
						</li>
					{/each}
				</ul>
				<p class="dim small">
					<span class="inferred">Linked</span> because the map, mode, start time and score match.
				</p>
			</section>
		{/if}
	</div>
{/if}

<style>
	.match {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		margin-bottom: 1.2rem;
	}
	h1 {
		font-size: 2.2rem;
		margin: 0.15rem 0;
	}
	h2 {
		font-size: 1.05rem;
		margin-bottom: 0.8rem;
	}
	.by {
		margin: 0;
	}
	.chips {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.small {
		font-size: 0.82rem;
	}
	p.small {
		margin: 0.6rem 0 0;
	}
	.score {
		display: grid;
		justify-items: end;
	}
	.big {
		font-size: 3.2rem;
		font-weight: 800;
		line-height: 1;
	}
	.res {
		font-weight: 700;
	}
	.res.win {
		color: var(--win);
	}
	.res.loss {
		color: var(--loss);
	}
	.res.tie,
	.res.incomplete {
		color: var(--muted);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.tiles > div {
		display: grid;
		gap: 0.15rem;
		padding: 0.8rem 1rem;
		border-radius: var(--radius);
		background: var(--panel);
		border: 1px solid var(--line);
	}
	.v {
		font-size: 1.6rem;
		font-weight: 700;
	}
	.block {
		padding: 1.1rem 1.2rem;
		margin-bottom: 1rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.legend {
		display: flex;
		gap: 1rem;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.highlights {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.8rem 0 0;
	}
	.scroll {
		overflow-x: auto;
	}
	.rounds {
		min-width: 760px;
	}
	tr.partial td {
		color: var(--dim);
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
		gap: 0 1rem;
	}
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.bars li {
		display: grid;
		grid-template-columns: 7.5rem 1fr auto;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.9rem;
	}
	.track {
		height: 8px;
	}
	.track span {
		display: block;
		height: 100%;
		border-radius: 0 4px 4px 0;
		background: var(--viz-single);
	}
	.linked {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.linked li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		align-items: baseline;
	}
</style>
