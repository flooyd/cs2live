<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PlayerHeader from '#lib/components/PlayerHeader.svelte';
	import FilterBar from '#lib/components/FilterBar.svelte';
	import RemoteNote from '#lib/components/RemoteNote.svelte';
	import ColumnChart, { type Column } from '#lib/components/charts/ColumnChart.svelte';
	import Meter from '#lib/components/charts/Meter.svelte';
	import { mapLabel, modeLabel } from '#lib/cs2/modes.ts';
	import { buyLabel, type BuyType } from '#lib/cs2/economy.ts';
	import { weaponLabel } from '#lib/cs2/weapons.ts';
	import { date, fixed, money, pct, resultLabel } from '#lib/format.ts';
	import { filterQuery, isFiltered } from '#lib/match-filters.ts';
	import { here } from '#lib/components/here.ts';

	let { data }: PageProps = $props();

	const s = $derived(data.remote ? null : data.stats);
	const hours = (seconds: number) =>
		seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`;
	const share = (n: number | null) => (n === null ? '—' : pct(n * 100));

	// Recent form: ADR per match. Wins carry the accent, everything else stays gray (emphasis),
	// and a W / L / T letter under each column says the result without relying on color.
	const form = $derived.by((): Column[] =>
		(s?.form ?? []).map((m) => ({
			key: m.id,
			label: '',
			value: m.adr ?? 0,
			color: m.result === 'win' ? 'var(--viz-single)' : 'var(--viz-axis)',
			mark: m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : m.result === 'tie' ? 'T' : '–',
			tip: [
				`ADR ${fixed(m.adr)}`,
				`${mapLabel(m.map)} · ${date(m.startedAt)}`,
				`${resultLabel(m.result)} ${m.scoreMine}–${m.scoreTheirs} · ${m.kills}/${m.deaths} K/D`
			]
		}))
	);
</script>

<svelte:head>
	<title>{data.remote ? 'Player' : (data.profile?.name ?? data.steamId)} · Stats · CS2Live</title>
</svelte:head>

{#if data.remote}
	<RemoteNote siteUrl={data.siteUrl} path="/players/{data.steamId}/stats" />
{:else if s}
	<PlayerHeader steamId={data.steamId} profile={data.profile} isMe={data.isMe} />
	<FilterBar filters={data.filters} maps={data.options.maps} modes={data.options.modes} />

	{#if s.totals.matches === 0}
		<div class="panel empty">
			<p class="muted">
				{isFiltered(data.filters)
					? 'No recorded matches fit these filters.'
					: 'No recorded matches yet. Stats come from matches this player recorded with CS2Live.'}
			</p>
			{#if data.profile?.sighted}
				<p>
					They were spectated in {data.profile.sighted} game{data.profile.sighted === 1 ? '' : 's'}:
					<a href={resolve('/(app)/players/[steamid]', { steamid: data.steamId })}>see matches</a>.
				</p>
			{/if}
		</div>
	{:else}
		{@const t = s.totals}
		<section class="tiles">
			<div>
				<span class="v">{t.matches}</span>
				<span class="label">Matches</span>
				<span class="sub num">
					{t.wins}W · {t.losses}L · {t.ties}T{t.incomplete ? ` · ${t.incomplete} unfinished` : ''}
				</span>
			</div>
			<div>
				<span class="v">{share(s.rates.winRate)}</span>
				<span class="label">Win rate</span>
				<span class="sub">finished matches</span>
			</div>
			<div>
				<span class="v">{fixed(s.rates.kd, 2)}</span>
				<span class="label">K/D</span>
				<span class="sub num">{t.kills} / {t.deaths}</span>
			</div>
			<div>
				<span class="v">{fixed(s.rates.adr)}</span>
				<span
					class="label inferred"
					title="Damage per round from round_totaldmg; misses damage after death"
				>
					ADR
				</span>
				<span class="sub num">{t.rounds} rounds</span>
			</div>
			<div>
				<span class="v">{pct(s.rates.hsPct)}</span>
				<span class="label">HS%</span>
				<span class="sub num">{t.hsKills} headshot kills</span>
			</div>
			<div>
				<span class="v">{hours(t.seconds)}</span>
				<span class="label">Played</span>
				<span class="sub num">{t.mvps} MVPs</span>
			</div>
		</section>

		{#if form.length > 1}
			<section class="panel block">
				<div class="head">
					<h2>Recent form</h2>
					<span class="muted small">
						ADR in the last {form.length} matches, oldest first · wins highlighted
					</span>
				</div>
				<ColumnChart
					columns={form}
					height={170}
					format={(n: number) => String(Math.round(n))}
					label="ADR per match, last {form.length} matches"
				/>
			</section>
		{/if}

		<div class="cols">
			{#if s.sides.length}
				<section class="panel block">
					<h2>CT vs T</h2>
					<div class="sides">
						{#each s.sides as side (side.side)}
							<div class="side">
								<div class="sidehead">
									<strong class={side.side.toLowerCase()}>{side.side}</strong>
									<span class="muted small">{side.rounds} rounds</span>
								</div>
								<div class="row">
									<span>Rounds won</span><strong class="num">{share(side.winRate)}</strong>
								</div>
								<Meter
									value={side.winRate}
									color={side.side === 'CT' ? 'var(--viz-ct)' : 'var(--viz-t)'}
									label="{side.side} rounds won"
								/>
								<div class="row">
									<span>ADR</span><strong class="num">{fixed(side.adr)}</strong>
								</div>
								<div class="row">
									<span>Kills per round</span><strong class="num">{fixed(side.kpr, 2)}</strong>
								</div>
								<div class="row">
									<span class="inferred" title="Not seen dying or spectating during the round">
										Survived
									</span>
									<strong class="num">{share(side.survival)}</strong>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section class="panel block">
				<h2>Multi-kill rounds</h2>
				<div class="multi">
					{#each s.multiKills as mk (mk.k)}
						<div>
							<span class="v">{mk.rounds}</span>
							<span class="label">{mk.k === 5 ? 'Aces' : `${mk.k}K`}</span>
						</div>
					{/each}
				</div>
				<p class="dim small">Rounds with exactly 2, 3, 4 or 5 kills.</p>
			</section>
		</div>

		<section class="panel block">
			<h2>Maps</h2>
			<div class="scroll">
				<table class="data">
					<thead>
						<tr>
							<th>Map</th>
							<th class="r">Matches</th>
							<th>W–L–T</th>
							<th class="meter-col">Win rate</th>
							<th class="r">ADR</th>
							<th class="r">K/D</th>
							<th class="r">HS%</th>
						</tr>
					</thead>
					<tbody>
						{#each s.maps as m (m.key)}
							<tr>
								<td>
									<a href={here(filterQuery(data.filters, { map: m.key }))}>
										{mapLabel(m.key)}
									</a>
								</td>
								<td class="r num">{m.totals.matches}</td>
								<td class="num">{m.totals.wins}–{m.totals.losses}–{m.totals.ties}</td>
								<td class="meter-col">
									<span class="meterrow">
										<Meter value={m.rates.winRate} label="{mapLabel(m.key)} win rate" />
										<span class="num">{share(m.rates.winRate)}</span>
									</span>
								</td>
								<td class="r num">{fixed(m.rates.adr)}</td>
								<td class="r num">{fixed(m.rates.kd, 2)}</td>
								<td class="r num">{pct(m.rates.hsPct)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<div class="cols">
			{#if s.buys.length}
				<section class="panel block">
					<h2>
						<span
							class="inferred"
							title="Buy type is estimated from equipment value and money (see STATS.md)"
						>
							Buy types
						</span>
					</h2>
					<div class="scroll">
						<table class="data">
							<thead>
								<tr>
									<th>Buy (est.)</th>
									<th class="r">Rounds</th>
									<th class="meter-col">Rounds won</th>
									<th class="r">ADR</th>
									<th class="r">Avg equip</th>
								</tr>
							</thead>
							<tbody>
								{#each s.buys as b (b.buy)}
									<tr>
										<td>{buyLabel(b.buy as BuyType)}</td>
										<td class="r num">{b.rounds}</td>
										<td class="meter-col">
											<span class="meterrow">
												<Meter value={b.winRate} label="{b.buy} rounds won" />
												<span class="num">{share(b.winRate)}</span>
											</span>
										</td>
										<td class="r num">{fixed(b.adr)}</td>
										<td class="r num">{money(b.equip === null ? null : Math.round(b.equip))}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/if}

			{#if s.weapons.length}
				<section class="panel block">
					<h2>
						<span class="inferred" title="The weapon in hand when the kill count went up">
							Kills by weapon
						</span>
					</h2>
					<ul class="bars">
						{#each s.weapons as w (w.weapon)}
							<li>
								<span class="name">
									{w.weapon === 'unknown' ? 'Unknown' : weaponLabel(w.weapon)}
								</span>
								<span class="track">
									<span style:width="{(100 * w.kills) / s.weapons[0].kills}%"></span>
								</span>
								<span class="num">{w.kills} <span class="dim">· {pct(w.hsPct)} HS</span></span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>

		{#if s.modes.length > 1}
			<section class="panel block">
				<h2>Modes</h2>
				<div class="scroll">
					<table class="data">
						<thead>
							<tr>
								<th>Mode</th>
								<th class="r">Matches</th>
								<th>W–L–T</th>
								<th class="r">Win rate</th>
								<th class="r">ADR</th>
								<th class="r">K/D</th>
							</tr>
						</thead>
						<tbody>
							{#each s.modes as m (m.key)}
								<tr>
									<td>{modeLabel(m.key)}</td>
									<td class="r num">{m.totals.matches}</td>
									<td class="num">{m.totals.wins}–{m.totals.losses}–{m.totals.ties}</td>
									<td class="r num">{share(m.rates.winRate)}</td>
									<td class="r num">{fixed(m.rates.adr)}</td>
									<td class="r num">{fixed(m.rates.kd, 2)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<p class="dim small">
			Stats use only matches this player recorded. Games where they were only spectated have no
			round data, so they are left out. See STATS.md in the project for how each number is worked
			out.
		</p>
	{/if}
{/if}

<style>
	h2 {
		font-size: 1.05rem;
		margin-bottom: 0.8rem;
	}
	.small {
		font-size: 0.82rem;
	}
	.empty {
		padding: 1.5rem;
		text-align: center;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.tiles > div,
	.multi > div {
		display: grid;
		gap: 0.15rem;
		padding: 0.8rem 1rem;
		border-radius: var(--radius);
		background: var(--panel);
		border: 1px solid var(--line);
	}
	.v {
		font-size: 1.7rem;
		font-weight: 700;
	}
	.sub {
		font-size: 0.8rem;
		color: var(--muted);
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
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		gap: 0 1rem;
	}
	.sides {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}
	.side {
		display: grid;
		gap: 0.45rem;
		align-content: start;
	}
	.sidehead {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.sidehead strong {
		font-size: 1.2rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.row strong {
		color: var(--text);
	}
	.multi {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.6rem;
	}
	.multi > div {
		background: var(--panel-2);
	}
	.scroll {
		overflow-x: auto;
	}
	.meter-col {
		width: 30%;
		min-width: 160px;
	}
	.meterrow {
		display: grid;
		grid-template-columns: 1fr 3rem;
		gap: 0.6rem;
		align-items: center;
	}
	.meterrow .num {
		text-align: right;
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
		grid-template-columns: 7.5rem 1fr 7rem;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.9rem;
	}
	.bars li > .num {
		text-align: right;
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
	@media (max-width: 560px) {
		.sides {
			grid-template-columns: 1fr;
		}
	}
</style>
