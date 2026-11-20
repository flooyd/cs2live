<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import SteamIdForm from '#lib/live/components/SteamIdForm.svelte';
	import { ago, date } from '#lib/format.ts';

	let { data, form }: PageProps = $props();
	let copied = $state(false);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard blocked; the key is selectable anyway.
		}
	}
</script>

<svelte:head><title>Account · CS2Live</title></svelte:head>

{#if !data.enabled}
	<h1>Account</h1>
	<p class="muted">
		This copy of CS2Live has no database, so it has no accounts. Sign in on the CS2Live website.
	</p>
{:else}
	<div class="head">
		<div>
			<h1>{data.user.name}</h1>
			<p class="muted">{data.user.email}</p>
		</div>
		<form method="POST" action="?/signOut" use:enhance>
			<button class="btn">Sign out</button>
		</form>
	</div>

	<div class="cols">
		<section class="panel card">
			<h2>1. Your Steam ID</h2>
			{#if data.link}
				<p>
					Claimed: <a href={resolve('/(app)/players/[steamid]', { steamid: data.link.steamId })}>
						<code>{data.link.steamId}</code>
					</a>
					<span class="muted">
						· {data.uploaded} match{data.uploaded === 1 ? '' : 'es'} recorded
					</span>
				</p>
				<details>
					<summary>Change</summary>
					<SteamIdForm
						detected={null}
						current={data.link.steamId}
						action="?/claim"
						error={form?.steamIdError ?? null}
					/>
				</details>
			{:else}
				<p class="muted">
					Claim the Steam account you play on. Uploads are only accepted for this Steam ID.
				</p>
				<SteamIdForm
					detected={null}
					current={null}
					action="?/claim"
					error={form?.steamIdError ?? null}
				/>
			{/if}
			<p class="dim small">
				Steam ownership isn't verified: the first account to claim a Steam ID gets it.
			</p>
		</section>

		<section class="panel card">
			<h2>2. Upload key</h2>
			{#if !data.link}
				<p class="muted">Claim your Steam ID first.</p>
			{:else}
				{#if form?.newKey}
					{@const newKey = form.newKey}
					<div class="newkey" role="status">
						<div class="label">Your new upload key, shown only once</div>
						<div class="keyrow">
							<code class="key">{newKey}</code>
							<button class="btn" type="button" onclick={() => copy(newKey)}>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</div>
					</div>
				{:else if data.link.keyPrefix}
					<p>
						Active key <code>{data.link.keyPrefix}…</code>
						{#if data.link.keyCreatedAt}<span class="muted">
								created {date(data.link.keyCreatedAt)}
							</span>{/if}
					</p>
					<p class="muted small">
						{data.link.lastUploadAt
							? `Last upload ${ago(data.link.lastUploadAt)}.`
							: 'Not used yet.'}
					</p>
				{:else}
					<p class="muted">No key yet.</p>
				{/if}
				<div class="row">
					<form method="POST" action="?/createKey" use:enhance>
						<button class="btn primary">
							{data.link.keyPrefix ? 'Replace key' : 'Create key'}
						</button>
					</form>
					{#if data.link.keyPrefix}
						<form method="POST" action="?/revokeKey" use:enhance>
							<button class="btn">Revoke</button>
						</form>
					{/if}
				</div>
				{#if form?.keyError}<p class="error">{form.keyError}</p>{/if}
				<p class="dim small">Replacing or revoking a key stops the old one working at once.</p>
			{/if}
		</section>

		<section class="panel card wide">
			<h2>3. Connect your copy of CS2Live</h2>
			<ol>
				<li>Run CS2Live on the PC you play on (<code>yarn live</code>, see the README).</li>
				<li>
					Open its Setup page (<code>http://localhost:5173/setup</code>) and enter:
					<div class="pair">
						<span class="label">Site URL</span><code>{data.siteUrl}</code>
						<span class="label">Upload key</span><code>the key from step 2</code>
					</div>
				</li>
				<li>Click <em>Test key</em>. Finished matches upload by themselves from then on.</li>
			</ol>
		</section>
	</div>
{/if}

<style>
	h1 {
		font-size: 1.8rem;
	}
	h2 {
		font-size: 1.1rem;
		margin-bottom: 0.3rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.2rem;
	}
	.head p {
		margin: 0.2rem 0 0;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		gap: 1rem;
	}
	.card {
		padding: 1.2rem;
		display: grid;
		gap: 0.75rem;
		align-content: start;
	}
	.card p {
		margin: 0;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.newkey {
		padding: 0.9rem 1rem;
		border-radius: var(--radius);
		background: var(--win-soft);
		border: 1px solid var(--win);
		display: grid;
		gap: 0.5rem;
	}
	.keyrow {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.key {
		flex: 1;
		font-size: 0.95rem;
		word-break: break-all;
		user-select: all;
	}
	.pair {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 1rem;
		align-items: baseline;
		margin: 0.5rem 0;
	}
	ol {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.5rem;
	}
	code {
		font-family: var(--mono);
		font-size: 0.9em;
	}
	.error {
		color: var(--loss);
	}
	.small {
		font-size: 0.82rem;
	}
	summary {
		cursor: pointer;
		color: var(--ct);
		margin-bottom: 0.6rem;
	}
</style>
