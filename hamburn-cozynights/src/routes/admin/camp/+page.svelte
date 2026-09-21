<script lang="ts">
	import type { PageData } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import Map, { type LayoutLockedDetail } from '$lib/components/Map.svelte';
	import LockGlyph from '$lib/components/LockGlyph.svelte';
	import HouseEditor, { type HouseSave } from '$lib/components/HouseEditor.svelte';
	import SanityChecks from '$lib/components/admin/SanityChecks.svelte';
	import BookingGuest from '$lib/components/admin/BookingGuest.svelte';
	import { invalidateAll } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { MAP_WIDTH, MAP_HEIGHT, clampToMap, isTooCloseToOtherHouse } from '$lib/map-geometry';
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { createLivePoll } from '$lib/live-stats-poll';
	import { houseState, houseStateLabel } from '$lib/occupancy';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';
	import { actionErrorMessage, submitAction } from '$lib/admin-actions';
	import { formatBerlin } from '$lib/booking-phase';
	import { layoutLock, lockAttrs, showLockHint } from '$lib/layout-lock';
	import { bookingsByRoom, countBookings } from '$lib/bookings';
	import { createBookingsFeed } from '$lib/live-bookings';
	import { relativeTime } from '$lib/time';

	export let data: PageData;

	// The camp editor (docs/admin/camp-layout.md): the map and the list of
	// houses. Only admins reach this page (hooks + layout). Its writes are
	// Control Center actions (/admin?/…), where they lived before the split.
	$: ({ sanityWarnings, isSuperuser, phase, isLayoutLocked } = data);
	// Locked (Live Booking, Closed): the structural controls stay in place,
	// greyed out, and explain themselves when tried ($lib/layout-lock.ts).
	$: lock = isLayoutLocked ? layoutLock(phase, isSuperuser) : null;
	// An armed opening locks the layout at that moment: the editor says when.
	$: locksAt = !isLayoutLocked && data.booking?.next?.to === 'live' ? data.booking.next.at : '';

	// Live booking picture. The page load brings the first set of numbers, the
	// poll keeps them current (see $lib/live-stats-poll.ts: hidden tabs cost
	// nothing, unchanged numbers come back as 304).
	const poll = createLivePoll({ initial: data.stats });
	onMount(() => poll.start());

	// Who is booked where, for the house sidebar. Asked again only when the
	// live numbers moved ($lib/live-bookings.ts).
	const feed = createBookingsFeed({ initial: data.bookings ?? [], changedAt: null });
	$: feed.reset(data.bookings ?? [], null);
	$: feed.follow($poll.stats);
	// The poll hands back the same object while nothing changes (its answer is
	// a 304), and so does the page load. Only swapping `live` when the object
	// really is a different one keeps the map and sixty house cards from
	// re-rendering every five seconds for nothing.
	let live = data.stats;
	$: newest = $poll.stats ?? data.stats;
	$: if (newest !== live) live = newest;
	// A plain record, not a Map: in this file `Map` is the camp map component.
	$: liveByHouse = Object.fromEntries(live.houses.map((house) => [house.id, house]));
	// Spot numbers follow the poll; the layout (which houses exist, where they
	// stand) still comes from the page load.
	$: houses = data.houses.map((house) => {
		const spots = liveByHouse[house.id];
		if (!spots) return house;
		return {
			...house,
			totalBeds: spots.total,
			occupiedBeds: spots.occupied,
			freeBeds: spots.free,
			checkedInBeds: spots.checkedIn,
			occupancyRate: spots.total > 0 ? Math.round((spots.occupied / spots.total) * 100) : 0
		};
	});
	// Another admin added or vanished a house: the numbers know, this page's
	// map doesn't. Offer the reload instead of silently drifting apart.
	$: layoutChanged = live.houses.length !== data.houses.length;
	// Main View state: the map, or the list of houses (`?view=list` from the menu).
	let showMap = page.url.searchParams.get('view') !== 'list';
	let selectedHouseId: string | null = null;
	// Editor Sidebar State
	let editingHouse: { id?: string; x: number; y: number; name: string } | null = null;

	// Compute the currently active house for the sidebar
	$: activeHouse =
		houses.find((h) => h.id === selectedHouseId) || (editingHouse?.id ? null : editingHouse);

	// The bookings of the selected house, room by room (the sidebar), and per
	// house the newest booking (the list cards).
	$: bookingRows = $feed.rows;
	$: houseRooms = selectedHouseId ? bookingsByRoom(bookingRows, selectedHouseId) : [];
	$: houseCounts = countBookings(
		selectedHouseId ? bookingRows.filter((row) => row.houseId === selectedHouseId) : []
	);
	$: newestByHouse = bookingRows.reduce<Record<string, string>>((latest, row) => {
		if (row.bookedAt && row.bookedAt > (latest[row.houseId] ?? '')) {
			latest[row.houseId] = row.bookedAt;
		}
		return latest;
	}, {});

	/** The map refused a drag, an arrow key or a click: say why, right there. */
	function handleLayoutLocked(event: CustomEvent<LayoutLockedDetail>) {
		const { change, anchor } = event.detail;
		const hint = lock?.(change === 'move' ? 'move houses' : 'add houses');
		if (hint) showLockHint(anchor, hint);
	}

	/**
	 * A structural action while the layout is locked. Its buttons never get
	 * here (LockHintHost answers them); this is the net for everything else.
	 */
	function explainLocked(change: string) {
		const focused = document.activeElement;
		showLockHint(
			focused instanceof HTMLElement && focused !== document.body ? focused : null,
			layoutLock(phase, isSuperuser)(change)
		);
	}

	// Below the split breakpoint the sidebar sits under the map, possibly off
	// screen: bring it into view when it opens. Same width as the CSS below.
	async function revealSidebar() {
		await tick();
		if (!window.matchMedia('(max-width: 1400px)').matches) return;
		document
			.querySelector('.details-sidebar')
			?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	// When clicking empty space on the map in editor mode
	function handleLocationSelected(data: { x: number; y: number }) {
		const { x, y } = data;
		selectedHouseId = null; // Deselect existing
		editingHouse = { x, y, name: '' };
		revealSidebar();
	}

	async function handleHouseMoved(event: CustomEvent) {
		if (isLayoutLocked) {
			explainLocked('move houses');
			invalidateAll();
			return;
		}
		const { id, x, y } = event.detail;
		selectedHouseId = id;

		const house = houses.find((h) => h.id === id);
		if (!house) return;

		editingHouse = { id: house.id, x, y, name: house.name };

		const formData = new FormData();
		formData.append('id', id);
		formData.append('x', x.toString());
		formData.append('y', y.toString());

		const result = await submitAction('?/updateHouseCoords', formData);

		if (result.type === 'success') {
			toast(`📍 ${house.name} moved to X ${x} / Y ${y}. Saved.`, 'success', 3000);
			// Reload so the list view and the sidebar show the stored position.
			await invalidateAll();
		} else {
			toast(
				`The new position was not saved: ${actionErrorMessage(result) || 'the server could not be reached.'} The pin is back where it was.`,
				'danger',
				8000
			);
			editingHouse = null;
			selectedHouseId = null;
			await invalidateAll();
		}
	}

	/** Typed coordinates from the sidebar. */
	function handleMoveFromEditor(event: CustomEvent<{ x: number; y: number }>) {
		if (!selectedHouseId) return;
		handleHouseMoved(
			new CustomEvent('houseMoved', { detail: { id: selectedHouseId, ...event.detail } })
		);
	}

	function handleSelectHouse(event: CustomEvent) {
		const house = event.detail;
		selectedHouseId = house.id;
		editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
		revealSidebar();
	}

	// The editor sidebar belongs to the map view. List-view actions that open it
	// switch to the map first, otherwise nothing visible would happen.
	async function showEditorOnMap() {
		if (showMap) return;
		showMap = true;
		await tick();
		document
			.querySelector('.details-sidebar')
			?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function handleRenameHouse(house: any) {
		if (isLayoutLocked) {
			explainLocked('rename houses');
			return;
		}
		selectedHouseId = house.id;
		editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
		showEditorOnMap();
	}

	/** The map centre, or the nearest place around it where no other pin sits. */
	function freeSpotNearCentre() {
		const centre = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
		for (let ring = 0; ring <= 6; ring++) {
			const steps = Math.max(1, ring * 6);
			for (let step = 0; step < steps; step++) {
				const angle = (step / steps) * 2 * Math.PI;
				const point = clampToMap({
					x: centre.x + Math.cos(angle) * ring * 45,
					y: centre.y + Math.sin(angle) * ring * 45
				});
				if (!isTooCloseToOtherHouse(houses, null, point, 40)) return point;
			}
		}
		return centre;
	}

	function handleIgniteFromList() {
		if (isLayoutLocked) {
			explainLocked('add houses');
			return;
		}
		handleLocationSelected(freeSpotNearCentre());
		showEditorOnMap();
	}

	function confirmDeleteHouse(house: { name: string; totalBeds?: number; occupiedBeds?: number }) {
		const booked = house.occupiedBeds || 0;
		return confirmDialog(
			`"${house.name}" is removed from the map together with all its rooms and spots.` +
				(booked > 0
					? ` ${booked} booked ${booked === 1 ? 'spot is' : 'spots are'} released first; those guests have to book again.`
					: '') +
				' Ticket codes stay valid. This cannot be undone.',
			{
				title: 'Delete this house?',
				tone: 'danger',
				confirmLabel: 'Delete house',
				cancelLabel: 'Keep it'
			}
		);
	}

	function showDeleteFailed(result: ActionResult) {
		return alertDialog(
			`${actionErrorMessage(result) || 'The server could not be reached.'} The house was not deleted. Reload the page and try again.`,
			{ title: 'House not deleted', tone: 'danger' }
		);
	}

	async function handleDeleteHouse(house: any) {
		if (isLayoutLocked) {
			explainLocked('delete houses');
			return;
		}
		if (!house || !house.id) return;
		if (!(await confirmDeleteHouse(house))) return;

		const formData = new FormData();
		formData.append('id', house.id);

		const result = await submitAction('?/deleteHouse', formData);

		if (result.type === 'success') {
			toast(`🌪️ "${house.name}" was deleted.`, 'success');
			if (selectedHouseId === house.id) {
				selectedHouseId = null;
				editingHouse = null;
			}
		} else {
			await showDeleteFailed(result);
		}
		invalidateAll();
	}

	async function handleSaveHouse(event: CustomEvent<HouseSave>) {
		if (isLayoutLocked) {
			explainLocked('add or rename houses');
			return;
		}
		const name = (event.detail.name || '').trim();

		if (!name) {
			toast('Enter a name for the house first.', 'warning');
			return;
		}

		const formData = new FormData();
		formData.append('name', name);

		let result: ActionResult;
		if (editingHouse?.id) {
			formData.append('id', editingHouse.id);
			result = await submitAction('?/renameHouse', formData);
		} else {
			formData.append('x', editingHouse?.x.toString() || '0');
			formData.append('y', editingHouse?.y.toString() || '0');
			formData.append('bedCount', String(event.detail.bedCount || 0));
			result = await submitAction('/admin/house/new?/create', formData);
		}

		if (result.type !== 'success') {
			// Keep the sidebar open so the entry can be corrected.
			await alertDialog(
				`${actionErrorMessage(result) || 'The server could not be reached.'} Nothing was saved. Check your entry and try again.`,
				{ title: editingHouse?.id ? 'House not renamed' : 'House not created', tone: 'danger' }
			);
			invalidateAll();
			return;
		}

		toast(editingHouse?.id ? `✏️ Renamed to "${name}".` : `🛖 "${name}" was created.`, 'success');
		editingHouse = null;
		selectedHouseId = null;
		invalidateAll();
	}

	async function handleDeleteActiveHouse() {
		if (isLayoutLocked) {
			explainLocked('delete houses');
			return;
		}
		const house = houses.find((h) => h.id === selectedHouseId);
		if (!house) return;
		if (!(await confirmDeleteHouse(house))) return;

		const sidebar = document.querySelector('.details-sidebar');
		if (sidebar) sidebar.classList.add('disintegrating');

		const formData = new FormData();
		formData.append('id', house.id);

		await new Promise((resolve) => setTimeout(resolve, 500));

		const result = await submitAction('?/deleteHouse', formData);

		if (result.type !== 'success') {
			if (sidebar) sidebar.classList.remove('disintegrating');
			await showDeleteFailed(result);
			invalidateAll();
		} else {
			toast(`🌪️ "${house.name}" was deleted.`, 'success');
			selectedHouseId = null;
			editingHouse = null;
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>Map & houses · CozyNights</title>
</svelte:head>

<div class="dashboard-wrapper">
	<header class="page-header">
		<div class="header-left">
			<h1>Map & houses 🗺️</h1>
			<p class="subtitle">Where everything stands on the playa 🏜️</p>
		</div>

		<div class="header-right">
			<div class="view-switch" role="group" aria-label="Show the camp as">
				<button type="button" aria-pressed={showMap} on:click={() => (showMap = true)}
					>🗺️ MAP</button
				>
				<button type="button" aria-pressed={!showMap} on:click={() => (showMap = false)}
					>🛰️ LIST</button
				>
			</div>
			<a class="btn-secondary" href="/admin/templates">TEMPLATES 💾</a>
			<a class="btn-secondary" href="/admin/bookings">BOOKINGS 🛏️</a>
		</div>
	</header>

	{#if layoutChanged}
		<p class="layout-changed" role="status">
			🛖 The camp layout changed while this page was open.
			<button class="btn-inline" on:click={() => invalidateAll()}>Reload the page</button>
			to see the houses themselves.
		</p>
	{/if}

	<SanityChecks warnings={sanityWarnings} />

	<main class="view-container">
		{#if showMap}
			<div class="map-view" in:fade={{ duration: 300 }}>
				<div class="map-status-bar state-ring" data-state={phase}>
					<LockGlyph locked={isLayoutLocked} size={15} />
					{#key isLayoutLocked}
						<span class="status-msg" in:fade={{ duration: 260 }}>
							{#if isLayoutLocked}
								LOCKED: {phase === 'closed' ? 'Booking is closed' : 'Live Booking is active'}.
								{#if isSuperuser}
									Switch back to 🛠 STAGING MODE in 🎟 BOOKING WINDOW on the
									<a href="/admin">Control Center</a> to add, move or delete houses.
								{:else}
									Only a superuser can switch back to 🛠 STAGING MODE to add, move or delete houses.
								{/if}
							{:else}
								🛠 EDITOR ACTIVE: Drag houses to reposition. Click house or space to manage.
								{#if locksAt}The layout locks {formatBerlin(locksAt)}, when Live Booking starts.{/if}
							{/if}
						</span>
					{/key}
				</div>
				<div class="map-layout-split">
					<div class="map-frame">
						<Map
							{houses}
							isEditorMode={true}
							layoutLocked={isLayoutLocked}
							on:locationSelected={(e) => handleLocationSelected(e.detail)}
							on:houseMoved={handleHouseMoved}
							on:layoutLocked={handleLayoutLocked}
							on:renameHouse={handleSelectHouse}
							on:deleteHouse={(e) => handleDeleteHouse(e.detail)}
						/>
					</div>

					{#if activeHouse}
						<aside class="details-sidebar" in:fly={{ x: 100, duration: 400 }}>
							<div class="sidebar-header">
								<span class="laser-dot turquoise"></span>
								<h3>{selectedHouseId ? 'HOUSE INTEL' : 'NEW DEPLOYMENT'}</h3>
								<button
									class="btn-close-sidebar"
									aria-label="Close sidebar"
									on:click={() => {
										selectedHouseId = null;
										editingHouse = null;
									}}>&times;</button
								>
							</div>

							<div class="sidebar-content">
								<HouseEditor
									x={activeHouse.x}
									y={activeHouse.y}
									name={activeHouse.name}
									houseId={selectedHouseId || undefined}
									flat={true}
									{lock}
									on:save={handleSaveHouse}
									on:move={handleMoveFromEditor}
									on:cancel={() => {
										selectedHouseId = null;
										editingHouse = null;
									}}
								/>

								{#if selectedHouseId}
									<section class="house-bookings" aria-labelledby="house-bookings-title">
										<header class="house-bookings-head">
											<h4 id="house-bookings-title">WHO IS HERE 🛏️</h4>
											<span class="house-bookings-count">
												{houseCounts.booked} booked · {houseCounts.checkedIn} checked in{houseCounts.crew
													? ` · ${houseCounts.crew} crew`
													: ''}
											</span>
										</header>
										{#if data.bookings === null}
											<p class="house-bookings-empty">
												The bookings could not be read. Reload the page to try again.
											</p>
										{:else if houseRooms.length === 0}
											<p class="house-bookings-empty">
												Nobody has booked a spot in this house yet.
											</p>
										{:else}
											{#each houseRooms as group (group.roomId)}
												<div class="house-bookings-room">
													<a class="house-bookings-room-link" href="/admin/room/{group.roomId}"
														>{group.room}</a
													>
													<ul>
														{#each group.rows as row (row.bedId)}
															<li>
																<span class="spot-label">{row.spot || 'Spot'}</span>
																<BookingGuest {row} compact />
															</li>
														{/each}
													</ul>
												</div>
											{/each}
										{/if}
										<a class="house-bookings-all" href="/admin/bookings?house={selectedHouseId}"
											>All bookings of this house →</a
										>
									</section>

									<div class="danger-zone" in:fade>
										<span class="zone-label">CRITICAL ACTIONS</span>
										<a href="/admin/house/{selectedHouseId}" class="btn-manage-link"
											>MANAGE ROOMS ⚙️</a
										>
										<button
											class="btn-vanish-big"
											on:click={handleDeleteActiveHouse}
											{...lockAttrs(lock?.('delete houses'))}
										>
											VANISH FROM PLAYA 🌪️
										</button>
									</div>
								{/if}
							</div>
						</aside>
					{/if}
				</div>
			</div>
		{:else}
			<div class="grid-view" in:fade={{ duration: 300 }}>
				{#each houses as house}
					<div class="house-card-wrapper">
						<a
							href="/admin/house/{house.id}"
							class="house-card state-ring"
							data-state={houseState(house)}
						>
							<div class="card-glow"></div>
							<header class="card-header">
								<h2>{house.name} 🛖</h2>
								<span class="state-chip">
									{houseStateLabel(houseState(house), house.freeBeds)}
								</span>
							</header>

							<div class="card-body">
								<div class="stat-group">
									<span class="stat-label">Spots Claimed 👥</span>
									<span class="stat-value">{house.occupiedBeds} / {house.totalBeds}</span>
								</div>
								{#if house.checkedInBeds > 0}
									<div class="stat-group">
										<span class="stat-label">Checked In ✅</span>
										<span class="stat-value">{house.checkedInBeds} / {house.occupiedBeds}</span>
									</div>
								{/if}

								<div class="progress-bar">
									<div
										class="progress-fill"
										style="width: {house.occupancyRate}%;"
										class:full={house.occupancyRate === 100}
									></div>
								</div>

								{#if newestByHouse[house.id]}
									<div class="stat-group">
										<span class="stat-label">Latest Booking 🎟</span>
										<span class="stat-value small">{relativeTime(newestByHouse[house.id])}</span>
									</div>
								{/if}

								<footer class="card-footer">
									<span>📍 X: {house.x} / Y: {house.y}</span>
								</footer>
							</div>
						</a>

						<div class="card-admin-actions">
							{#if house.occupiedBeds > 0}
								<a class="btn-action-small bookings" href="/admin/bookings?house={house.id}"
									>BOOKINGS 🛏️</a
								>
							{/if}
							<button
								class="btn-action-small"
								on:click={() => handleRenameHouse(house)}
								{...lockAttrs(lock?.('rename houses'))}>RENAME ✏️</button
							>
							<button
								class="btn-action-small vanish"
								on:click={() => handleDeleteHouse(house)}
								{...lockAttrs(lock?.('delete houses'))}>VANISH 🌪️</button
							>
						</div>
					</div>
				{/each}

				<button
					class="add-house-card"
					on:click={handleIgniteFromList}
					{...lockAttrs(lock?.('add houses'))}
				>
					{#if lock}
						<span class="plus lock"><LockGlyph size={34} /></span>
						<span>Ignite New House</span>
						<small>Staging Mode only</small>
					{:else}
						<span class="plus">+</span>
						<span>Ignite New House</span>
						<small>Starts in the middle of the map</small>
					{/if}
				</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.dashboard-wrapper {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 2rem;
		background: #050505;
		min-height: 100vh;
		min-height: 100dvh;
		color: #fff;
	}

	.page-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 1rem 2rem;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 1.5rem;
	}

	.header-left h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: -1px;
	}
	.subtitle {
		margin: 0.25rem 0 0 0;
		color: #666;
		font-size: 0.85rem;
		font-weight: bold;
	}

	.header-right {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.header-right button,
	.header-right a {
		min-height: 44px;
		white-space: nowrap;
	}

	.layout-changed {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 700;
		color: #fb923c;
		line-height: 1.5;
	}
	.btn-inline {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: #2dd4bf;
		text-decoration: underline;
		cursor: pointer;
	}

	.laser-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.laser-dot.turquoise {
		background: #2dd4bf;
		box-shadow: 0 0 10px #2dd4bf;
	}

	.map-view {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.map-status-bar a {
		color: inherit;
	}
	.map-status-bar {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem 1.5rem;
		background: var(--state-soft);
		border: 1px solid transparent;
		border-radius: 12px;
		font-size: 0.7rem;
		font-weight: 900;
		color: var(--state);
		letter-spacing: 1px;
		line-height: 1.5;
	}

	.map-layout-split {
		display: flex;
		align-items: flex-start;
		gap: 2rem;
	}
	.map-frame {
		flex: 1;
		min-width: 0;
		/* MAP_WIDTH / MAP_HEIGHT */
		aspect-ratio: 1000 / 700;
		background: #0a0a0a;
		border: 2px solid #222;
		border-radius: 16px;
		overflow: hidden;
		position: relative;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	}

	.details-sidebar {
		width: 400px;
		flex-shrink: 0;
		box-sizing: border-box;
		background: #0a0a0a;
		border: 1px solid #222;
		border-top: 2px solid #f472b6;
		border-radius: 16px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
		animation: sidebarSlide 0.4s cubic-bezier(0.4, 0, 0.2, 1);
	}

	/* Narrow screens: the sidebar goes below the map. revealSidebar() uses the
	   same breakpoint; from 1100 px the admin menu takes room next to the page. */
	@media (max-width: 1400px) {
		.map-layout-split {
			flex-direction: column;
			align-items: stretch;
			gap: 1rem;
		}
		.map-frame {
			flex: none;
			width: 100%;
			box-sizing: border-box;
		}
		.details-sidebar {
			width: 100%;
			scroll-margin-top: 6rem;
		}
	}

	@keyframes sidebarSlide {
		from {
			transform: translateX(50px);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid #222;
		padding-bottom: 1rem;
	}
	.sidebar-header h3 {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #fff;
		flex: 1;
	}
	.btn-close-sidebar {
		background: none;
		border: none;
		color: #888;
		font-size: 1.5rem;
		cursor: pointer;
		line-height: 1;
		min-width: 44px;
		min-height: 44px;
		margin: -0.5rem -0.75rem -0.5rem 0;
	}
	.btn-close-sidebar:hover {
		color: #fff;
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.danger-zone {
		margin-top: 1rem;
		padding-top: 2rem;
		border-top: 1px solid #222;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.zone-label {
		font-size: 0.6rem;
		font-weight: 900;
		color: #ef4444;
		letter-spacing: 2px;
	}

	.btn-manage-link {
		background: #1a1a1a;
		border: 1px solid #333;
		color: #2dd4bf;
		padding: 0.75rem;
		border-radius: 8px;
		font-weight: 900;
		text-decoration: none;
		text-align: center;
		font-size: 0.8rem;
		letter-spacing: 1px;
		transition: all 0.2s;
		min-height: 44px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.btn-manage-link:hover {
		background: #222;
		border-color: #2dd4bf;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.2);
	}

	.btn-vanish-big {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid #ef4444;
		color: #f87171;
		padding: 1rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		letter-spacing: 1px;
	}
	.btn-vanish-big:hover:not([data-locked]) {
		background: #ef4444;
		color: #fff;
		box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
	}

	.grid-view {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
		gap: 2rem;
	}

	.house-card-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.card-admin-actions {
		display: flex;
		gap: 0.5rem;
		padding: 0 0.5rem;
	}

	.btn-action-small {
		flex: 1;
		min-height: 44px;
		background: #1a1a1a;
		border: 1px solid #333;
		color: #888;
		padding: 0.5rem;
		border-radius: 6px;
		font-size: 0.65rem;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-action-small:hover:not([data-locked]) {
		background: #222;
		border-color: #2dd4bf;
		color: #fff;
	}
	.btn-action-small.vanish:hover:not([data-locked]) {
		border-color: #ef4444;
		color: #f87171;
	}

	.house-card {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 1.5rem;
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}
	.house-card:hover {
		transform: translateY(-5px);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
	}

	.card-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: radial-gradient(circle at top right, rgba(45, 212, 191, 0.05), transparent);
		pointer-events: none;
	}

	.card-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem 1rem;
	}
	.card-header h2 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 900;
		color: #fff;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.stat-group {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.stat-label {
		font-size: 0.7rem;
		color: #444;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.stat-value {
		font-size: 0.9rem;
		color: #fff;
		font-weight: bold;
	}

	.progress-bar {
		height: 4px;
		background: #111;
		border-radius: 2px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: #2dd4bf;
		transition: width 1s ease-out;
	}
	.progress-fill.full {
		background: #ef4444;
	}

	.card-footer {
		font-size: 0.6rem;
		color: #333;
		font-weight: 900;
		letter-spacing: 1px;
		margin-top: 0.5rem;
	}

	.add-house-card {
		background: transparent;
		border: 2px dashed #222;
		border-radius: 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		cursor: pointer;
		color: #444;
		transition: all 0.3s;
		min-height: 200px;
		font-family: inherit;
	}
	.add-house-card:hover:not([data-locked]) {
		border-color: #2dd4bf;
		color: #2dd4bf;
		background: rgba(45, 212, 191, 0.05);
	}
	.add-house-card .plus {
		font-size: 3rem;
		font-weight: 100;
	}
	/* Already a quiet card: locked, it only loses its colour, not its words. */
	.add-house-card[data-locked] {
		opacity: 0.85;
		color: #5a5a5a;
	}
	.add-house-card .plus.lock {
		display: flex;
		height: 4.5rem;
		align-items: center;
		--lock-glyph-hole: #050505;
	}
	.add-house-card span {
		font-weight: 900;
		font-size: 0.8rem;
		letter-spacing: 2px;
	}
	.add-house-card small {
		font-size: 0.6rem;
		opacity: 0.5;
	}

	:global(.house-card-wrapper.disintegrating),
	:global(.details-sidebar.disintegrating) {
		animation: disintegrate 0.6s forwards;
		pointer-events: none;
	}

	@keyframes disintegrate {
		0% {
			opacity: 1;
			transform: scale(1);
			filter: blur(0);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.1);
			filter: blur(5px);
		}
		100% {
			opacity: 0;
			transform: scale(0.8);
			filter: blur(20px);
		}
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid #333;
		color: #888;
		padding: 0.8rem 1.5rem;
		border-radius: 12px;
		font-weight: 900;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
		letter-spacing: 1px;
	}
	.view-switch {
		display: inline-flex;
		border: 1px solid #222;
		border-radius: 10px;
		overflow: hidden;
	}
	.view-switch button {
		min-height: 44px;
		padding: 0 1rem;
		border: none;
		background: #111;
		color: #888;
		font-weight: 900;
		font-size: 0.75rem;
		letter-spacing: 1px;
		cursor: pointer;
	}
	.view-switch button + button {
		border-left: 1px solid #222;
	}
	.view-switch button[aria-pressed='true'] {
		background: #2dd4bf;
		color: #000;
	}
	a.btn-secondary {
		display: inline-flex;
		align-items: center;
		box-sizing: border-box;
		text-decoration: none;
	}

	.house-bookings {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 1.25rem;
		border-top: 1px solid #222;
	}
	.house-bookings-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
	}
	.house-bookings-head h4 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #fff;
	}
	.house-bookings-count {
		font-size: 0.7rem;
		font-weight: 700;
		color: #888;
	}
	.house-bookings-empty {
		margin: 0;
		font-size: 0.8rem;
		color: #777;
	}
	.house-bookings-room {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.house-bookings-room-link {
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #2dd4bf;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.house-bookings-room-link:hover {
		text-decoration: underline;
	}
	.house-bookings-room ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.house-bookings-room li {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.spot-label {
		font-size: 0.72rem;
		font-weight: 800;
		color: #bbb;
		overflow-wrap: anywhere;
	}
	.house-bookings-all {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-size: 0.8rem;
		font-weight: 800;
		color: #2dd4bf;
		text-decoration: none;
	}
	.stat-value.small {
		font-size: 0.75rem;
		color: #bbb;
	}
	a.btn-action-small {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		text-decoration: none;
		text-align: center;
	}
	.btn-action-small.bookings {
		color: #2dd4bf;
	}
	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		border-color: #666;
	}

	@media (max-width: 640px) {
		.dashboard-wrapper {
			gap: 1.25rem;
			padding: 1rem 0.75rem;
		}
		.header-left h1 {
			font-size: 1.6rem;
		}
		/* Two buttons per row, each as wide as its cell */
		.header-right {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;
			width: 100%;
		}
		.header-right > * {
			min-width: 0;
		}
		.header-right button,
		.header-right a {
			width: 100%;
			justify-content: center;
			padding-left: 0.5rem;
			padding-right: 0.5rem;
			font-size: 0.7rem;
			letter-spacing: 0.5px;
			white-space: normal;
		}
		.map-status-bar {
			padding: 0.75rem 1rem;
		}
		.details-sidebar {
			padding: 1rem;
		}
		.grid-view {
			gap: 1.25rem;
		}
	}
</style>
