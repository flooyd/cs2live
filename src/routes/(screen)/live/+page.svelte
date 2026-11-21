<script lang="ts">
	import { untrack } from 'svelte';
	import { fly, scale } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import { LiveConnection, formatClock, secondsLeft } from '#lib/live/connection.svelte.ts';
	import RoundStrip from '#lib/live/components/RoundStrip.svelte';
	import TeamScore from '#lib/live/components/TeamScore.svelte';
	import SteamIdForm from '#lib/live/components/SteamIdForm.svelte';
	import SparkArea from '#lib/components/charts/SparkArea.svelte';
	import { compactMoney } from '#lib/components/charts/scale.ts';
	import { ago, fixed, money, pct } from '#lib/format.ts';
	import { grenadeIcon, weaponLabel } from '#lib/cs2/weapons.ts';
	import { buyLabel, type BuyType } from '#lib/cs2/economy.ts';

	let { data }: PageProps = $props();

	const conn = new LiveConnection(
		'/api/live/stream',
		untrack(() => data.initial)
	);
	$effect(() => (data.liveEnabled ? conn.start() : undefined));

	const v = $derived(conn.view);
	const now = $derived(conn.serverNow);
	const age = $derived(
		v?.connection.lastPayloadAt ? (now - v.connection.lastPayloadAt) / 1000 : null
	);
	// CS2 sends a heartbeat every 10 s even when nothing changes.
	const link = $derived(age === null ? 'none' : age < 15 ? 'ok' : age < 35 ? 'stale' : 'lost');
	const mySide = $derived(v?.me?.team ?? null);
	const timer = $derived(v?.timer ? secondsLeft(v.timer.endsAt, now) : null);
	const bomb = $derived(v?.bombTimer ? secondsLeft(v.bombTimer.endsAt, now) : null);
	const roundPhase = $derived(v?.round?.phase ?? null);
	// CS2 currently sends no round_totaldmg; damage columns only appear if it ever does.
	const roundDamage = $derived(v?.recentRounds.some((r) => r.damage !== null) ?? false);
	const phaseLabel = $derived.by(() => {
		if (!v?.map) return '';
		if (v.map.phase === 'warmup') return 'Warmup';
		if (v.map.phase === 'intermission') return 'Halftime';
		if (v.map.phase === 'gameover') return 'Match over';
		if (roundPhase === 'freezetime') return 'Freeze time';
		if (roundPhase === 'over') return 'Round over';
		return 'Live';
	});
	const hpColor = $derived(
		(v?.me?.health ?? 0) > 60
			? 'var(--win)'
			: (v?.me?.health ?? 0) > 25
				? 'var(--warn)'
				: 'var(--loss)'
	);

	// Net worth chart: one slot per round up to the regulation length, so the line grows
	// across the match instead of rescaling every round. Rounds you weren't seen in are gaps.
	const worth = $derived.by(() => {
		const pts = v?.netWorth ?? [];
		if (!v?.map || !pts.length) return null;
		const { halfLength, regulationRounds: reg } = v.map;
		const last = Math.max(reg ?? 0, v.map.round, ...pts.map((p) => p.round));
		const rounds = Array.from({ length: last }, (_, i) => i + 1);
		const byRound = new Map(pts.map((p) => [p.round, p]));
		const switches = new Set(v.history.filter((p) => p.switchBefore).map((p) => p.round));
		const dividers = rounds
			.filter(
				(r) =>
					r > 1 &&
					(switches.has(r) ||
						(halfLength !== null && reg !== null && r === halfLength + 1) ||
						(reg !== null && r === reg + 1))
			)
			.map((r) => ({ before: r - 1, label: reg !== null && r > reg ? 'OT' : 'HT' }));
		return {
			rounds,
			points: rounds.map((r) => byRound.get(r) ?? null),
			dividers,
			latest: pts.at(-1)!
		};
	});

	function worthTitle(i: number): string {
		const p = worth?.points[i];
		const parts = [`Round ${worth?.rounds[i] ?? i + 1}`];
		if (p?.mySide) parts.push(p.mySide);
		if (p?.iWon === true) parts.push('won');
		else if (p?.iWon === false) parts.push('lost');
		else if (p?.current) parts.push('now');
		return parts.join(' · ');
	}

	function worthRows(i: number) {
		const p = worth?.points[i];
		if (!p) return [];
		return [
			{ name: 'Net worth', value: money(p.total), strong: true },
			{ name: 'Money', value: money(p.money) },
			{ name: 'Equipment', value: money(p.equipValue) }
		];
	}

	// Kill pops: a short "+1" badge whenever this round's kill count goes up.
	let pops = $state<{ id: number; hs: boolean }[]>([]);
	let lastKills = -1;
	let lastHs = 0;
	let popId = 0;
	$effect(() => {
		const k = v?.roundStats?.kills ?? 0;
		const hs = v?.roundStats?.hsKills ?? 0;
		if (lastKills >= 0 && k > lastKills && k - lastKills <= 5) {
			for (let i = 0; i < k - lastKills; i++) {
				const pop = { id: ++popId, hs: hs > lastHs + i };
				pops = [...pops, pop];
				setTimeout(() => (pops = pops.filter((p) => p.id !== pop.id)), 1400);
			}
		}
		lastKills = k;
		lastHs = hs;
	});
