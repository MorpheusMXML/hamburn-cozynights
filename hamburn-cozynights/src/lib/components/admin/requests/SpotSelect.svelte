<script lang="ts">
	/**
	 * The spot picker of the requests page (docs/admin/special-needs.md): one
	 * native list of the free spots, the ones that answer most of the request's
	 * needs first. A spot says what it fits ("✓ lower bunk") or where it
	 * clearly doesn't ("✗ upper bunk"), so the crew reads the list instead of
	 * remembering the camp.
	 *
	 * ♿ special-needs spots carry ♿ in their text. They come first for a
	 * request with something the guest needs, and last for anything else (an
	 * art project, a group only): they are kept for access needs. When none is
	 * free, a line under the list says why — the ♿ panel above lists them all.
	 * Used on each request card and in a group's planner (GroupCard).
	 */
	import { factsOf, matchNeeds, needShort } from '$lib/accommodation';
	import { requestKinds, type SpecialNeed, type SpotInfo } from '$lib/special-needs';

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

	const access = $derived(requestKinds(needs).access);

	function fitText(match: ReturnType<typeof matchNeeds>): string {
		const parts = [
			...match.fits.map((need) => `✓ ${needShort(need)}`),
			...match.conflicts.map((need) => `✗ ${needShort(need)}`)
		];
		return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
	}

	/** One group of the list, best match first; a tie keeps the camp's natural order. */
	function ranked(special: boolean) {
		return spots
			.filter((spot) => spot.special === special)
			.map((spot) => ({ spot, match: matchNeeds(needs, factsOf(spot.bedType, spot.features)) }))
			.sort((a, b) => b.match.score - a.match.score)
			.map(({ spot, match }) => ({
				bedId: spot.bedId,
				text: `${special ? '♿ ' : ''}${spot.label}${spot.locked ? ' 🔒' : ''}${fitText(match)}`
			}));
	}

	const groups = $derived.by(() => {
		const specialSpots = ranked(true);
		const special = {
			label: access
				? `♿ Special-needs spots (${specialSpots.length} free)`
				: '♿ Special-needs spots (kept for access needs)',
			entries: specialSpots
		};
		const other = { label: 'Other free spots', entries: ranked(false) };
		return (access ? [special, other] : [other, special]).filter(
			(group) => group.entries.length > 0
		);
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
	<!-- Only where a ♿ spot would come first: a request with something the guest needs. -->
	{#if specialFree === 0 && access}
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
