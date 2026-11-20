<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let mode = $state<'signIn' | 'signUp'>('signIn');
	$effect.pre(() => {
		if (form?.mode) mode = form.mode;
	});
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · CS2Live</title></svelte:head>

<div class="wrap">
	{#if !data.enabled}
		<h1>Accounts live on the site</h1>
		<p class="muted">
			This copy of CS2Live has no database. Sign in on the CS2Live website to claim your Steam ID
			and get an upload key, then paste it on the <a href={resolve('/(app)/setup')}>Setup</a> page.
		</p>
	{:else}
		<div class="tabs" role="tablist">
			<button
				role="tab"
				aria-selected={mode === 'signIn'}
				class:on={mode === 'signIn'}
				onclick={() => (mode = 'signIn')}
			>
				Sign in
			</button>
			<button
				role="tab"
				aria-selected={mode === 'signUp'}
				class:on={mode === 'signUp'}
				onclick={() => (mode = 'signUp')}
			>
				Create account
			</button>
		</div>

		<form
			class="panel"
			method="POST"
			action={mode === 'signIn' ? '?/signIn' : '?/signUp'}
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
		>
			{#if mode === 'signUp'}
				<label>
					<span class="label">Name</span>
					<input
						class="input"
						name="name"
						value={form?.name ?? ''}
						autocomplete="nickname"
						required
					/>
				</label>
			{/if}
			<label>
				<span class="label">Email</span>
				<input
					class="input"
					name="email"
					type="email"
					value={form?.email ?? ''}
					autocomplete="email"
					required
				/>
			</label>
			<label>
				<span class="label">Password</span>
				<input
					class="input"
					name="password"
					type="password"
					minlength="8"
					autocomplete={mode === 'signIn' ? 'current-password' : 'new-password'}
					required
				/>
			</label>
			{#if form?.error && form.mode === mode}<p class="error" role="alert">{form.error}</p>{/if}
			<button class="btn primary" disabled={busy}>
				{mode === 'signIn' ? 'Sign in' : 'Create account'}
			</button>
			{#if mode === 'signUp'}
				<p class="muted small">
					An account lets you claim your Steam ID and upload matches from your own copy of CS2Live.
					Looking players up needs no account. Sign-up may be limited to people the site owner
					invited.
				</p>
			{/if}
		</form>
	{/if}
</div>

<style>
	.wrap {
		max-width: 420px;
		margin: 2rem auto;
		display: grid;
		gap: 1rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: var(--radius);
		background: var(--panel);
		border: 1px solid var(--line);
	}
	.tabs button {
		flex: 1;
		padding: 0.55rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.tabs button.on {
		background: var(--panel-2);
		color: var(--text);
	}
	form {
		padding: 1.3rem;
		display: grid;
		gap: 0.9rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	.error {
		color: var(--loss);
		margin: 0;
	}
	.small {
		font-size: 0.85rem;
		margin: 0;
	}
</style>
