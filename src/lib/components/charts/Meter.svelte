<script lang="ts">
	// A single ratio against its whole: a thin fill on a track of the same hue.
	interface Props {
		/** 0..1, or null for "no data". */
		value: number | null;
		color?: string;
		label: string;
	}

	let { value, color = 'var(--viz-single)', label }: Props = $props();
	const pctValue = $derived(value === null ? 0 : Math.max(0, Math.min(1, value)) * 100);
</script>

<div
	class="meter"
	role="meter"
	aria-label={label}
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={value === null ? undefined : Math.round(pctValue)}
	style:--c={color}
>
	<span style:width="{pctValue}%"></span>
</div>

<style>
	.meter {
		height: 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--c) 18%, transparent);
		overflow: hidden;
	}
	span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--c);
	}
</style>