</script>

<svelte:head>
	<title>{v?.map ? `${v.map.ct.score}:${v.map.t.score} ${v.map.label}` : 'Live'} · CS2Live</title>
</svelte:head>

<div class="live">
	<header class="bar">
		<a class="brand" href={resolve('/(app)')}>
			<span class="ct">CS2</span><span class="t">Live</span>
		</a>
		{#if v?.map}
			<div class="where">
				<strong>{v.map.label}</strong>
				<span class="dim">·</span>
				<span>{v.map.modeLabel}</span>
				<span class="dim">·</span>
				<span class="num">Round {v.map.round}</span>
				<span class="phase" class:live-phase={phaseLabel === 'Live'}>{phaseLabel}</span>
			</div>
		{/if}
		<div class="conn {link}" title="Time since the last GSI update from CS2">
			<span class="dot"></span>
			{#if !data.liveEnabled}
				Local only
			{:else if conn.status !== 'open'}
				Reconnecting to CS2Live…
			{:else if age === null}
				Waiting for CS2
			{:else}
				<span class="num">CS2 {age < 1 ? 'now' : `${Math.floor(age)} s ago`}</span>
			{/if}
			{#if v?.tracking.recording}<span class="rec" title="This match is being recorded">
					● REC
				</span>{/if}
		</div>
	</header>

	{#if !data.liveEnabled}
		<section class="idle">
			<h1>Live tracking only runs locally</h1>
			<p>
				CS2 sends game state to your own PC, and the live view needs a long-running process to hold
				it, which this hosted site can't do. Run CS2Live on the PC you play on (<code>
					yarn live
				</code>) and open <code>http://localhost:5173/live</code> there.
			</p>
			<p>Match history, match pages and stats work here.</p>
			<a class="btn" href={resolve('/(app)')}>Look up a player</a>
		</section>
	{:else if !v}
		<section class="idle"><h1>Connecting…</h1></section>
	{:else if !v.setup.steamId}
		<section class="idle setup">
			<h1>Enter your Steam ID to begin tracking</h1>
			<p class="muted">
				CS2Live only records matches for this Steam account. It's saved on this PC and you can
				change it later on the Setup page.
			</p>
			<SteamIdForm
				detected={v.connection.providerSteamId
					? { steamId: v.connection.providerSteamId, name: v.connection.providerName }
					: null}
				current={null}
				locked={data.steamIdLocked}
				redirectTo="/live"
			/>
		</section>
	{:else if v.connection.lastPayloadAt === null}
		<section class="idle">
			<h1>Waiting for CS2…</h1>
			<ol class="checklist">
				<li class:done={v.connection.tokenConfigured}>
					GSI token set {v.connection.tokenConfigured ? '' : '(run yarn gsi:config, then restart)'}
				</li>
				<li>GSI config installed in CS2's cfg folder (<code>yarn gsi:config --install</code>)</li>
				<li>CS2 restarted after installing it (it only reads configs at startup)</li>
			</ol>
			<p class="muted">The view fills in as soon as CS2 sends its first update.</p>
		</section>
	{:else if !v.inGame}
		<section class="idle">
			<h1>{v.activity === 'menu' ? 'In the main menu' : 'Not in a match'}</h1>
			<p class="muted">Join a match and this screen fills in.</p>
			{#if v.tracking.lastSavedMatchId}
				<p>
					Last match saved {ago(v.tracking.lastSavedAt, now)}.
					{#if v.setup.sync.pending > 0}
						<span class="chip warn">{v.setup.sync.pending} waiting to upload</span>
					{/if}
				</p>
			{/if}
			{#if v.setup.accountMismatch}
				<p class="chip warn">
					CS2 is signed in to a different Steam account than the one on the Setup page.
				</p>
			{/if}
		</section>
	{:else if v.map}
		{#if v.setup.accountMismatch}
			<div class="banner warn">
				CS2 is sending data for Steam ID {v.connection.providerSteamId}, but CS2Live tracks {v.setup
					.steamId}. This match is not being recorded.
				<a href={resolve('/(app)/setup')}>Change it</a>
			</div>
		{:else if v.observer}
			<div class="banner">Spectating a match as an observer. Shown live, not recorded.</div>
		{/if}

		<section class="scoreboard">
			<TeamScore side="CT" team={v.map.ct} mine={mySide === 'CT'} />
			<div class="center">
				{#if bomb !== null}
					<div class="bomb" transition:scale={{ duration: 200 }}>
						<span class="label">Bomb{v.bombTimer?.estimated ? ' (est.)' : ''}</span>
						<span class="clock num" class:urgent={bomb < 10}>{formatClock(bomb)}</span>
					</div>
				{:else if v.round?.bomb === 'planted'}
					<div class="bomb"><span class="label">Bomb planted</span></div>
				{:else if timer !== null}
					<div class="timer">
						<span class="label">
							{v.timer?.phase === 'freezetime'
								? 'Freeze'
								: v.timer?.phase === 'over'
									? 'Next round'
									: 'Round'}{v.timer?.estimated ? ' (est.)' : ''}
						</span>
						<span class="clock num">{formatClock(timer)}</span>
					</div>
				{:else}
					<div class="timer"><span class="label">{phaseLabel}</span></div>
				{/if}
				{#if v.round?.phase === 'over' && v.round.winTeam}
					<div class="roundwin {v.round.winTeam.toLowerCase()}" in:fly={{ y: 8, duration: 250 }}>
						{v.round.winTeam} win{#if v.round.bomb === 'defused'}: defused{:else if v.round.bomb === 'exploded'}:
							bomb{/if}
					</div>
				{/if}
			</div>
			<TeamScore side="T" team={v.map.t} mine={mySide === 'T'} align="right" />
		</section>

		<section class="history">
			<RoundStrip
				pips={v.history}
				current={v.map.phase === 'gameover' ? null : v.map.round}
				slots={v.map.regulationRounds}
				halfLength={v.map.halfLength}
			/>
		</section>

		{#if v.spectating}
			<div class="banner spectating {v.spectating.team?.toLowerCase() ?? ''}" in:fly={{ y: -8 }}>
				<span class="label">Spectating</span>
				<strong>{v.spectating.name ?? v.spectating.steamId}</strong>
				{#if v.spectating.health !== null}<span class="num">♥ {v.spectating.health}</span>{/if}
				{#if v.spectating.weapon}<span>{v.spectating.weapon}</span>{/if}
				{#if v.spectating.kills !== null}
					<span class="num muted">
						{v.spectating.kills} / {v.spectating.assists ?? 0} / {v.spectating.deaths ?? 0}
					</span>
				{/if}
				<span class="muted">· your stats below are from before you died</span>
			</div>
		{/if}

		{#if v.allPlayers}
			<section class="panel observer">
				<table class="data">
					<thead>
						<tr>
							<th>Player</th><th>Side</th><th class="r">K</th><th class="r">A</th><th class="r">
								D
							</th><th class="r">HP</th><th class="r">$</th>
						</tr>
					</thead>
					<tbody>
						{#each [...v.allPlayers].sort((a, b) => (a.team ?? '').localeCompare(b.team ?? '') || b.kills - a.kills) as pl (pl.steamId)}
							<tr>
								<td>{pl.name ?? pl.steamId}</td>
								<td class={pl.team?.toLowerCase()}>{pl.team ?? '—'}</td>
								<td class="r">{pl.kills}</td>
								<td class="r">{pl.assists}</td>
								<td class="r">{pl.deaths}</td>
								<td class="r">{pl.health ?? '—'}</td>
								<td class="r">{money(pl.money)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{:else}
			<section class="grid">
				<div class="panel me" class:dead={v.me && !v.me.alive}>
					<div class="label">You{v.me?.name ? ` · ${v.me.name}` : ''}</div>
					{#if v.me}
						<div class="vitals">
							<div class="hp">
								<span class="big num" style:color={hpColor}>{v.me.health}</span>
								<span class="label">HP</span>
							</div>
							<div class="armor">
								<span class="big num">{v.me.armor}</span>
								<span class="label">Armor</span>
							</div>
							<div class="kit">
								<span class="icon" class:on={v.me.helmet} title="Helmet">Helmet</span>
								{#if v.me.team === 'CT'}
									<span class="icon" class:on={v.me.defuseKit} title="Defuse kit">Kit</span>
								{:else if v.me.hasBomb}
									<span class="icon on bombicon" title="You have the bomb">C4</span>
								{/if}
							</div>
						</div>
						<div class="hpbar">
							<span style:width="{v.me.health}%" style:background={hpColor}></span>
						</div>
						<div class="cash">
							<div>
								<span class="big num">{money(v.me.money)}</span>
								<span class="label">Money</span>
							</div>
							<div class="r">
								<span class="mid num">{money(v.me.equipValue)}</span>
								<span class="label">Equipment</span>
							</div>
						</div>
						<div class="weapon">
							{#if v.me.activeWeapon}
								<span class="wname">{v.me.activeWeapon.label}</span>
								{#if v.me.activeWeapon.clip !== null}
									<span class="ammo num">
										{v.me.activeWeapon.clip}<span class="dim">
											/ {v.me.activeWeapon.reserve ?? 0}
										</span>
									</span>
								{/if}
							{:else}
								<span class="dim">No weapon data</span>
							{/if}
						</div>
						<div class="loadout">
							{#if v.me.primary && v.me.primary.name !== v.me.activeWeapon?.name}
								<span class="chip">{v.me.primary.label}</span>
							{/if}
							{#if v.me.secondary && v.me.secondary.name !== v.me.activeWeapon?.name}
								<span class="chip">{v.me.secondary.label}</span>
							{/if}
							{#each v.me.grenades as g (g.name)}
								<span class="chip nade" title={weaponLabel(g.name)}>
									{grenadeIcon(g.name)}{g.count > 1 ? ` ×${g.count}` : ''}
								</span>
							{/each}
						</div>
						<div class="effects">
							{#if v.me.flashed > 0}
								<span class="fx flash" style:opacity={0.35 + v.me.flashed / 400} transition:scale>
									FLASHED
								</span>
							{/if}
							{#if v.me.smoked > 0}<span class="fx smoke" transition:scale>IN SMOKE</span>{/if}
							{#if v.me.burning > 0}<span class="fx burn" transition:scale>BURNING</span>{/if}
							{#if !v.me.alive}<span class="fx dead">DEAD</span>{/if}
						</div>
					{:else}
						<p class="muted">Waiting for your own data (CS2 is showing someone else).</p>
					{/if}
					{#if worth}
						<div class="worth">
							<div class="worth-head">
								<span
									class="label"
									title="Money plus equipment value right after buying, for each round CS2 sent your own data"
								>
									Net worth
								</span>
								<span class="num">
									<strong>{money(worth.latest.total)}</strong>
									<span class="dim small">round {worth.latest.round}</span>
								</span>
							</div>
							<SparkArea
								labels={worth.rounds.map(String)}
								values={worth.points.map((p) => p?.total ?? null)}
								format={compactMoney}
								title={worthTitle}
								rows={worthRows}
								dividers={worth.dividers}
								height="7.5em"
								label="Your net worth after buying, each round of this match"
							/>
						</div>
					{/if}
				</div>

				<div class="panel match">
					<div class="label">Match</div>
					{#if v.matchStats}
						<div class="kad">
							<div>
								<span class="big num">{v.matchStats.kills}</span><span class="label">K</span>
							</div>
							<div>
								<span class="big num">{v.matchStats.assists}</span><span class="label">A</span>
							</div>
							<div>
								<span class="big num">{v.matchStats.deaths}</span><span class="label">D</span>
							</div>
							<div>
								<span class="big num">{v.matchStats.mvps}</span><span class="label">MVP</span>
							</div>
						</div>
						<div class="rates">
							<div>
								<span class="mid num">{fixed(v.matchStats.adr)}</span>
								<span
									class="label inferred"
									title={v.matchStats.adr === null
										? "Unknown: CS2 doesn't send damage (round_totaldmg)"
										: 'Damage per round, from round_totaldmg while you were alive and in view'}
								>
									ADR
								</span>
							</div>
							<div>
								<span class="mid num">{pct(v.matchStats.hsPct)}</span>
								<span
									class="label inferred"
									title="Headshot kills (from round_killhs) over round kills"
								>
									HS%
								</span>
							</div>
							<div>
								<span class="mid num">{fixed(v.matchStats.kd, 2)}</span>
								<span class="label">K/D</span>
							</div>
							<div>
								<span class="mid num">{v.matchStats.score}</span>
								<span class="label">Score</span>
							</div>
						</div>
						{#if v.recentRounds.length}
							<table class="rounds num">
								<thead>
									<tr>
										<th>Rd</th>
										<th></th>
										<th class="r">K</th>
										{#if roundDamage}<th class="r">Dmg</th>{/if}
										<th>Buy</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each v.recentRounds as r (r.number)}
										<tr>
											<td class="dim">{r.number}</td>
											<td>
												<span class="res" class:win={r.iWon === true} class:loss={r.iWon === false}>
													{r.iWon === null ? '·' : r.iWon ? 'W' : 'L'}
												</span>
												<span class={r.mySide?.toLowerCase()}>{r.mySide ?? ''}</span>
											</td>
											<td class="r" class:multi={r.kills >= 2}>
												{r.kills}{#if r.hsKills}<span class="dim small">
														({r.hsKills} hs)
													</span>{/if}
											</td>
											{#if roundDamage}<td class="r">{r.damage ?? '—'}</td>{/if}
											<td class="muted">{buyLabel(r.buyType as BuyType | null)}</td>
											<td class="dim">{r.survived === false ? '✝' : ''}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
						<p class="note">
							CS2 only sends your own stats while you play, so there's no full scoreboard.
						</p>
					{:else}
						<p class="muted">No stats yet.</p>
					{/if}
				</div>

				<div class="panel round">
					<div class="label pophead">
						This round
						{#each pops as pop (pop.id)}
							<span
								class="pop"
								class:hs={pop.hs}
								in:fly={{ y: 10, duration: 200 }}
								out:fly={{ y: -14, duration: 500 }}
							>
								+1 kill{pop.hs ? ' (HS)' : ''}
							</span>
						{/each}
					</div>
					{#if v.roundStats}
						<div class="kad">
							<div>
								<span class="big num">{v.roundStats.kills}</span><span class="label">Kills</span>
							</div>
							<div>
								<span class="big num">{v.roundStats.hsKills}</span><span class="label">HS</span>
							</div>
							{#if v.roundStats.damage !== null}
								<div>
									<span class="big num">{v.roundStats.damage}</span><span class="label">Dmg</span>
								</div>
							{/if}
						</div>
					{/if}
					{#if v.economy}
						<div class="econ">
							<div
								class="label inferred"
								title="Estimated from your money and your team's loss streak, not counting kill rewards or spending"
							>
								Next round money (est.)
							</div>
							{#if v.economy.resetNext}
								<p class="muted">Halftime next: money resets to $800.</p>
							{:else}
								<div class="econ-rows num">
									<span class="win">Win</span><span>{money(v.economy.ifWin)}</span>
									<span class="loss">Loss</span><span>{money(v.economy.ifLoss)}</span>
									{#if v.economy.ifLossPlanted !== null}
										<span class="loss">Loss, planted</span><span>
											{money(v.economy.ifLossPlanted)}
										</span>
									{/if}
								</div>
								<div class="dim small">
									Loss streak {v.economy.consecutiveLosses} · next loss bonus {money(
										v.economy.ifLoss - v.economy.money
									)}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<footer class="status">
			{#if v.tracking.recording}
				<span>Recording this match</span>
			{:else if v.tracking.ignoredReason === 'other_account'}
				<span class="warn">Not recording: different Steam account</span>
			{:else if v.map.phase === 'warmup'}
				<span class="muted">Warmup: recording starts when the match goes live</span>
			{/if}
			{#if v.tracking.lastSavedMatchId}
				<span class="muted">Last match saved {ago(v.tracking.lastSavedAt, now)}</span>
			{/if}
			{#if v.setup.sync.pending > 0}
				<span class="warn" title={v.setup.sync.lastError ?? ''}>
					{v.setup.sync.pending} match{v.setup.sync.pending === 1 ? '' : 'es'} waiting to upload
				</span>
			{/if}
			{#if v.connection.capturing}<span class="muted">Capturing payloads</span>{/if}
			<span class="dim">(est.) = estimated from standard timings</span>
		</footer>
	{/if}
</div>

<style>
	.live {
		height: 100dvh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 0.8em;
		padding: 0.9em 1.3em 0.7em;
		/* Scales with the monitor; ~20px at 1080p. */
		font-size: clamp(13px, min(1.05vw, 1.9vh), 28px);
		background:
			radial-gradient(ellipse at 15% -10%, rgb(94 168 255 / 0.07), transparent 45%),
			radial-gradient(ellipse at 85% -10%, rgb(242 165 65 / 0.07), transparent 45%), var(--bg);
	}
	code {
		font-family: var(--mono);
		font-size: 0.9em;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 1.2em;
		font-size: 0.9em;
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.15em;
	}
	.brand:hover {
		text-decoration: none;
	}
	.where {
		display: flex;
		gap: 0.55em;
		align-items: center;
	}
	.where strong {
		font-size: 1.15em;
	}
	.phase {
		margin-left: 0.4em;
		padding: 0.1em 0.6em;
		border-radius: 999px;
		background: var(--panel-2);
		border: 1px solid var(--line-2);
		font-size: 0.8em;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.phase.live-phase {
		background: var(--loss-soft);
		border-color: var(--loss);
		color: var(--loss);
	}
	.conn {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5em;
		color: var(--muted);
		font-size: 0.85em;
	}
	.conn .dot {
		width: 0.6em;
		height: 0.6em;
		border-radius: 50%;
		background: var(--dim);
	}
	.conn.ok .dot {
		background: var(--win);
		box-shadow: 0 0 0.5em var(--win);
	}
	.conn.stale .dot {
		background: var(--warn);
	}
	.conn.lost .dot {
		background: var(--loss);
	}
	.rec {
		color: var(--loss);
		font-weight: 700;
		letter-spacing: 0.05em;
		animation: blink 2s steps(2, start) infinite;
	}
	@keyframes blink {
		to {
			opacity: 0.45;
		}
	}

	.idle {
		margin: auto;
		max-width: 44em;
		display: grid;
		gap: 0.8em;
		text-align: center;
		justify-items: center;
	}
	.idle h1 {
		font-size: 2em;
	}
	.idle p {
		margin: 0;
	}
	.idle.setup {
		text-align: left;
		justify-items: stretch;
		font-size: 0.85em;
		width: min(44em, 100%);
	}
	.checklist {
		text-align: left;
		display: grid;
		gap: 0.4em;
	}
	.checklist li.done {
		color: var(--win);
	}

	.banner {
		display: flex;
		align-items: center;
		gap: 0.8em;
		padding: 0.5em 0.9em;
		border-radius: var(--radius);
		background: var(--panel-2);
		border: 1px solid var(--line-2);
		font-size: 0.95em;
	}
	.banner.warn {
		background: var(--warn-soft);
		border-color: var(--warn);
		color: var(--warn);
	}
	.banner.spectating.ct {
		background: var(--ct-soft);
		border-color: var(--ct-strong);
	}
	.banner.spectating.t {
		background: var(--t-soft);
		border-color: var(--t-strong);
	}
	.banner strong {
		font-size: 1.15em;
	}

	.scoreboard {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 1em;
	}
	.center {
		display: grid;
		justify-items: center;
		gap: 0.3em;
		min-width: 10em;
	}
	.timer,
	.bomb {
		display: grid;
		justify-items: center;
	}
	.clock {
		font-family: var(--font-display);
		font-size: 3em;
		font-weight: 700;
		line-height: 1;
	}
	.bomb .clock {
		color: var(--loss);
	}
	.bomb .label {
		color: var(--loss);
	}
	.clock.urgent {
		animation: blink 0.5s steps(2, start) infinite;
	}
	.roundwin {
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.15em 0.7em;
		border-radius: 999px;
	}
	.roundwin.ct {
		background: var(--ct-soft);
		color: var(--ct);
	}
	.roundwin.t {
		background: var(--t-soft);
		color: var(--t);
	}

	.history {
		padding-bottom: 0.3em;
	}

	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1.15fr 1fr 1fr;
		gap: 0.8em;
	}
	.panel {
		padding: 0.9em 1.1em;
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		min-height: 0;
		overflow: hidden;
	}
	.observer {
		flex: 1;
		overflow: auto;
	}
	.big {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 2.6em;
		line-height: 1;
	}
	.mid {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.7em;
		line-height: 1.05;
	}
	.vitals,
	.kad,
	.rates,
	.cash {
		display: flex;
		gap: 1.3em;
		align-items: flex-end;
	}
	.vitals > div,
	.kad > div,
	.rates > div,
	.cash > div {
		display: grid;
	}
	.cash {
		justify-content: space-between;
	}
	.cash .r {
		text-align: right;
	}
	.kit {
		display: flex;
		gap: 0.4em;
		margin-left: auto;
	}
	.icon {
		padding: 0.15em 0.5em;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-2);
		color: var(--dim);
		font-size: 0.8em;
		font-weight: 700;
	}
	.icon.on {
		color: var(--text);
		border-color: var(--muted);
	}
	.icon.bombicon {
		color: var(--t);
		border-color: var(--t);
	}
	.hpbar {
		height: 0.35em;
		background: var(--panel-2);
		border-radius: 999px;
		overflow: hidden;
	}
	.hpbar span {
		display: block;
		height: 100%;
		transition:
			width 0.25s ease,
			background 0.25s;
	}
	.weapon {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1em;
		padding-top: 0.4em;
		border-top: 1px solid var(--line);
	}
	.wname {
		font-size: 1.5em;
		font-weight: 700;
	}
	.ammo {
		font-family: var(--font-display);
		font-size: 1.5em;
		font-weight: 700;
	}
	.loadout {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35em;
	}
	.nade {
		font-family: var(--mono);
	}
	.effects {
		display: flex;
		gap: 0.4em;
		min-height: 1.6em;
	}
	.fx {
		font-weight: 800;
		letter-spacing: 0.08em;
		font-size: 0.85em;
		padding: 0.2em 0.6em;
		border-radius: var(--radius-sm);
	}
	.fx.flash {
		background: #fff;
		color: #000;
	}
	.fx.smoke {
		background: #6b7280;
		color: #fff;
	}
	.fx.burn {
		background: #ff6a00;
		color: #fff;
	}
	.fx.dead {
		background: var(--loss-soft);
		color: var(--loss);
	}
	.me.dead .big,
	.me.dead .wname {
		opacity: 0.55;
	}
	.worth {
		margin-top: auto;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35em;
		padding-top: 0.6em;
		border-top: 1px solid var(--line);
	}
	.worth-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1em;
	}
	.worth-head strong {
		font-size: 1.15em;
	}
	.pophead {
		display: flex;
		gap: 0.6em;
		align-items: baseline;
	}
	.pop {
		font-size: 1.3em;
		letter-spacing: 0.02em;
		font-weight: 800;
		color: var(--win);
		white-space: nowrap;
	}
	.pop.hs {
		color: var(--warn);
	}
	.econ {
		margin-top: auto;
		display: grid;
		gap: 0.35em;
		padding-top: 0.6em;
		border-top: 1px solid var(--line);
	}
	.econ-rows {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15em 1em;
		font-size: 1.15em;
		font-weight: 600;
	}
	.econ-rows span:nth-child(even) {
		text-align: right;
	}
	.econ p {
		margin: 0;
	}
	.small {
		font-size: 0.8em;
	}
	.rounds {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85em;
	}
	.rounds th {
		text-align: left;
		font-size: 0.75em;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim);
		padding: 0 0.4em 0.3em;
	}
	.rounds td {
		padding: 0.18em 0.4em;
		border-top: 1px solid var(--line);
	}
	.rounds .r {
		text-align: right;
	}
	.rounds .res {
		display: inline-block;
		width: 1.2em;
		font-weight: 800;
	}
	.rounds .multi {
		color: var(--warn);
		font-weight: 700;
	}
	.note {
		margin: auto 0 0;
		color: var(--dim);
		font-size: 0.78em;
	}
	.status {
		display: flex;
		gap: 1.5em;
		font-size: 0.8em;
		color: var(--text);
		flex-wrap: wrap;
	}
	.status .warn {
		color: var(--warn);
	}
	.status .dim {
		margin-left: auto;
	}
</style>
