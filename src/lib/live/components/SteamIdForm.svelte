<script lang="ts">
	import { enhance } from '$app/forms';

	interface Props {
		/** Steam ID CS2 is currently sending data for, offered as a one-click choice. */
		detected: { steamId: string; name: string | null } | null;
		current: string | null;
		locked?: boolean;
		error?: string | null;
		/** Where to go after saving. */
		redirectTo?: string;
		/** Form action; it reads a `steamId` field and fails with `{ steamIdError }`. */
		action?: string;
		/** Shown when `locked` (the Steam ID comes from the environment). */
		lockedMessage?: string;
	}

	let {
		detected,
		current,
		locked = false,
		error = null,
		redirectTo,
		action = '/setup?/steamId',
		lockedMessage
	}: Props = $props();
	let value = $state('');
	let busy = $state(false);
	// The action can live on another page (/live posts to /setup), whose `form` prop this page
	// never sees, so keep the error from the result here too.
	let localError = $state<string | null>(null);
	const shownError = $derived(localError ?? error);
</script>

{#if locked}
	<p class="muted">
		{#if lockedMessage}{lockedMessage}{:else}Your Steam ID is set by the <code>STEAM_ID</code>
			environment variable: <code>{current}</code>.{/if}
	</p>
{:else}
	<form
		method="POST"
		{action}
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				const message = result.type === 'failure' ? result.data?.steamIdError : null;
				localError =
					result.type !== 'failure'
						? null
						: typeof message === 'string'
							? message
							: 'Could not save that Steam ID.';
				await update();
			};
		}}
	>
		{#if redirectTo}<input type="hidden" name="redirectTo" value={redirectTo} />{/if}
		{#if detected && detected.steamId !== current}
			<div class="detected">
				<div>
					<div class="label">CS2 is sending data for</div>
					<div class="who">
						<strong>{detected.name ?? 'Unknown player'}</strong>
						<code>{detected.steamId}</code>
					</div>
				</div>
				<button class="btn primary" name="steamId" value={detected.steamId} disabled={busy}>
					That's me
				</button>
			</div>
			<p class="or">or enter it yourself</p>
		{/if}
		<label class="field">
			<span class="label">Steam ID</span>
			<div class="row">
				<input
					class="input"
					name="steamId"
					bind:value
					placeholder="76561198… or https://steamcommunity.com/profiles/…"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="btn" class:primary={!detected} disabled={busy || !value.trim()}>Save</button>
			</div>
		</label>
		<p class="hint">
			Paste your SteamID64, your profile link (<code>steamcommunity.com/profiles/…</code>),
			<code>[U:1:…]</code> or <code>STEAM_0:…</code>. Custom profile links (<code>/id/name</code>)
			can't be looked up without a Steam API key. Your SteamID64 is in the Steam client under
			Account details, or paste your custom link into steamid.io.
		</p>
		{#if shownError}<p class="error" role="alert">{shownError}</p>{/if}
	</form>
{/if}

<style>
	form {
		display: grid;
		gap: 0.9rem;
	}
	.detected {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius);
		background: var(--ct-soft);
		border: 1px solid var(--ct-strong);
	}
	.who {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		flex-wrap: wrap;
		font-size: 1.05rem;
	}
	.or {
		margin: 0;
		text-align: center;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.field {
		display: grid;
		gap: 0.35rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.82rem;
	}
	.error {
		margin: 0;
		color: var(--loss);
	}
	code {
		font-family: var(--mono);
		font-size: 0.9em;
	}
</style>
