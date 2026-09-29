<!--
@component
The house generator's kind: 🏠 House · 🛖 Hut group · ⛺ Tent area, or none
(tap the chosen one again). It decides the rooms' word ("huts") and kind,
the pin's icon and the rolled names; HOUSE DETAILS can change it later,
where "Other" is on the list too.
-->
<script lang="ts">
	import { HOUSE_KINDS, type HouseKind } from '$lib/accommodation';
	import { lockAttrs, type LockHint } from '$lib/layout-lock';

	export let kind: HouseKind | '' = '';
	export let lock: LockHint | null | undefined = null;
	export let id = 'house-kind';

	const CHIPS = HOUSE_KINDS.filter((entry) => entry.value !== 'other');

	function choose(value: HouseKind) {
		if (lock) return;
		kind = kind === value ? '' : value;
	}
</script>

<div class="kind-group">
	<span class="group-label" id="{id}-label">KIND</span>
	<div class="kind-chips" role="group" aria-labelledby="{id}-label">
		{#each CHIPS as entry (entry.value)}
			<button
				type="button"
				class="kind-chip"
				aria-pressed={kind === entry.value}
				title={entry.hint ?? entry.label}
				on:click={() => choose(entry.value)}
				{...lockAttrs(lock)}
			>
				<span aria-hidden="true">{entry.icon}</span>
				{entry.label}
			</button>
		{/each}
	</div>
</div>

<style>
	.kind-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.group-label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1px;
	}
	.kind-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.kind-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 36px;
		padding: 0 0.75rem;
		background: #050505;
		border: 1px solid #262626;
		border-radius: 999px;
		color: #999;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}
	.kind-chip:hover:not([data-locked]) {
		border-color: #444;
		color: #ddd;
	}
	.kind-chip[aria-pressed='true'] {
		border-color: #2dd4bf;
		color: #fff;
		background: rgba(45, 212, 191, 0.12);
	}
</style>
