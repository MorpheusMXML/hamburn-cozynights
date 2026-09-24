<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import AddBedForm from '$lib/components/admin/AddBedForm.svelte';
	import BookingGuest from '$lib/components/admin/BookingGuest.svelte';
	import DetailsPanel from '$lib/components/admin/DetailsPanel.svelte';
	import LayoutLockNotice from '$lib/components/admin/LayoutLockNotice.svelte';
	import SpotDetails from '$lib/components/admin/SpotDetails.svelte';
	import LockGlyph from '$lib/components/LockGlyph.svelte';
	import BunkLadder from '$lib/components/BunkLadder.svelte';
	import { bedTypeEntry, bedTypeMix, featureEntry, readFeatures } from '$lib/accommodation';
	import { LOCK_SPOT_TIP, layoutLock, lockAttrs } from '$lib/layout-lock';
	import {
		bunkOf,
		groupBunks,
		levelOf,
		partnerOf,
		stackCandidates,
		type BunkLevel,
		type SpotUnit
	} from '$lib/bunks';
	import { compareNatural } from '$lib/template';
	import { fade, fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';
	import { bookingsBySpot, guestLabel } from '$lib/bookings';

	export let data: PageData;
	export let form: { message?: string } | null = null;
	// Only admins reach this page (hooks + layout)
	$: ({ room, beds, isLayoutLocked, phase, isSuperuser, booking } = data);
	// Live Booking and Closed: locking 🔒 and ♿ still work, everything else on
	// the spots is locked; those buttons stay and explain themselves.
	$: lock = isLayoutLocked ? layoutLock(phase, isSuperuser) : null;
	$: house = room.expand?.house;
	// Guests the crew checked in at arrival (the booking pass check).
	$: checkedIn = beds.filter((b) => !!b.order && !!b.checked_in_at).length;
	// Who holds each booked spot: name, masked e-mail and ticket, check-in.
	$: bookingOf = bookingsBySpot(data.bookings ?? []);
	$: roomTitle = room.name || `Room ${room.room_number}`;

	type Bed = PageData['beds'][number];

	let deletingBedId: string | null = null;
	let bedTypePattern = 'bunks';

	$: bedMix = bedTypeMix(beds.map((bed) => bed.bed_type));

	const spotName = (bed: Bed) => (bed.label ? `"${bed.label}"` : 'the unnamed spot');
	const plainName = (bed: Bed) => bed.label || 'the unnamed spot';

	// Bunk beds: the grid shows units — a spot on its own, or two stacked into
	// one tile. Natural label order (B1, B2, … B10), the same the server pairs in.
	$: sortedBeds = [...beds].sort((a, b) => compareNatural(a.label ?? '', b.label ?? ''));
	$: units = groupBunks(sortedBeds);
	$: singles = units.filter((unit) => unit.kind === 'single').length;
	// A bunk bed is keyed by its first spot in list order — where groupBunks
	// places the tile — not by its lower one: a SWAP exchanges the levels
	// inside the tile instead of tearing the tile down and building a new one.
	$: position = new Map(sortedBeds.map((bed, index) => [bed.id, index]));
	$: unitKey = (unit: SpotUnit<Bed>) => {
		if (unit.kind === 'single') return unit.spot.id;
		const lowerFirst = (position.get(unit.lower.id) ?? 0) <= (position.get(unit.upper.id) ?? 0);
		return lowerFirst ? unit.lower.id : unit.upper.id;
	};

	// Every animation on this page is gated on the visitor's motion preference.
	let reduceMotion = false;
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});
	const ms = (duration: number) => (reduceMotion ? 0 : duration);
	const wait = (duration: number) => new Promise((r) => setTimeout(r, duration));

	/**
	 * Stacking mode: the crew picked a spot to be the lower bunk (stackingId)
	 * and every other single spot offers itself as the upper one. Escape,
	 * CANCEL ✕ or the STACK button again leave the mode.
	 */
	let stackingId: string | null = null;
	/** The spot that was just put on top: it lifts off before the tile appears. */
	let mergingId: string | null = null;
	/** The lower spot of the tile that was just stacked: its ladder draws itself. */
	let drawnBunkId: string | null = null;
	/** The upper spot of the tile being taken apart: it flies out. */
	let unstackingUpperId: string | null = null;

	$: stackSource = stackingId ? (sortedBeds.find((bed) => bed.id === stackingId) ?? null) : null;
	$: stackTargets = new Set(
		stackingId ? stackCandidates(sortedBeds, stackingId).map((bed) => bed.id) : []
	);
	// The source got stacked or deleted from elsewhere: the mode is over.
	$: if (
		stackingId &&
		(!sortedBeds.some((bed) => bed.id === stackingId) || bunkOf(sortedBeds, stackingId))
	) {
		stackingId = null;
	}

	async function leaveStacking() {
		const id = stackingId;
		stackingId = null;
		// The CANCEL button goes away with the mode; the focus returns to STACK.
		await tick();
		if (id) document.getElementById(`stack-${id}`)?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && stackingId) {
			event.preventDefault();
			leaveStacking();
		}
	}

	/** ▲ PUT ON TOP: the target becomes the upper bunk above the source. */
	function stackOn(target: Bed): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					const source = stackSource;
					stackingId = null;
					// The chosen card lifts off and fades; then the list regroups, the
					// tile takes the lower spot's place and its ladder draws itself.
					mergingId = target.id;
					drawnBunkId = source?.id ?? null;
					await wait(ms(600));
					await update({ reset: false });
					await tick();
					mergingId = null;
					toast(
						`🪜 ${plainName(target)} is now the upper bunk above ${source ? plainName(source) : 'its partner'}.`,
						'success'
					);
					const drawn = drawnBunkId;
					setTimeout(() => {
						if (drawnBunkId === drawn) drawnBunkId = null;
					}, 1500);
					return;
				}
				await explainFailure(result, 'Spots not stacked');
				await update({ reset: false });
			};
	}

	function unstack(lower: Bed, upper: Bed): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					unstackingUpperId = upper.id;
					await update({ reset: false });
					await tick();
					unstackingUpperId = null;
					toast(`⤴ ${plainName(upper)} and ${plainName(lower)} are single spots again.`, 'success');
					return;
				}
				await explainFailure(result, 'Bunk bed not taken apart');
				await update({ reset: false });
			};
	}

	function swapLevels(lower: Bed, upper: Bed): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false });
					toast(
						`⇅ ${plainName(upper)} is now the lower bunk, ${plainName(lower)} the upper one.`,
						'success'
					);
					return;
				}
				await explainFailure(result, 'Levels not swapped');
				await update({ reset: false });
			};
	}

	/** Shows why an action failed; the list is reloaded either way. */
	async function explainFailure(result: ActionResult, title: string) {
		if (result.type !== 'failure' && result.type !== 'error') return;
		const reason =
			result.type === 'failure'
				? (result.data as { message?: string } | undefined)?.message
				: undefined;
		await alertDialog(`${reason || 'The server could not be reached.'} Nothing was changed.`, {
			title,
			tone: 'danger'
		});
	}

	/** Lock, activate and occupancy switches: no question asked, failures are explained. */
	function toggleSpot(title: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await explainFailure(result, title);
				await update({ reset: false });
			};
	}

	function toggleOccupied(bed: Bed): SubmitFunction {
		return async ({ cancel }) => {
			// A spot with a ticket attached is a guest's booking, not a test flag.
			if (bed.occupied && bed.order) {
				const guest = bookingOf[bed.id]?.guest;
				const confirmed = await confirmDialog(
					`Spot ${spotName(bed)} was booked by ${guest ? guestLabel(guest) : 'a guest'}.` +
						(bed.checked_in_at ? ' The guest is checked in, so they are on site.' : '') +
						' Freeing it cancels that booking: the guest loses the spot and has to book again. Their ticket code stays valid.',
					{
						title: "Cancel this guest's booking?",
						tone: 'danger',
						confirmLabel: 'Free the spot',
						cancelLabel: 'Keep booking'
					}
				);
				if (!confirmed) {
					cancel();
					return;
				}
			}
			return async ({ result, update }) => {
				await explainFailure(result, 'Spot not changed');
				await update({ reset: false });
			};
		};
	}

	function deleteSpot(bed: Bed): SubmitFunction {
		return async ({ cancel }) => {
			const partner = partnerOf(sortedBeds, bed.id);
			const confirmed = await confirmDialog(
				`Spot ${spotName(bed)} is removed from this room.` +
					(bed.occupied
						? ' It is currently taken: that booking is deleted too and the guest has to book again.'
						: '') +
					(partner ? ` Its bunk partner ${spotName(partner)} becomes a single spot again.` : '') +
					' This cannot be undone.',
				{
					title: 'Delete this spot?',
					tone: 'danger',
					confirmLabel: 'Delete spot',
					cancelLabel: 'Keep it'
				}
			);
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				if (result.type === 'success') {
					deletingBedId = bed.id;
					await new Promise((r) => setTimeout(r, 550));
					toast(`🗑 Spot ${spotName(bed)} was deleted.`, 'success');
				}
				await explainFailure(result, 'Spot not deleted');
				await update({ reset: false });
				deletingBedId = null;
			};
		};
	}
