<!--
@component
The spot picker of the requests page (docs/admin/special-needs.md, "Decide
and book"): a sheet over the page with every free spot, house by house and
room by room, to narrow down — a search, the wishes of the map's filter, ♿
spots only, one house — and to pick from ($lib/spot-picker).

- spot: one spot for one person. Each spot's card says its bed and what it
  answers of the request (✓ / ✗); the best fits also come first in a strip
  of their own. The button at the bottom takes the pick: on a request's card
  it books right away (the page asks first), in a group's plan it only fills
  the member's row.
- group: a room for a request group — a group sleeps in one room (Max,
  2026-10-12). The rooms that fit everyone are suggested first; "Put the
  group here" proposes who sleeps where ($lib/group-plan) and writes the
  names on the spots; then book it in one go, or edit the plan in the
  group's card. A room too small for everyone takes as many as fit, the
  crew picks the others' spots in the card ("Change"); nothing splits a
  group by itself.

Escape, ✕, Cancel or the backdrop close it without a choice; Tab stays
inside. The page renders one at a time, outside every form.
-->
<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dialogQueue } from '$lib/dialogs';
	import {
		SPOT_FILTERS,
		availableFilters,
		bedTypeEntry,
		factsOf,
		featureEntry,
		houseKindEntry,
		needShort,
		roomKindEntry,
		spotMatchesFilter,
		type FeatureEntry,
		type SpotFilter
	} from '$lib/accommodation';
	import {
		needsMet,
		placeOptions,
		proposePlan,
		recommendRooms,
		toPlace,
		type NeedsMet,
		type PlanMember
	} from '$lib/group-plan';
	import {
		OTHER_NEED,
		isAccessNeed,
		requestKinds,
		type SpecialNeed,
		type SpotInfo
	} from '$lib/special-needs';
	import { needPill } from '$lib/need-pill';
	import {
		bestFits,
		buildPlaces,
		checkableNeeds,
		fitOf,
		isFiltered,
		passes,
		unitSpots,
		type PickerFilter,
		type PickerRequest
	} from '$lib/spot-picker';

	let {
		request,
		spots,
		sizes,
		specialFree,
		specialSummary
	}: {
		request: PickerRequest;
		/** The free spots an admin can book (listAssignableSpots). */
		spots: SpotInfo[];
		/** Room id → active spots (countRoomSpots), for "3 of 6 free". */
		sizes: Record<string, number>;
		/** Free ♿ spots in the camp: none, and a line says why. */
		specialFree: number;
		/** Where the ♿ spots stand ("3 marked — 1 inactive, …"); '' when none is marked. */
		specialSummary: string;
	} = $props();

	// What the request is: fixed while the picker is open (the page opens a new one each time).
	const spotMode = $derived(request.mode === 'spot' ? request : null);
	const groupMode = $derived(request.mode === 'group' ? request : null);
	/** Each need once: stored needs aren't deduplicated. */
	const needs: SpecialNeed[] = $derived(spotMode ? [...new Set(spotMode.needs)] : []);
	const access = $derived(requestKinds(needs).access);
	const canFit = $derived(checkableNeeds(needs).length > 0);
	const planned: Record<string, string> = $derived(spotMode?.planned ?? {});
	/**
	 * The row had a spot in the plan when the picker opened: picking another
	 * member's spot swaps the two; without one, the other goes back to "Keep
	 * as is" (repick in $lib/group-plan).
	 */
	const swaps = $derived(
		!!spotMode?.selected && spots.some((spot) => spot.bedId === spotMode.selected)
	);

	// ── The filter ───────────────────────────────────────────────────────────
	let query = $state('');
	let houseId = $state('');
	let wishes = $state<SpotFilter[]>([]);
	let fitting = $state(false);
	let specialOnly = $state(false);
	/** Group: only rooms with a free spot for everyone to place. */
	let roomsThatFit = $state(false);

	const filter: PickerFilter = $derived({
		query,
		houseId,
		wishes,
		fitting,
		special: specialOnly
	});

	// ── The group ────────────────────────────────────────────────────────────
	const members = $derived(groupMode?.members ?? []);
	const placing = $derived(toPlace(members));
	const keeping = $derived(members.filter((member) => !member.declined && member.crewSpotLabel));
	const accessCount = $derived(
		placing.filter((member) => requestKinds(member.needs).access).length
	);
	const options = $derived(groupMode ? placeOptions(spots, placing.length, accessCount) : []);
	const optionOf = $derived(new Map(options.map((option) => [option.key, option])));
	let place = $state(untrack(() => (request.mode === 'group' ? request.place : '')));
	/** No room chosen yet (''): no proposal. */
	const proposal: Record<string, string> = $derived(
		groupMode && place ? proposePlan(members, spots, place) : {}
	);
	const placed = $derived(placing.filter((member) => proposal[member.requestId]).length);
	/** Does anyone to place need something the layout can tell? Then each room says how it does. */
	const anyNeeds = $derived(placing.some((member) => checkableNeeds(member.needs).length > 0));
	const needsAt: Map<string, NeedsMet> = $derived(
		new Map(
			anyNeeds
				? options
						.filter((option) => option.key.startsWith('room:'))
						.map((option) => [option.key, needsMet(members, spots, option.key)] as const)
				: []
		)
	);

	/** Whose name a spot carries: the group's proposal, or the plan's other rows. */
	const nameOn = $derived.by(() => {
		const names: Record<string, string> = { ...planned };
		for (const member of placing) {
			const bedId = proposal[member.requestId];
			if (bedId) names[bedId] = member.name;
		}
		return names;
	});

	// ── What is shown ────────────────────────────────────────────────────────
	const fitRooms = $derived(
		new Set(
			options
				.filter((option) => option.fits && option.key.startsWith('room:'))
				.map((option) => option.key.slice('room:'.length))
		)
	);
	const shown = $derived(
		spots.filter(
			(spot) => passes(spot, filter, needs) && (!roomsThatFit || fitRooms.has(spot.roomId))
		)
	);
	const shownIds = $derived(new Set(shown.map((spot) => spot.bedId)));
	const houses = $derived(buildPlaces(spots, sizes, (spot) => shownIds.has(spot.bedId)));
	const allHouses = $derived(buildPlaces(spots, sizes));
	/** The rooms that fit everyone, best first (recommendRooms) — among those the filter shows. */
	const suggestions = $derived.by(() => {
		if (!groupMode) return [];
		const rooms = new Set(shown.map((spot) => spot.roomId));
		return recommendRooms(options, members, spots)
			.filter((option) => rooms.has(option.key.slice('room:'.length)))
			.slice(0, 3);
	});
	const best = $derived(spotMode && !roomsThatFit ? bestFits(shown, needs) : []);
	const filtered = $derived(isFiltered(filter) || roomsThatFit);

	const factsList = $derived(spots.map((spot) => factsOf(spot.bedType, spot.features)));
	/** The wishes worth a chip: those at least one free spot answers. */
	const wishChips = $derived.by(() => {
		const offered = availableFilters(factsList);
		return SPOT_FILTERS.filter((entry) => offered.includes(entry.value));
	});
	const wishCount = (wish: SpotFilter) =>
		factsList.filter((facts) => spotMatchesFilter(wish, facts)).length;
	const fittingCount = $derived(canFit ? spots.filter((spot) => fitOf(needs, spot).all).length : 0);
	const specialCount = $derived(spots.filter((spot) => spot.special).length);

	// ── The pick ─────────────────────────────────────────────────────────────
	let selected = $state(untrack(() => (request.mode === 'spot' ? (request.selected ?? '') : '')));
	const selectedSpot = $derived(spots.find((spot) => spot.bedId === selected));

	function toggleWish(wish: SpotFilter) {
		wishes = wishes.includes(wish) ? wishes.filter((w) => w !== wish) : [...wishes, wish];
	}

	function clearFilters() {
		query = '';
		houseId = '';
		wishes = [];
		fitting = false;
		specialOnly = false;
		roomsThatFit = false;
	}

	let finished = false;
	function close() {
		if (finished) return;
		finished = true;
		if (spotMode) spotMode.resolve(null);
		else groupMode?.resolve(null);
	}

	function take() {
		if (finished || !spotMode || !selectedSpot) return;
		finished = true;
		spotMode.resolve(selectedSpot.bedId);
	}

	function finish(book: boolean) {
		if (finished || !groupMode || placed === 0) return;
		finished = true;
		groupMode.resolve({ place, book });
	}

	// ── Words ────────────────────────────────────────────────────────────────
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	/** "✓ No ladder", "✗ Step-free": what a spot answers of the request. */
	function fitMarks(spot: SpotInfo): { ok: boolean; text: string }[] {
		if (!spotMode) return [];
		const { match } = fitOf(needs, spot);
		return [
			...match.fits.map((need) => ({ ok: true, text: needShort(need) })),
			...match.conflicts.map((need) => ({ ok: false, text: needShort(need) }))
		];
	}

	const bedText = (spot: SpotInfo) => bedTypeEntry(spot.bedType)?.label ?? 'Bed not described';

	/**
	 * How wide the tiles of one grid must at least be (rem), so the longest word
	 * of their names fits on a line: an ordinary word is never split, a name
	 * longer than 16 letters may break (it would not fit a phone anyway).
	 */
	function tileMin(list: SpotInfo[]): number {
		const words = list.flatMap((spot) => (spot.spot || '').split(/[\s\-–—_/]+/));
		const longest = Math.max(0, ...words.map((word) => word.length).filter((n) => n <= 16));
		return Math.max(8.5, Math.round((longest * 0.65 + 1.6) * 10) / 10);
	}
	const featureList = (values: string[]) =>
		values.map((value) => featureEntry(value)).filter((entry): entry is FeatureEntry => !!entry);

	/** "No ladder, Quiet": what a member needs to sleep well. */
	const memberNeeds = (list: readonly SpecialNeed[]) =>
		list
			.filter((need) => isAccessNeed(need) || need === OTHER_NEED.value)
			.map(needShort)
			.join(', ');

	/** In the group's preview: the spot alone in a room, with its room elsewhere. */
	function previewSpot(bedId: string): string {
		const spot = spots.find((s) => s.bedId === bedId);
		if (!spot) return '';
		const lock = spot.locked ? ' 🔒' : '';
		if (place.startsWith('room:')) return `${spot.spot}${lock} · ${bedText(spot)}`;
		if (place.startsWith('house:')) return `${spot.spot}${lock} · ${spot.room}`;
		return `${spot.label}${lock}`;
	}

	/** "✓ needs met" / "needs: 1 of 2 met": what the proposal there gives who needs something. */
	function needsBadge(key: string): { text: string; tone: 'fits' | 'warn' } | null {
		const there = needsAt.get(key);
		// Only where everyone fits: a place too small for the group is no answer.
		if (!there || there.of === 0 || !optionOf.get(key)?.fits) return null;
		return there.met === there.of
			? { text: '✓ needs met', tone: 'fits' }
			: { text: `needs: ${there.met} of ${there.of} met`, tone: 'warn' };
	}

	/** "✓ No ladder · ✗ Step-free": what a member's planned spot answers of theirs. */
	function memberMarks(member: PlanMember, bedId: string): string {
		const spot = spots.find((s) => s.bedId === bedId);
		if (!spot) return '';
		const { match } = fitOf(member.needs, spot);
		return [
			...match.fits.map((need) => `✓ ${needShort(need)}`),
			...match.conflicts.map((need) => `✗ ${needShort(need)}`)
		].join(' · ');
	}

	function fitBadge(
		key: string
	): { text: string; tone: 'fits' | 'special' | 'locked' | 'small' } | null {
		const option = optionOf.get(key);
		if (!option || placing.length === 0) return null;
		if (!option.fits) return { text: `too small for ${placing.length}`, tone: 'small' };
		if (option.usesLocked) return { text: `fits all ${placing.length} · uses 🔒`, tone: 'locked' };
		if (option.usesSpecial)
			return { text: `fits all ${placing.length} · uses ♿`, tone: 'special' };
		return { text: `fits all ${placing.length}`, tone: 'fits' };
	}

	// ── The sheet ────────────────────────────────────────────────────────────
	let sheet = $state<HTMLDivElement>();
	let calm = $state(false);
	let previousFocus: HTMLElement | null = null;

	onMount(() => {
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		previousFocus = document.activeElement as HTMLElement | null;
		document.body.style.overflow = 'hidden';
		void tick().then(() => sheet?.focus());
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		document.body.style.overflow = '';
		// Not when the page's confirmation took the focus meanwhile (a pick that books).
		const active = document.activeElement;
		const lost = !active || active === document.body || !active.isConnected;
		if (lost && previousFocus?.isConnected) previousFocus.focus();
	});

	function keydown(event: KeyboardEvent) {
		// A confirmation on top of the picker answers its own keys.
		if ($dialogQueue.length > 0) return;
		if (event.key === 'Escape') {
			// The first Escape in a filled search clears the search (the browser does it).
			const target = event.target as HTMLInputElement | null;
			if (target?.type === 'search' && target.value) {
				query = '';
				return;
			}
			event.preventDefault();
			close();
		} else if (event.key === 'Tab' && sheet) {
			const items = [
				...sheet.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), a[href]'
				)
			].filter((el) => el.offsetParent !== null);
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === sheet)
			) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}
