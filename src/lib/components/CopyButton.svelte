<script lang="ts">
	let { text, label = 'Copy' }: { text: string; label?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard blocked; the text is shown and selectable anyway.
		}
	}
</script>

<button type="button" class="btn copy" title={text} aria-live="polite" onclick={copy}>
	{copied ? 'Copied' : label}
</button>

<style>
	.copy {
		padding: 0.25em 0.7em;
		font-size: 0.82rem;
		white-space: nowrap;
	}
</style>