</script>

<svelte:head>
	<title>{roomTitle}{house ? ` · ${house.name}` : ''} · CozyNights</title>
</svelte:head>

<svelte:window on:keydown={onKeydown} />

{#snippet spotBody(bed: Bed, level: BunkLevel | null)}
	<!-- One spot: the same body for a card of its own and for each level of a bunk bed. -->
	<div class="bed-glow" class:red={bed.occupied} class:gray={bed.enabled === false}></div>
	<div class="bed-icon">
		{#if bed.enabled === false}
			⚪️
		{:else if bed.occupied}
			🔴
		{:else}
			🟢
		{/if}
	</div>
	<div class="bed-info">
		<span class="bed-label">{bed.label || 'Unnamed Spot'}</span>
		<span class="bed-status">
			{#if bed.is_locked}
				LOCKED 🔒
			{:else if bed.enabled === false}
				INACTIVE 🧊
			{:else}
				{bed.occupied ? 'CLAIMED 👥' : 'VACANT ✨'}
			{/if}
		</span>
		{#if bed.is_special}
			<span class="bed-status special">SPECIAL NEEDS ♿</span>
		{/if}
		{#if level}
			<span class="state-chip level-chip" data-state="checked-in">
				{level} bunk{#if level === 'upper'}&nbsp;<span aria-hidden="true">🪜</span>{/if}
			</span>
		{/if}
		<!-- The level chip already says "upper bunk": no need to repeat it here. -->
		{#if (!level && bedTypeEntry(bed.bed_type)) || readFeatures(bed.features, 'spot').length > 0}
			<span class="bed-detail">
				{level ? '' : (bedTypeEntry(bed.bed_type)?.label ?? '')}
				{#each readFeatures(bed.features, 'spot') as feature}
					<span title={featureEntry(feature)?.label}>{featureEntry(feature)?.icon}</span>
				{/each}
			</span>
		{/if}
	</div>

	{#if bookingOf[bed.id]}
		<div class="bed-booking">
			<BookingGuest row={bookingOf[bed.id]} />
		</div>
	{:else if bed.occupied && data.bookings === null}
		<p class="bed-booking-missing">Who booked it could not be read. Reload the page.</p>
	{/if}

	<div class="bed-actions">
		<form action="?/toggleLocked" method="POST" use:enhance={toggleSpot('Lock not changed')}>
			<input type="hidden" name="id" value={bed.id} />
			<input type="hidden" name="is_locked" value={bed.is_locked?.toString()} />
			<button
				class="btn-icon"
				class:orange={bed.is_locked}
				title={bed.is_locked
					? 'Unlock: guests can book this spot again'
					: 'Lock: guests cannot book this spot'}
			>
				<span class="btn-emoji">{bed.is_locked ? '🔓' : '🔒'}</span>
				<span class="btn-text">{bed.is_locked ? 'UNLOCK' : 'LOCK'}</span>
			</button>
		</form>

		<form
			action="?/toggleSpecial"
			method="POST"
			use:enhance={toggleSpot('Special-needs mark not changed')}
		>
			<input type="hidden" name="id" value={bed.id} />
			<input type="hidden" name="is_special" value={String(!!bed.is_special)} />
			<button
				class="btn-icon pink"
				class:active={bed.is_special}
				title={bed.is_special
					? 'Special-needs spot: only the crew assigns it. Click to make it a normal spot again.'
					: 'Special-needs spot: guests cannot book it, the crew assigns it to approved special-needs requests'}
			>
				<span class="btn-emoji">♿</span>
				<span class="btn-text">{bed.is_special ? 'NORMAL' : 'SPECIAL'}</span>
			</button>
		</form>

		<form action="?/toggleEnabled" method="POST" use:enhance={toggleSpot('Spot not changed')}>
			<input type="hidden" name="id" value={bed.id} />
			<input type="hidden" name="enabled" value={bed.enabled !== false} />
			<button
				class="btn-icon"
				class:orange={bed.enabled === false}
				title={bed.enabled === false
					? 'Activate: the spot counts and can be booked'
					: 'Deactivate: the spot is not in use and does not count'}
				{...lockAttrs(lock?.('activate or deactivate spots', LOCK_SPOT_TIP))}
			>
				<span class="btn-emoji">{bed.enabled === false ? '⚡️' : '❄️'}</span>
				<span class="btn-text">{bed.enabled === false ? 'ACTIVATE' : 'DEACTIVATE'}</span>
			</button>
		</form>

		<form action="?/toggleOccupied" method="POST" use:enhance={toggleOccupied(bed)}>
			<input type="hidden" name="id" value={bed.id} />
			<input type="hidden" name="occupied" value={bed.occupied.toString()} />
			<button
				class="btn-icon turquoise"
				title={bed.occupied ? 'Free this spot' : 'Mark this spot as taken without a ticket'}
				disabled={!lock && bed.enabled === false}
				class:disabled={!lock && bed.enabled === false}
				{...lockAttrs(
					bed.occupied ? lock?.('free booked spots') : lock?.('mark spots as taken', LOCK_SPOT_TIP)
				)}
			>
				<span class="btn-emoji">🔄</span>
				<span class="btn-text">{bed.occupied ? 'FREE' : 'TAKEN'}</span>
			</button>
		</form>

		{#if level === null}
			<!-- Only a spot on its own can become the lower bunk of a new bunk bed. -->
			<div class="stack-slot">
				<button
					type="button"
					id="stack-{bed.id}"
					class="btn-icon turquoise"
					class:active={stackingId === bed.id}
					aria-pressed={stackingId === bed.id}
					disabled={stackingId !== bed.id && singles < 2}
					class:disabled={stackingId !== bed.id && singles < 2}
					title={stackingId === bed.id
						? 'Leave stacking: nothing changes'
						: singles < 2
							? 'A bunk bed needs two spots on their own: add another spot first'
							: 'Stack another spot on top of this one: this spot becomes the lower bunk'}
					on:click={() => (stackingId === bed.id ? leaveStacking() : (stackingId = bed.id))}
				>
					<span class="btn-emoji">🪜</span>
					<span class="btn-text">STACK</span>
				</button>
			</div>
		{/if}

		<form action="?/deleteBed" method="POST" use:enhance={deleteSpot(bed)}>
			<input type="hidden" name="id" value={bed.id} />
			<button
				class="btn-icon vanish"
				title="Delete this spot"
				{...lockAttrs(lock?.('delete spots'))}
			>
				<span class="btn-emoji">🗑</span>
				<span class="btn-text">DELETE</span>
			</button>
		</form>
	</div>

	<SpotDetails
		bed={{
			id: bed.id,
			label: bed.label,
			bed_type: bed.bed_type,
			features: bed.features
		}}
		canRename={!isLayoutLocked}
		partnerLabel={partnerOf(sortedBeds, bed.id)?.label ?? ''}
		level={levelOf(bed)}
	/>
{/snippet}

<div class="dashboard-container">
	<div class="header-row" in:fly={{ y: -20, duration: 500 }}>
		<nav class="breadcrumbs" aria-label="Breadcrumb">
			<a href="/admin/camp">Map & houses</a>
			<span class="sep">/</span>
			{#if house}<a href="/admin/house/{house.id}">{house.name}</a> <span class="sep">/</span>{/if}
			<span class="current">Room {room.room_number}</span>
		</nav>

		<h1>
			<span class="room-icon">🛌</span>
			<span class="room-title">{roomTitle}</span>
			<span class="badge turquoise">#{room.room_number}</span>
		</h1>
	</div>

	{#if form?.message}
		<div class="error-banner form-error" role="alert">{form.message}</div>
	{/if}

	<LayoutLockNotice
		locked={isLayoutLocked}
		{phase}
		{isSuperuser}
		next={booking?.next}
		blocks="Spots can't be added, deleted, deactivated or marked taken or free."
		still="Locking 🔒 and unlocking 🔓 spots and marking them ♿ special or normal still work."
	/>

	<div class="content-split">
		<aside class="info-column" in:fly={{ x: -20, duration: 500, delay: 200 }}>
			<div class="status-card turquoise">
				<h3>LOGISTICS 📊</h3>
				<div class="big-number">
					{beds.filter((b) => b.enabled !== false && b.occupied).length}
					<span class="divider">/</span>
					{beds.filter((b) => b.enabled !== false).length}
				</div>
				<p class="label">CLAIMED SPOTS</p>
				{#if checkedIn > 0}
					<p class="checked-in-count">✅ {checkedIn} checked in</p>
				{/if}
				<div class="capacity-info">
					Total Capacity: {beds.length} ({(
						(beds.filter((b) => b.enabled !== false).length / (beds.length || 1)) *
						100
					).toFixed(0)}% ACTIVE)
				</div>
			</div>

			<section class="form-panel orange" class:locked={isLayoutLocked}>
				<header class="panel-header">
					<span class="laser-dot orange"></span>
					<h3>ADD SPOT ➕</h3>
					{#if isLayoutLocked}
						<span class="lock-chip" transition:scale={{ start: 0.6, duration: 250 }}>
							<LockGlyph size={11} /> STAGING ONLY
						</span>
					{/if}
				</header>
				<p class="hint">Define spot label (e.g. "Upper Deck")</p>
				<AddBedForm lock={lock?.('add spots') ?? null} />
			</section>

			<section class="form-panel turquoise">
				<header class="panel-header">
					<span class="laser-dot turquoise"></span>
					<h3>ROOM DETAILS 🏷️</h3>
				</header>
				<p class="hint">
					What this room is like. Guests see it, and the crew matches ♿ requests with it. Can be
					changed in every phase.
				</p>
				<DetailsPanel
					level="room"
					action="?/saveRoom"
					kind={room.kind ?? ''}
					features={readFeatures(room.features, 'room')}
					description={room.description ?? ''}
					name={isLayoutLocked ? undefined : room.name}
					nameHint="Only in Staging Mode: the name belongs to the layout."
				/>
			</section>

			<section class="form-panel pink">
				<header class="panel-header">
					<span class="laser-dot pink"></span>
					<h3>SPOT TYPES 🛏️</h3>
				</header>
				<p class="hint">
					{bedMix || 'No spot of this room says what kind of bed it is yet.'}
				</p>
				<form
					method="POST"
					action="?/setBedTypes"
					class="bulk-form"
					use:enhance={toggleSpot('Spot types not changed')}
				>
					<label class="sr-only" for="bed-type-pattern">Set the bed of every spot</label>
					<select id="bed-type-pattern" name="pattern" bind:value={bedTypePattern}>
						<option value="bunks">Bunk beds: B1 + B2 stacked, B3 + B4, …</option>
						<option value="single">All single beds</option>
						<option value="clear">Not specified</option>
					</select>
					<button class="btn-apply" type="submit">APPLY TO ALL {beds.length} SPOTS</button>
				</form>
				<p class="hint">
					In label order: B1 is the lower bunk, B2 the upper one above it, and the two are stacked
					as one bed.
				</p>
			</section>
		</aside>

		<main class="beds-column" in:fade={{ delay: 400 }}>
			<header class="column-header">
				<span class="laser-dot turquoise"></span>
				<h3 class="column-title">ROOM CAPACITY 🛌</h3>
			</header>

			<div class="beds-grid" class:stacking={stackingId !== null}>
				{#each units as unit (unitKey(unit))}
					<div class="unit" animate:flip={{ duration: ms(450) }} in:fade={{ duration: ms(300) }}>
						{#if unit.kind === 'bunk'}
							{@const fresh = drawnBunkId === unit.lower.id}
							<div
								class="bed-card bunk"
								class:occupied={unit.lower.occupied || unit.upper.occupied}
								class:disabled={isLayoutLocked}
								class:state-ring={fresh}
								class:state-ring-strong={fresh}
								class:splitting={unit.upper.id === unstackingUpperId}
								data-state={fresh ? 'checked-in' : undefined}
								in:fade={{ duration: ms(250) }}
								out:fade={{ duration: ms(300) }}
							>
								{#each [unit.upper, unit.lower] as half, i (half.id)}
									<div
										class="bunk-half"
										class:upper={i === 0}
										class:lower={i === 1}
										class:occupied={half.occupied}
										class:inactive={half.enabled === false}
										class:disintegrating={deletingBedId === half.id}
										animate:flip={{ duration: ms(450) }}
										in:fly|global={{ y: -24, duration: ms(i === 0 ? 350 : 0) }}
										out:fly|global={{
											y: -30,
											duration: ms(half.id === unstackingUpperId ? 350 : 0)
										}}
									>
										{@render spotBody(half, i === 0 ? 'upper' : 'lower')}
									</div>
								{/each}

								<div class="bunk-rungs">
									<BunkLadder draw={fresh} height={40} rungs={4} />
									<span class="rung-label">Bunk bed</span>
									<form
										action="?/swapBunk"
										method="POST"
										use:enhance={swapLevels(unit.lower, unit.upper)}
									>
										<input type="hidden" name="id" value={unit.lower.id} />
										<button
											class="btn-rung"
											title="The two levels change places: {plainName(
												unit.upper
											)} goes down, {plainName(unit.lower)} up"
										>
											<span aria-hidden="true">⇅</span> SWAP
										</button>
									</form>
									<form
										action="?/unstackBunk"
										method="POST"
										use:enhance={unstack(unit.lower, unit.upper)}
									>
										<input type="hidden" name="id" value={unit.lower.id} />
										<button
											class="btn-rung"
											title="Take the bunk bed apart: {plainName(unit.lower)} and {plainName(
												unit.upper
											)} become single spots again"
										>
											UNSTACK <span aria-hidden="true">⤴</span>
										</button>
									</form>
								</div>
							</div>
						{:else}
							{@const bed = unit.spot}
							{@const isSource = stackingId === bed.id}
							{@const isTarget = stackingId !== null && stackTargets.has(bed.id)}
							<div
								class="bed-card"
								class:occupied={bed.occupied}
								class:disabled={isLayoutLocked}
								class:inactive={bed.enabled === false}
								class:disintegrating={deletingBedId === bed.id}
								class:merging={mergingId === bed.id}
								class:stack-source={isSource}
								class:stack-target={isTarget}
								class:state-ring={isSource || isTarget}
								class:state-ring-strong={isSource}
								data-state={isSource ? 'live' : isTarget ? 'staging' : undefined}
								inert={isTarget}
							>
								{@render spotBody(bed, null)}

								{#if isSource}
									<div class="stack-hint" role="status" in:fly={{ y: -6, duration: ms(200) }}>
										<span class="stack-hint-text">Pick the spot that goes on top ▲</span>
										<button type="button" class="btn-cancel" on:click={leaveStacking}>
											CANCEL ✕
										</button>
									</div>
								{/if}
							</div>

							{#if isTarget}
								<!-- Next to the card, not inside it: the covered card is inert, so
								     the keyboard lands on this button and not on a control under the veil. -->
								<form
									class="stack-overlay"
									method="POST"
									action="?/stackBunk"
									use:enhance={stackOn(bed)}
									in:fade={{ duration: ms(200) }}
								>
									<input type="hidden" name="lower" value={stackingId} />
									<input type="hidden" name="upper" value={bed.id} />
									<button
										class="btn-put-on-top"
										title="{plainName(bed)} becomes the upper bunk above {stackSource
											? plainName(stackSource)
											: 'the chosen spot'}"
									>
										<span aria-hidden="true">▲</span> PUT ON TOP
									</button>
								</form>
							{/if}
						{/if}
					</div>
				{/each}

				{#if beds.length === 0}
					<div class="empty-state">
						Desert wasteland. 🏜️ This room has no spots yet, so guests cannot book here. Add spots
						with ADD SPOT ➕.
					</div>
				{/if}
			</div>
		</main>
	</div>
</div>

<style>
	.dashboard-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 0;
	}

	/* Header */
	.header-row {
		margin-bottom: 3rem;
		border-bottom: 1px solid #222;
		padding-bottom: 1.5rem;
	}
	.breadcrumbs {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #666;
		text-transform: uppercase;
		margin-bottom: 1rem;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
	}
	.breadcrumbs a:hover {
		color: #fff;
	}
	.breadcrumbs .current {
		color: #f472b6;
	}
	.sep {
		margin: 0 0.5rem;
		color: #333;
	}

	h1 {
		font-size: clamp(1.6rem, 6vw, 2.5rem);
		line-height: 1.15;
		margin: 0;
		color: #fff;
		font-weight: 900;
		letter-spacing: -1px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.room-title {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.badge {
		font-size: 0.8rem;
		padding: 4px 12px;
		border-radius: 6px;
		font-weight: 900;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.badge.turquoise {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border: 1px solid #2dd4bf;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.85rem;
		margin-bottom: 2rem;
	}

	/* Layout */
	.content-split {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 3rem;
	}
	@media (max-width: 900px) {
		.content-split {
			grid-template-columns: minmax(0, 1fr);
			gap: 2rem;
		}
	}

	/* Info Column */
	.status-card {
		background: #0f0f0f;
		border: 1px solid #222;
		padding: 2rem;
		border-radius: 12px;
		text-align: center;
		margin-bottom: 2rem;
		position: relative;
		overflow: hidden;
	}
	.status-card.turquoise {
		border-top: 2px solid #2dd4bf;
		box-shadow: 0 10px 30px rgba(45, 212, 191, 0.1);
	}
	.status-card h3 {
		margin: 0 0 1rem 0;
		color: #444;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 2px;
	}
	.big-number {
		font-size: 3rem;
		font-weight: 900;
		color: #fff;
		letter-spacing: -2px;
	}
	.big-number .divider {
		color: #222;
		font-size: 1.5rem;
		vertical-align: middle;
	}
	.label {
		margin: 0.5rem 0 0 0;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.checked-in-count {
		margin: 0.35rem 0 0 0;
		color: #2dd4bf;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.capacity-info {
		margin-top: 1rem;
		font-size: 0.65rem;
		color: #888;
		font-weight: 900;
		letter-spacing: 1px;
	}

	.form-panel {
		background: #0f0f0f;
		border: 1px solid #222;
		padding: 2rem;
		border-radius: 12px;
		position: relative;
	}
	.form-panel.orange {
		border-top: 2px solid #fb923c;
	}
	.form-panel.locked .laser-dot.orange {
		background: #555;
		box-shadow: none;
	}
	.lock-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid rgba(251, 146, 60, 0.5);
		background: rgba(251, 146, 60, 0.08);
		color: #fb923c;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1px;
		white-space: nowrap;
		--lock-glyph-hole: #1a120b;
	}
	.panel-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 1rem;
	}
	.panel-header h3 {
		margin: 0;
		color: #eee;
		font-size: 0.85rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.laser-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.laser-dot.orange {
		background: #fb923c;
		box-shadow: 0 0 10px #fb923c;
	}
	.laser-dot.turquoise {
		background: #2dd4bf;
		box-shadow: 0 0 10px #2dd4bf;
	}
	.hint {
		color: #888;
		font-size: 0.75rem;
		margin-bottom: 1.5rem;
		font-weight: bold;
	}

	/* Beds Column */
	.column-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 2rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #222;
	}
	.column-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 900;
		color: #fff;
		letter-spacing: 2px;
	}
	.beds-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: 1.5rem;
	}

	.bed-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
		min-width: 0;
		box-sizing: border-box;
	}
	.bed-card.inactive {
		border-style: dashed;
		background: #0a0a0a;
		border-color: #333;
	}
	.bed-card.occupied {
		border-color: #311;
		background: #150a0a;
	}
	.bed-card:hover:not(.disabled) {
		transform: translateY(-3px);
		border-color: #444;
	}
	.bed-card.occupied:hover:not(.disabled) {
		border-color: #ef4444;
	}

	.bed-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: radial-gradient(circle at center, rgba(45, 212, 191, 0.03), transparent);
		pointer-events: none;
	}
	.bed-glow.red {
		background: radial-gradient(circle at center, rgba(239, 68, 68, 0.03), transparent);
	}
	.bed-glow.gray {
		background: none;
	}

	.bed-icon {
		font-size: 1.25rem;
	}
	.bed-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bed-label {
		font-weight: 900;
		font-size: 1rem;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.bed-status {
		font-size: 0.65rem;
		color: #888;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.bed-detail {
		font-size: 0.72rem;
		color: #9fb3c8;
		overflow-wrap: anywhere;
	}
	.bulk-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.bulk-form select {
		width: 100%;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 0.55rem 0.6rem;
		color: #eee;
		font: inherit;
		font-size: 0.85rem;
	}
	.btn-apply {
		background: rgba(255, 45, 149, 0.15);
		border: 1px solid rgba(255, 45, 149, 0.6);
		color: #ffb3d4;
		border-radius: 8px;
		padding: 0.55rem 0.7rem;
		font-weight: 900;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.btn-apply:hover {
		background: rgba(255, 45, 149, 0.3);
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
	.bed-card:not(.bunk).occupied .bed-status,
	.bunk-half.occupied .bed-status {
		color: #f87171;
	}
	.inactive .bed-label {
		color: #777;
	}

	/* One grid cell: a spot on its own or a bunk bed. The flip slides it when
	   the list regroups; the card inside keeps its own hover lift. */
	.unit {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.unit > .bed-card {
		flex: 1;
	}

	/* Stacking mode: the source breathes pink, the targets turquoise (the
	   state ring from state.css), and bunk beds step back — they are no targets. */
	.stacking .bed-card.bunk {
		opacity: 0.45;
	}
	.stack-hint {
		flex-basis: 100%;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: var(--state-live-soft);
		border: 1px solid rgba(244, 114, 182, 0.4);
		color: #f472b6;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.stack-hint-text {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.btn-cancel {
		background: transparent;
		border: 1px solid #f472b6;
		color: #f472b6;
		border-radius: 6px;
		padding: 0.35rem 0.6rem;
		font: inherit;
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-cancel:hover,
	.btn-cancel:focus-visible {
		background: rgba(244, 114, 182, 0.15);
		color: #fff;
	}
	.stack-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		border-radius: 12px;
		background: rgba(4, 18, 26, 0.72);
		backdrop-filter: blur(2px);
	}
	.btn-put-on-top {
		max-width: 100%;
		background: rgba(45, 212, 191, 0.14);
		border: 2px solid #2dd4bf;
		color: #00ffe0;
		border-radius: 12px;
		padding: 0.9rem 1.2rem;
		font: inherit;
		font-size: 0.95rem;
		font-weight: 900;
		letter-spacing: 2px;
		cursor: pointer;
		box-shadow: 0 0 18px rgba(45, 212, 191, 0.35);
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		overflow-wrap: anywhere;
	}
	.btn-put-on-top:hover,
	.btn-put-on-top:focus-visible {
		transform: translateY(-3px);
		box-shadow: 0 0 28px rgba(45, 212, 191, 0.6);
		background: rgba(45, 212, 191, 0.25);
		color: #fff;
	}
	/* The chosen spot lifts off and fades; then the list regroups under it. */
	.bed-card.merging {
		pointer-events: none;
		transform: translateY(-40px) scale(0.85);
		opacity: 0;
		transition:
			transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1),
			opacity 0.5s ease;
	}

	/* The bunk tile: upper half, the rung strip, lower half, in one column. */
	.bed-card.bunk {
		flex-direction: column;
		flex-wrap: nowrap;
		align-items: stretch;
		gap: 0;
		padding: 0;
		border-color: rgba(45, 212, 191, 0.35);
	}
	.bed-card.bunk.occupied {
		border-color: #311;
		background: #111;
	}
	.bed-card.bunk:hover:not(.disabled) {
		border-color: #2dd4bf;
	}
	.bed-card.bunk.occupied:hover:not(.disabled) {
		border-color: #ef4444;
	}
	.bunk-half {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		padding: 1.5rem;
		min-width: 0;
	}
	.bunk-half.upper {
		order: 1;
	}
	.bunk-rungs {
		order: 2;
	}
	.bunk-half.lower {
		order: 3;
	}
	.bunk-half.occupied {
		background: #150a0a;
	}
	.bunk-half.inactive {
		background: #0a0a0a;
	}
	.bunk-half.inactive .bed-glow {
		background: none;
	}
	/* While the tile splits, it floats over the single cards that take its place. */
	.bed-card.bunk.splitting {
		position: absolute;
		inset: 0 auto auto 0;
		width: 100%;
		z-index: 2;
		pointer-events: none;
	}
	.bunk-rungs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.5rem 1rem;
		min-width: 0;
		border-top: 1px solid rgba(45, 212, 191, 0.35);
		border-bottom: 1px solid rgba(45, 212, 191, 0.35);
		background: rgba(45, 212, 191, 0.05);
	}
	.rung-label {
		/* Its own width, pushed left of the buttons; when the strip is too
		   narrow the buttons wrap under it instead of squeezing it to nothing. */
		flex: 0 1 auto;
		margin-right: auto;
		min-width: 0;
		color: #2dd4bf;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
	}
	.bunk-rungs form {
		display: flex;
		min-width: 0;
	}
	.btn-rung {
		background: rgba(45, 212, 191, 0.08);
		border: 1px solid rgba(45, 212, 191, 0.5);
		color: #2dd4bf;
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
		font: inherit;
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.2s,
			color 0.2s;
	}
	.btn-rung:hover,
	.btn-rung:focus-visible {
		background: rgba(45, 212, 191, 0.22);
		color: #fff;
	}
	.level-chip {
		align-self: flex-start;
		margin-top: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.bed-card,
		.bed-card.merging,
		.btn-put-on-top,
		.btn-rung,
		.btn-icon {
			transition: none;
		}
	}

	/* Own row below the label: the five buttons don't fit next to it in a card of
	   the grid's minimum width, and the card would clip them. In a narrow card
	   they wrap onto a second row instead of cutting their words. */
	/* Who holds the spot: its own row between the label and the buttons. */
	.bed-booking {
		flex-basis: 100%;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bed-booking-missing {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.75rem;
		color: #fb923c;
	}

	.bed-actions {
		display: grid;
		/* Wide enough for the longest label ("DEACTIVATE"), which was cut to "DEACTIV…". */
		grid-template-columns: repeat(auto-fill, minmax(4.75rem, 1fr));
		gap: 0.5rem;
		flex-basis: 100%;
		padding-top: 1rem;
		border-top: 1px solid #222;
	}
	.bed-actions form,
	.stack-slot {
		display: flex;
		min-width: 0;
	}
	/* Icon plus word: on a touch screen there is no tooltip to explain an icon. */
	.btn-icon {
		flex: 1;
		min-width: 0;
		min-height: 48px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		background: #1a1a1a;
		border: 1px solid #333;
		color: #888;
		border-radius: 8px;
		cursor: pointer;
		padding: 6px 2px;
		font-family: inherit;
		transition: all 0.2s;
	}
	.btn-emoji {
		font-size: 1rem;
		line-height: 1.2;
	}
	.btn-text {
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 0.5px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.btn-icon.disabled {
		opacity: 0.3;
		cursor: not-allowed !important;
	}
	.btn-icon:hover:not(.disabled, [data-locked]) {
		color: #fff;
		transform: scale(1.05);
	}
	.btn-icon.turquoise:hover:not(.disabled, [data-locked]) {
		border-color: #2dd4bf;
		color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}
	.btn-icon.turquoise.active {
		border-color: #f472b6;
		color: #f472b6;
		box-shadow: 0 0 10px rgba(244, 114, 182, 0.2);
	}
	.btn-icon.orange:hover:not(.disabled, [data-locked]) {
		border-color: #fb923c;
		color: #fb923c;
		box-shadow: 0 0 10px rgba(251, 146, 60, 0.2);
	}
	.btn-icon.pink:hover:not(.disabled, [data-locked]),
	.btn-icon.pink.active {
		border-color: #f472b6;
		color: #f472b6;
		box-shadow: 0 0 10px rgba(244, 114, 182, 0.2);
	}
	.bed-status.special {
		display: block;
		color: #f472b6;
	}
	.btn-icon.vanish:hover:not(.disabled, [data-locked]) {
		border-color: #f87171;
		color: #f87171;
		background: #211;
		box-shadow: 0 0 10px rgba(248, 113, 113, 0.2);
	}

	.empty-state {
		grid-column: 1/-1;
		text-align: center;
		color: #888;
		padding: 2.5rem 1.5rem;
		background: #0a0a0a;
		border-radius: 16px;
		border: 1px dashed #222;
		font-weight: 700;
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.header-row {
			margin-bottom: 1.5rem;
		}
		.status-card,
		.form-panel {
			padding: 1.25rem 1rem;
		}
		.bed-card {
			padding: 1rem;
		}
		.bed-card.bunk {
			padding: 0;
		}
		.bunk-half {
			padding: 1rem;
		}
	}
</style>
