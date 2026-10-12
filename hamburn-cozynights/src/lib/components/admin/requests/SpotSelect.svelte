<script lang="ts">
	/**
	 * The spot picker of the requests page (docs/admin/special-needs.md): one
	 * native list of the free spots, the ones that answer most of the request's
	 * needs first. A spot says what it fits ("✓ lower bunk") or where it
	 * clearly doesn't ("✗ upper bunk"), so the crew reads the list instead of
	 * remembering the camp.
	 *
	 * ♿ special-needs spots carry ♿ in their text and come first: they are the
	 * pool for special-needs requests (Max, 2026-10-12). A spot the crew locked
	 * 🔒 says "blocked" and comes last of its group: out of service, only on
	 * purpose. When no ♿ spot is free, a line under the list says why — the ♿
	 * panel above lists them all. The list without JavaScript; with it, the
	 * cards use the spot picker (SpotPicker). Used on each request card and in
	 * a group's planner (GroupCard).
	 */
	import { factsOf, matchNeeds, needShort } from '$lib/accommodation';
	import type { SpecialNeed, SpotInfo } from '$lib/special-needs';

	let {
		name,
		id,
		spots,
		needs,
		specialFree,
		specialSummary,
		placeholder,
		value = $bindable(''),
		onpick
	}: {
		/** The form field: bedId on a request card, bed_<request id> in the planner. */
		name: string;
		id: string;
		/** The free spots an admin can book (listAssignableSpots). */
		spots: SpotInfo[];
		/** What the request asks for: ranks the spots and places the ♿ group. */
		needs: readonly SpecialNeed[];
		/** Free ♿ spots in the camp: none, and the line under the list says why. */
		specialFree: number;
		/** Where the ♿ spots stand ("3 marked — 1 inactive, …"); '' when none is marked. */
		specialSummary: string;
		/** The empty first option: "Pick a free spot…", or "Keep as is" in the planner. */
		placeholder: string;
		/**
		 * The spot picked; '' for the placeholder. The crew's pick stays here
		 * until the page passes a new value (the planner's proposal).
		 */
		value?: string;
		/** Told the bed id ('' = placeholder) when the crew picks another spot. */
		onpick?: (bedId: string) => void;
	} = $props();

	function fitText(match: ReturnType<typeof matchNeeds>): string {
		const parts = [
			...match.fits.map((need) => `✓ ${needShort(need)}`),
			...match.conflicts.map((need) => `✗ ${needShort(need)}`)
		];
		return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
	}

	/** One group of the list, best match first, blocked ones last; a tie keeps the camp's order. */
	function ranked(special: boolean) {
		return spots
			.filter((spot) => spot.special === special)
			.map((spot) => ({ spot, match: matchNeeds(needs, factsOf(spot.bedType, spot.features)) }))
			.sort(
				(a, b) => Number(a.spot.locked) - Number(b.spot.locked) || b.match.score - a.match.score
			)
			.map(({ spot, match }) => ({
				bedId: spot.bedId,
				text: `${special ? '♿ ' : ''}${spot.label}${spot.locked ? ' 🔒 blocked' : ''}${fitText(match)}`
			}));
	}

	const groups = $derived.by(() => {
		const specialSpots = ranked(true);
		const free = specialSpots.length - spots.filter((s) => s.special && s.locked).length;
		return [
			{ label: `♿ Special-needs spots (${free} free)`, entries: specialSpots },
			{ label: 'Other free spots', entries: ranked(false) }
		].filter((group) => group.entries.length > 0);
	});
</script>

<div class="spot-select">
	<select {id} {name} bind:value onchange={(event) => onpick?.(event.currentTarget.value)}>
		<option value="">{placeholder}</option>
		{#each groups as group (group.label)}
			<optgroup label={group.label}>
				{#each group.entries as entry (entry.bedId)}
					<option value={entry.bedId}>{entry.text}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	<!-- The ♿ spots are the pool for every special-needs request. -->
	{#if specialFree === 0}
		<p class="hint">
			{#if specialSummary}
				♿ No special-needs spot is free right now: {specialSummary}. See “♿ Special-needs spots”
				above.
			{:else}
				♿ No spot is marked as a special-needs spot yet: press ♿ SPECIAL on a spot in the room
				editor.
			{/if}
		</p>
	{/if}
</div>

<style>
	.spot-select {
		flex: 1 1 16rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 0 0.75rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
	}
	.hint {
		margin: 0;
		color: #a3a3a3;
		font-size: 0.85rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
</style>