</script>

<svelte:window onkeydown={keydown} />

{#snippet tile(spot: SpotInfo, context: boolean)}
	{@const marks = fitMarks(spot)}
	{@const owner = nameOn[spot.bedId]}
	{#if spotMode}
		<button
			type="button"
			class="tile"
			class:special={spot.special}
			class:mismatch={marks.some((mark) => !mark.ok)}
			class:picked={selected === spot.bedId}
			aria-pressed={selected === spot.bedId}
			onclick={() => (selected = spot.bedId)}
		>
			<span class="tile-head">
				<span class="tile-name">{spot.spot || 'Spot'}</span>
				{#if spot.special}<span class="tile-flag special-flag">♿</span>{/if}
				{#if spot.locked}<span class="tile-flag" title="Locked">🔒</span>{/if}
			</span>
			{#if context}<span class="tile-where">{spot.room} · {spot.house}</span>{/if}
			<span class="tile-bed">{bedText(spot)}</span>
			{#each marks as mark (mark.text)}
				<span class="tile-mark" class:ok={mark.ok}>{mark.ok ? '✓' : '✗'} {mark.text}</span>
			{/each}
			{#if owner}<span class="tile-owner">{`→ ${owner}`}</span>{/if}
		</button>
	{:else}
		<div class="tile still" class:special={spot.special} class:planned={!!owner}>
			<span class="tile-head">
				<span class="tile-name">{spot.spot || 'Spot'}</span>
				{#if spot.special}<span class="tile-flag special-flag">♿</span>{/if}
				{#if spot.locked}<span class="tile-flag" title="Locked">🔒</span>{/if}
			</span>
			<span class="tile-bed">{bedText(spot)}</span>
			{#if owner}<span class="tile-owner">{`→ ${owner}`}</span>{/if}
		</div>
	{/if}
{/snippet}

<div
	class="picker-backdrop"
	onclick={close}
	role="presentation"
	transition:fade={{ duration: calm ? 0 : 140 }}
>
	<!-- svelte-ignore a11y_click_events_have_key_events (only keeps a click inside from closing it) -->
	<div
		class="picker-sheet"
		bind:this={sheet}
		onclick={(event) => event.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="spot-picker-title"
		tabindex="-1"
		transition:fly={{ y: calm ? 0 : 24, duration: calm ? 0 : 220, easing: cubicOut }}
	>
		<header class="picker-head">
			<div class="head-text">
				{#if spotMode}
					<div class="title-row">
						<h2 id="spot-picker-title">
							<span aria-hidden="true">🛏️</span> A spot for {spotMode.who}
						</h2>
						{#if needs.length > 0}
							<ul class="pills" aria-label="What they asked for">
								{#each needs as need (need)}
									{@const pill = needPill(need, true)}
									<li class:access={!pill.neutral}>{pill.text}</li>
								{/each}
							</ul>
						{/if}
					</div>
					{#if spotMode.current}<p class="now">Now: {spotMode.current}</p>{/if}
					{#if access && specialFree === 0}
						<p class="hint">
							{specialSummary
								? `♿ No special-needs spot is free right now: ${specialSummary}.`
								: '♿ No spot is marked as a special-needs spot yet.'}
						</p>
					{/if}
				{:else if groupMode}
					<div class="title-row">
						<h2 id="spot-picker-title">
							<span aria-hidden="true">👥</span> A room for {groupMode.name}
						</h2>
						<ul class="pills" aria-label="Who gets a spot">
							{#each placing as member (member.requestId)}
								{@const wants = memberNeeds(member.needs)}
								<li class:access={!!wants}>{member.name}{wants ? ` · ♿ ${wants}` : ''}</li>
							{/each}
						</ul>
					</div>
					{#if keeping.length > 0}
						<p class="now">
							{keeping.map((member) => `${member.name} keeps ${member.crewSpotLabel}`).join(' · ')}
							(booked by the crew).
						</p>
					{/if}
				{/if}
			</div>
			<button type="button" class="close" aria-label="Close" title="Close" onclick={close}>✕</button
			>
		</header>

		<div class="picker-tools">
			<div class="search-row">
				<label class="search">
					<span class="sr-only">Find a house, room or spot</span>
					<input
						type="search"
						bind:value={query}
						placeholder="Find a house, room or spot"
						autocomplete="off"
						enterkeyhint="search"
					/>
				</label>
				<p class="count" aria-live="polite">
					{#if filtered}
						{shown.length} of {spots.length} free shown ·
						<button type="button" class="link" onclick={clearFilters}>Show all</button>
					{:else}
						{spots.length} free {plural(spots.length, 'spot', 'spots')}
					{/if}
				</p>
			</div>
			<!-- data-layout-ignore: short of room, the row scrolls sideways on purpose -->
			<div class="chips" role="group" aria-label="Show only" data-layout-ignore>
				{#if spotMode && canFit}
					<button
						type="button"
						class="chip fit"
						aria-pressed={fitting}
						onclick={() => (fitting = !fitting)}>✓ Fits all they need ({fittingCount})</button
					>
				{/if}
				{#if groupMode && placing.length > 0}
					<button
						type="button"
						class="chip fit"
						aria-pressed={roomsThatFit}
						onclick={() => (roomsThatFit = !roomsThatFit)}
						>Rooms for all {placing.length} ({fitRooms.size})</button
					>
				{/if}
				{#if specialCount > 0}
					<button
						type="button"
						class="chip special"
						aria-pressed={specialOnly}
						onclick={() => (specialOnly = !specialOnly)}
						>♿ Special-needs spots ({specialCount})</button
					>
				{/if}
				{#each wishChips as wish (wish.value)}
					<button
						type="button"
						class="chip"
						aria-pressed={wishes.includes(wish.value)}
						title={wish.hint}
						onclick={() => toggleWish(wish.value)}
						>{wish.icon} {wish.label} ({wishCount(wish.value)})</button
					>
				{/each}
			</div>
			{#if allHouses.length > 1}
				<div class="chips houses" role="group" aria-label="House" data-layout-ignore>
					<button
						type="button"
						class="chip"
						aria-pressed={houseId === ''}
						onclick={() => (houseId = '')}>All houses</button
					>
					{#each allHouses as house (house.houseId)}
						<button
							type="button"
							class="chip"
							aria-pressed={houseId === house.houseId}
							onclick={() => (houseId = houseId === house.houseId ? '' : house.houseId)}
							>{houseKindEntry(house.kind)?.icon ?? '🏠'} {house.name} ({house.free})</button
						>
					{/each}
				</div>
			{/if}
		</div>

		<div class="picker-body">
			{#if spotMode && best.length > 0}
				<section class="best" aria-labelledby="best-title">
					<h3 id="best-title">Best fits</h3>
					<div class="tiles" style="--tile-min: {tileMin(best)}rem">
						{#each best as spot (spot.bedId)}
							{@render tile(spot, true)}
						{/each}
					</div>
				</section>
			{/if}

			{#if groupMode && placing.length > 0 && suggestions.length > 0}
				<section class="best" aria-labelledby="best-title">
					<h3 id="best-title">Rooms for all {placing.length}</h3>
					<div class="suggestions">
						{#each suggestions as option (option.key)}
							{@const needs = needsBadge(option.key)}
							<button
								type="button"
								class="suggestion"
								aria-pressed={place === option.key}
								onclick={() => (place = option.key)}
								>{option.label}{#if needs}<span class="suggestion-needs {needs.tone}"
										>{needs.text}</span
									>{/if}</button
							>
						{/each}
					</div>
				</section>
			{:else if groupMode && placing.length > 0 && fitRooms.size === 0}
				<!-- Counted without the filter, like the card's "No room has …" (defaultPlace null). -->
				<p class="no-room">
					{`No room has ${placing.length} free spots together. Put as many as fit into one room here, then pick the others' spots in the group's card with Change.`}
				</p>
			{:else if groupMode && placing.length > 0}
				<p class="hidden-rooms">
					{`The filter hides the ${plural(fitRooms.size, 'room', 'rooms')} for all ${placing.length} ·`}
					<button type="button" class="link" onclick={clearFilters}>Show all</button>
				</p>
			{/if}

			{#each houses as house (house.houseId)}
				<section class="house" aria-label={house.name}>
					<header class="house-head">
						<h3>
							<span aria-hidden="true">{houseKindEntry(house.kind)?.icon ?? '🏠'}</span>
							{house.name}
						</h3>
						<span class="meta"
							>{house.free} free{house.special > 0 ? ` · ♿ ${house.special}` : ''}</span
						>
					</header>
					<div class="rooms">
						{#each house.rooms as room (room.roomId)}
							{@const roomBadge = groupMode ? fitBadge(`room:${room.roomId}`) : null}
							{@const roomNeeds = groupMode ? needsBadge(`room:${room.roomId}`) : null}
							{@const feats = featureList(room.features)}
							<article class="room" class:chosen={groupMode && place === `room:${room.roomId}`}>
								<header class="room-head">
									<h4>
										<span aria-hidden="true">{roomKindEntry(room.kind)?.icon ?? '🚪'}</span>
										{room.name}
									</h4>
									<span class="meta"
										>{room.free} of {room.size} free{room.special > 0
											? ` · ♿ ${room.special}`
											: ''}</span
									>
									{#if feats.length > 0}
										<ul class="feats" aria-label="What the room offers">
											{#each feats as feature (feature.value)}
												<li title={feature.label}>
													<span aria-hidden="true">{feature.icon}</span><span class="sr-only"
														>{feature.label}</span
													>
												</li>
											{/each}
										</ul>
									{/if}
								</header>
								{#if groupMode && placing.length > 0}
									<div class="room-action">
										{#if roomBadge}<span class="badge {roomBadge.tone}">{roomBadge.text}</span>{/if}
										{#if roomNeeds}<span class="badge {roomNeeds.tone}">{roomNeeds.text}</span>{/if}
										<button
											type="button"
											class="btn small"
											aria-pressed={place === `room:${room.roomId}`}
											onclick={() => (place = `room:${room.roomId}`)}
											>{place === `room:${room.roomId}`
												? '✓ The group goes here'
												: room.free >= placing.length
													? 'Put the group here'
													: `Put ${room.free} of ${placing.length} here`}</button
										>
									</div>
								{/if}
								<div class="tiles" style="--tile-min: {tileMin(room.units.flatMap(unitSpots))}rem">
									{#each room.units as unit (unitSpots(unit)[0].bedId)}
										{#if unit.kind === 'bunk'}
											<div class="bunk" role="group" aria-label="Bunk bed">
												{@render tile(unit.upper, false)}
												{@render tile(unit.lower, false)}
											</div>
										{:else}
											{@render tile(unit.spot, false)}
										{/if}
									{/each}
								</div>
							</article>
						{/each}
					</div>
				</section>
			{:else}
				<p class="empty">
					{#if spots.length === 0}
						No free spot left. Free or add one in the room editor.
					{:else}
						No free spot matches.
						<button type="button" class="link" onclick={clearFilters}>Show all</button>
					{/if}
				</p>
			{/each}
		</div>

		<footer class="picker-foot">
			{#if spotMode}
				<div class="choice" aria-live="polite">
					{#if selectedSpot}
						{@const marks = fitMarks(selectedSpot)}
						<p class="choice-label">
							{selectedSpot.label}{selectedSpot.special ? ' ♿' : ''}{selectedSpot.locked
								? ' 🔒'
								: ''}
						</p>
						<p class="choice-detail">
							{bedText(selectedSpot)}{#each marks as mark (mark.text)}<span
									class="tile-mark"
									class:ok={mark.ok}>{` · ${mark.ok ? '✓' : '✗'} ${mark.text}`}</span
								>{/each}
						</p>
						{#if planned[selectedSpot.bedId]}
							<p class="choice-detail" class:warn-text={!swaps}>
								{swaps
									? `Planned for ${planned[selectedSpot.bedId]}: the two swap.`
									: `Planned for ${planned[selectedSpot.bedId]}, who loses it and goes back to Keep as is.`}
							</p>
						{/if}
						{#if selectedSpot.locked}
							<p class="choice-detail warn-text">🔒 Locked by the crew.</p>
						{/if}
						{#if selectedSpot.special && !access}
							<p class="choice-detail warn-text">
								♿ A special-needs spot, kept for guests who need one.
							</p>
						{/if}
					{:else}
						<p class="choice-detail">Tap a spot to pick it.</p>
					{/if}
				</div>
				<div class="foot-buttons">
					<button type="button" class="btn" onclick={close}>Cancel</button>
					<button type="button" class="btn primary" disabled={!selectedSpot} onclick={take}
						>{spotMode.action}</button
					>
				</div>
			{:else if groupMode}
				<div class="choice" aria-live="polite">
					{#if !place}
						<p class="choice-detail">
							Pick a room for the group. One that fits everyone books in one go.
						</p>
					{:else}
						<p class="choice-label">{optionOf.get(place)?.label ?? ''}</p>
					{/if}
					<ul class="preview" class:hidden={!place}>
						{#each placing as member (member.requestId)}
							{@const bedId = proposal[member.requestId]}
							{@const marks = bedId ? memberMarks(member, bedId) : ''}
							<li class:none={!bedId}>
								<span class="who">{member.name}</span>
								<span class="where"
									>{bedId ? `→ ${previewSpot(bedId)}` : '→ no spot left here'}{marks
										? ` · ${marks}`
										: ''}</span
								>
							</li>
						{/each}
					</ul>
				</div>
				<div class="foot-buttons">
					<button type="button" class="btn" onclick={close}>Cancel</button>
					<button type="button" class="btn" disabled={placed === 0} onclick={() => finish(false)}
						>Edit the plan</button
					>
					<button
						type="button"
						class="btn primary"
						disabled={placed === 0}
						onclick={() => finish(true)}>Book {placed} {plural(placed, 'spot', 'spots')}</button
					>
				</div>
			{/if}
		</footer>
	</div>
</div>

<style>
	.picker-backdrop {
		position: fixed;
		inset: 0;
		/* above the sticky admin bar and its ☰ menu (AdminNav), below the dialogs (DialogHost) */
		z-index: 250;
		background: rgba(0, 0, 0, 0.72);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}
	.picker-sheet {
		width: 100%;
		max-width: 1080px;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: #0d0d0f;
		border: 1px solid #333;
		border-radius: 18px;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
		color: #e5e5e5;
		outline: none;
	}
	@media (max-height: 760px) {
		.picker-backdrop {
			padding: 0.5rem;
		}
	}
	@media (max-width: 700px) {
		.picker-backdrop {
			padding: 0;
		}
		.picker-sheet {
			border: 0;
			border-radius: 0;
		}
	}

	.picker-head {
		flex: none;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem 1.25rem 0.6rem;
		border-bottom: 1px solid #222;
		min-width: 0;
	}
	.head-text {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 900;
		overflow-wrap: anywhere;
	}
	.close {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		border: 1px solid #3f3f46;
		background: transparent;
		color: #e5e5e5;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
	}
	.close:hover {
		background: #27272a;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pills li {
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid #525252;
		color: #e5e5e5;
		overflow-wrap: anywhere;
	}
	/* pink is ♿ alone (state.css) */
	.pills li.access {
		border-color: var(--state-special);
		color: #f9a8d4;
	}
	.now,
	.hint {
		margin: 0;
		font-size: 0.85rem;
		color: #a3a3a3;
		overflow-wrap: anywhere;
	}

	.picker-tools {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.6rem 1.25rem;
		border-bottom: 1px solid #222;
		min-width: 0;
	}
	.search-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.75rem;
		min-width: 0;
	}
	.search {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.search input {
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		padding: 0 0.85rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		min-width: 0;
	}
	/* short of room, each row of chips scrolls sideways instead of filling the sheet */
	@media (max-width: 700px), (max-height: 860px) {
		.chips {
			flex-wrap: nowrap;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: thin;
			scrollbar-color: #3f3f46 transparent;
			padding-bottom: 4px;
		}
		.chip {
			flex: none;
		}
	}
	@media (max-width: 700px) {
		.chips {
			scrollbar-width: none;
		}
		.chips::-webkit-scrollbar {
			display: none;
		}
	}
	.chip {
		min-height: 36px;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		border: 1px solid #3f3f46;
		background: transparent;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
	}
	.chip:hover {
		border-color: #71717a;
	}
	.chip[aria-pressed='true'] {
		background: #2dd4bf;
		border-color: #2dd4bf;
		color: #000;
	}
	.chip.special[aria-pressed='true'] {
		background: var(--state-special);
		border-color: var(--state-special);
	}
	.count {
		flex: 0 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 0.85rem;
		color: #a3a3a3;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: #2dd4bf;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		cursor: pointer;
	}

	.picker-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-color: #3f3f46 transparent;
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.best h3,
	.house-head h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 900;
		overflow-wrap: anywhere;
	}
	.best {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-radius: 14px;
		background: rgba(45, 212, 191, 0.06);
		border: 1px solid rgba(45, 212, 191, 0.3);
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.suggestion {
		flex: 1 1 16rem;
		min-width: 0;
		min-height: 44px;
		padding: 0.4rem 0.8rem;
		border-radius: 10px;
		border: 1px solid #3f3f46;
		background: #111;
		color: #e5e5e5;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		text-align: left;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.suggestion-needs {
		display: block;
		font-size: 0.8rem;
		font-weight: 800;
		color: #fbbf24;
	}
	.suggestion-needs.fits {
		color: var(--state-open);
	}
	.no-room {
		margin: 0;
		padding: 0.75rem;
		border-radius: 14px;
		border: 1px solid rgba(251, 146, 60, 0.4);
		background: rgba(251, 146, 60, 0.08);
		color: #fed7aa;
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.hidden-rooms {
		margin: 0;
		color: #a3a3a3;
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.preview.hidden {
		display: none;
	}
	.suggestion[aria-pressed='true'] {
		border-color: #2dd4bf;
		box-shadow: inset 0 0 0 1px #2dd4bf;
	}

	.house {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}
	.house-head,
	.room-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.75rem;
		min-width: 0;
	}
	.house-head {
		padding-bottom: 0.35rem;
		border-bottom: 1px solid #262626;
	}
	.meta {
		color: #a3a3a3;
		font-size: 0.85rem;
	}
	.rooms {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
		gap: 0.75rem;
	}
	.room {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.75rem;
		border-radius: 14px;
		background: #111;
		border: 1px solid #262626;
	}
	.room.chosen {
		border-color: #2dd4bf;
		box-shadow: inset 0 0 0 1px #2dd4bf;
	}
	.room-head h4 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.feats {
		display: flex;
		gap: 0.2rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.room-action {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.badge {
		font-size: 0.75rem;
		font-weight: 800;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: 1px solid #3f3f46;
		color: #a3a3a3;
		white-space: nowrap;
	}
	.badge.fits {
		border-color: var(--state-open);
		color: var(--state-open);
	}
	.badge.special {
		border-color: var(--state-special);
		color: #f9a8d4;
	}
	.badge.locked {
		border-color: var(--state-locked);
		color: var(--state-locked);
	}
	.badge.warn {
		border-color: var(--state-filling);
		color: #fbbf24;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tile-min, 8.5rem)), 1fr));
		/* a spot on its own keeps its height next to a bunk bed of two */
		align-items: start;
		gap: 0.5rem;
	}
	.bunk {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 3px;
		border-radius: 12px;
		border: 1px dashed #3f3f46;
		min-width: 0;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		min-width: 0;
		min-height: 44px;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #e5e5e5;
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
	}
	button.tile:hover {
		border-color: #71717a;
	}
	.tile.still {
		cursor: default;
	}
	.tile.special {
		border-color: var(--state-special);
		background: var(--state-special-soft);
	}
	.tile.mismatch:not(.picked) {
		opacity: 0.7;
	}
	.tile.picked {
		border-color: #2dd4bf;
		box-shadow: inset 0 0 0 2px #2dd4bf;
		background: rgba(45, 212, 191, 0.12);
	}
	.tile.planned {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.1);
	}
	/* ♿ and 🔒 go under a long name rather than squeeze it */
	.tile-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.3rem;
		max-width: 100%;
	}
	.tile-name {
		font-size: 0.95rem;
		font-weight: 900;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.special-flag {
		color: #f9a8d4;
	}
	.tile-where,
	.tile-bed {
		color: #a3a3a3;
		overflow-wrap: anywhere;
		max-width: 100%;
	}
	.tile-mark {
		color: #fca5a5;
		font-weight: 700;
		overflow-wrap: anywhere;
		max-width: 100%;
	}
	.tile-mark.ok {
		color: #86efac;
	}
	.tile-owner {
		color: #2dd4bf;
		font-weight: 800;
		overflow-wrap: anywhere;
		max-width: 100%;
	}
	.empty {
		margin: 2rem 0;
		text-align: center;
		color: #a3a3a3;
	}

	.picker-foot {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.75rem 1.25rem max(0.75rem, env(safe-area-inset-bottom));
		border-top: 1px solid #222;
		min-width: 0;
	}
	.choice {
		flex: 1 1 18rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.choice-label {
		margin: 0;
		font-weight: 900;
		overflow-wrap: anywhere;
	}
	.choice-detail {
		margin: 0;
		font-size: 0.85rem;
		color: #a3a3a3;
		overflow-wrap: anywhere;
	}
	.warn-text {
		color: #fbbf24;
	}
	/* one member per line on a phone; side by side where there is room */
	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: 0.1rem 1.25rem;
		font-size: 0.85rem;
	}
	.preview li {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.4rem;
		min-width: 0;
	}
	.preview .who {
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.preview .where {
		color: #a3a3a3;
		overflow-wrap: anywhere;
	}
	.preview li.none .where {
		color: #fbbf24;
	}
	.foot-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-left: auto;
	}

	.btn {
		min-height: 44px;
		padding: 0 1.1rem;
		border-radius: 10px;
		border: 1px solid #52525b;
		background: transparent;
		color: #e5e5e5;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.btn.small {
		min-height: 36px;
		padding: 0 0.8rem;
		font-size: 0.85rem;
	}
	.btn.primary {
		background: #2dd4bf;
		border-color: #2dd4bf;
		color: #000;
	}
	.btn[aria-pressed='true'] {
		border-color: #2dd4bf;
		color: #2dd4bf;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
