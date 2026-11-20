<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import SteamIdForm from '#lib/live/components/SteamIdForm.svelte';
	import { ago } from '#lib/format.ts';
	import { profileUrl } from '#lib/cs2/steamid.ts';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Setup · CS2Live</title></svelte:head>

<h1>Setup</h1>

{#if !data.liveEnabled}
	<p class="muted">
		This is the hosted site. Setup is for a copy of CS2Live running on the PC you play on.
		<a href={resolve('/(app)/account')}>Your account</a> has your upload key.
	</p>
{:else}
	<div class="cols">
		<section class="panel card">
			<h2>1. Your Steam ID</h2>
			{#if data.steamId}
				<p>
					Tracking <a href={profileUrl(data.steamId)} rel="external noopener" target="_blank">
						<code>{data.steamId}</code>
					</a>
					{#if data.provider?.steamId === data.steamId}<span class="chip win">
							CS2 is sending data for it
						</span>
					{:else if data.provider}<span class="chip warn">
							CS2 is signed in as {data.provider.steamId}
						</span>{/if}
				</p>
				<details>
					<summary>Change</summary>
					<SteamIdForm
						detected={data.provider}
						current={data.steamId}
						locked={data.locked.steamId}
						error={form?.steamIdError ?? null}
					/>
				</details>
			{:else}
				<p class="muted">CS2Live only records matches for this account.</p>
				<SteamIdForm
					detected={data.provider}
					current={null}
					locked={data.locked.steamId}
					error={form?.steamIdError ?? null}
				/>
			{/if}
		</section>

		<section class="panel card">
			<h2>2. CS2 game state integration</h2>
			<ul class="checks">
				<li class:ok={data.gsi.tokenConfigured}>
					<span class="mark">{data.gsi.tokenConfigured ? '✓' : '✗'}</span> GSI token set in .env
					{#if !data.gsi.tokenConfigured}<span class="muted">
							— run <code>yarn gsi:config</code> and restart
						</span>{/if}
				</li>
				<li class:ok={data.gsi.installed}>
					<span class="mark">{data.gsi.installed ? '✓' : '✗'}</span> Config installed in CS2
					{#if !data.gsi.installed}<span class="muted">
							— run <code>yarn gsi:config --install</code>{data.gsi.cfgDir
								? ''
								: ' (CS2 folder not found; set CS2_CFG_DIR)'}
						</span>{/if}
				</li>
				{#if data.gsi.installed}
					<li class:ok={data.gsi.tokenMatches}>
						<span class="mark">{data.gsi.tokenMatches ? '✓' : '✗'}</span> Installed config uses this
						token
						{#if !data.gsi.tokenMatches}<span class="muted">
								— rerun <code>yarn gsi:config --install</code>
							</span>{/if}
					</li>
				{/if}
				<li class:ok={!!data.lastPayloadAt}>
					<span class="mark">{data.lastPayloadAt ? '✓' : '…'}</span>
					{data.lastPayloadAt
						? `Last update from CS2 ${ago(data.lastPayloadAt)}`
						: 'No update from CS2 yet (restart CS2 after installing)'}
				</li>
			</ul>
			{#if data.gsi.uri}<p class="dim small">CS2 posts to <code>{data.gsi.uri}</code></p>{/if}
			<p class="dim small">
				Payload capture is {data.capture ? `on (writing to ${data.captureDir}/)` : 'off'}. Set
				<code>GSI_CAPTURE=1</code> to record raw payloads (see fixtures/README.md).
			</p>
		</section>

		<section class="panel card wide">
			<h2>3. Where matches are saved</h2>
			{#if data.hasDb}
				<p>
					This copy has <code>DATABASE_URL</code> set, so finished matches go straight to the database.
				</p>
			{:else}
				<p class="muted">
					Finished matches upload to the CS2Live site. Sign in there, claim your Steam ID on the
					account page and create an upload key, then paste both here.
				</p>
				<form method="POST" action="?/sync" use:enhance class="sync">
					<label>
						<span class="label">Site URL</span>
						<input
							class="input"
							name="siteUrl"
							value={data.siteUrl ?? ''}
							placeholder="https://your-cs2live.vercel.app"
							disabled={data.locked.siteUrl}
						/>
					</label>
					<label>
						<span class="label">
							Upload key {data.uploadKeyHint ? `(saved: ${data.uploadKeyHint})` : ''}
						</span>
						<input
							class="input"
							name="uploadKey"
							type="password"
							placeholder={data.uploadKeyHint ? 'Leave empty to keep the saved key' : 'cs2l_…'}
							autocomplete="off"
							disabled={data.locked.uploadKey}
						/>
					</label>
					<div class="row">
						<button class="btn primary">Save</button>
						{#if data.uploadKeyHint && !data.locked.uploadKey}
							<button class="btn" name="forgetKey" value="1">Forget key</button>
						{/if}
						<button class="btn" formaction="?/testUpload">Test key</button>
					</div>
					{#if form?.syncError}<p class="error">{form.syncError}</p>{/if}
					{#if form?.testError}<p class="error">{form.testError}</p>{/if}
					{#if form?.testOk}<p class="ok">{form.testOk}</p>{/if}
				</form>
			{/if}
			<div class="syncstate">
				<span class="label">Status</span>
				{#if data.sync.mode === 'none'}
					<span class="chip warn">Not set up</span>
				{:else}
					<span class="chip win">
						{data.sync.mode === 'direct' ? 'Database' : `Uploading to ${data.sync.target}`}
					</span>
				{/if}
				{#if data.sync.pending > 0}<span class="chip warn">{data.sync.pending} waiting</span>{/if}
				{#if data.sync.lastSyncedAt}<span class="muted">
						last saved {ago(data.sync.lastSyncedAt)}
					</span>{/if}
				{#if data.sync.lastError}<span class="error">{data.sync.lastError}</span>{/if}
			</div>
			<p class="dim small">
				Matches wait in <code>.cs2live/outbox/</code> until they're saved, so nothing is lost if the site
				is down.
			</p>
		</section>
	</div>

	<p><a class="btn primary" href={resolve('/(screen)/live')}>Open the live view</a></p>
{/if}

<style>
	h1 {
		font-size: 1.8rem;
		margin-bottom: 1.2rem;
	}
	h2 {
		font-size: 1.1rem;
		margin-bottom: 0.4rem;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		gap: 1rem;
		margin-bottom: 1.2rem;
	}
	.card {
		padding: 1.2rem;
		display: grid;
		gap: 0.75rem;
		align-content: start;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.card p {
		margin: 0;
	}
	.checks {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.45rem;
	}
	.mark {
		display: inline-block;
		width: 1.2em;
		color: var(--loss);
		font-weight: 700;
	}
	.checks li.ok .mark {
		color: var(--win);
	}
	.sync {
		display: grid;
		gap: 0.75rem;
		max-width: 640px;
	}
	.sync label {
		display: grid;
		gap: 0.3rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.syncstate {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	.error {
		color: var(--loss);
		margin: 0;
	}
	.ok {
		color: var(--win);
		margin: 0;
	}
	.small {
		font-size: 0.82rem;
	}
	code {
		font-family: var(--mono);
		font-size: 0.9em;
	}
	summary {
		cursor: pointer;
		color: var(--ct);
		margin-bottom: 0.6rem;
	}
</style>
