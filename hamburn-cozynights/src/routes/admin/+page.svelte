<script lang="ts">
	import type { PageData } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import Map from '$lib/components/Map.svelte';
	import HouseEditor from '$lib/components/HouseEditor.svelte';
	import IntelDashboard from '$lib/components/admin/IntelDashboard.svelte';
	import SanityChecks from '$lib/components/admin/SanityChecks.svelte';
	import TemplateManager from '$lib/components/admin/TemplateManager.svelte';
	import BookingWindowPanel from '$lib/components/admin/BookingWindowPanel.svelte';
	import { invalidateAll } from '$app/navigation';
	import { fade, fly, slide } from 'svelte/transition';
	import { MAP_WIDTH, MAP_HEIGHT, clampToMap, isTooCloseToOtherHouse } from '$lib/map-geometry';
	import { onMount, tick } from 'svelte';
	import { createLivePoll } from '$lib/live-stats-poll';
	import { houseState, houseStateLabel } from '$lib/occupancy';
	import { relativeTime } from '$lib/time';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';
	import { actionErrorMessage, submitAction } from '$lib/admin-actions';
	import { lockedDuring } from '$lib/booking-phase';

	export let data: PageData;

	// Only admins reach this page (hooks + layout); superusers additionally get
	// the destructive tools (clear all bookings, template import).
	$: ({ crewBookedSpots, sanityWarnings, isSuperuser, phase, isLayoutLocked, bookingWindow } =
		data);

	// Live booking picture. The page load brings the first set of numbers, the
	// poll keeps them current (see $lib/live-stats-poll.ts: hidden tabs cost
	// nothing, unchanged numbers come back as 304).
	const poll = createLivePoll({ initial: data.stats });
	onMount(() => poll.start());
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
	$: liveLabel =
		$poll.status === 'live'
			? `Live · last change ${relativeTime(live.changedAt)}`
			: $poll.signedOut
				? 'Signed out — sign in again for live numbers'
				: $poll.status === 'offline'
					? 'No connection — numbers may be out of date'
					: $poll.status === 'stale'
						? 'Catching up…'
						: 'Starting…';
	// Special-needs requests (/admin/requests): own switch, independent of the phase.
	$: ({ requestsOpen, openRequests } = data);
	let requestsSaving = false;

	const handleToggleRequests: SubmitFunction = () => {
		requestsSaving = true;
		return async ({ result, update }) => {
			requestsSaving = false;
			if (result.type === 'success') {
				const open = (result.data as { requestsOpen?: boolean } | undefined)?.requestsOpen;
				toast(
					open
						? '♿ Special-needs requests are open: guests see a link on the map.'
						: '♿ Special-needs requests are closed.',
					'success'
				);
			} else {
				await alertDialog(
					`${actionErrorMessage(result) || 'The server could not be reached.'} Requests were not opened or closed. Reload the page and try again.`,
					{ title: 'Switch not changed', tone: 'danger' }
				);
			}
			await update();
		};
	};

	// Management Summary Calculations
	$: totalBeds = houses.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
	$: occupiedBeds = houses.reduce((sum, h) => sum + (h.occupiedBeds || 0), 0);
	$: checkedInBeds = houses.reduce((sum, h) => sum + (h.checkedInBeds || 0), 0);

	// "Full" means nothing left to book, like the cards' "Fully booked" badge.
	$: houseStats = {
		empty: houses.filter((h) => h.occupiedBeds === 0 && h.freeBeds > 0).length,
		partial: houses.filter((h) => h.occupiedBeds > 0 && h.freeBeds > 0).length,
		full: houses.filter((h) => h.totalBeds > 0 && h.freeBeds === 0).length,
		unconfigured: houses.filter((h) => h.totalBeds === 0).length
	};

	// Main View state
	let showMap = true;
	let showGuide = false;
	let selectedHouseId: string | null = null;
	// Editor Sidebar State
	let editingHouse: { id?: string; x: number; y: number; name: string } | null = null;

	// Compute the currently active house for the sidebar
	$: activeHouse =
		houses.find((h) => h.id === selectedHouseId) || (editingHouse?.id ? null : editingHouse);

	let lastLockedToast = 0;

	function handleLayoutLocked() {
		// One hint per gesture is enough.
		if (Date.now() - lastLockedToast < 2500) return;
		lastLockedToast = Date.now();
		toast(
			`🔒 The layout is locked ${lockedDuring(phase)}. Only a superuser can switch back to Staging Mode to add or move houses.`,
			'warning'
		);
	}

	/** Explains why a structural action is refused while booking is live or closed. */
	function explainLocked(action: string) {
		return alertDialog(
			`The camp layout is locked ${lockedDuring(phase)}: it holds the guests' bookings. A superuser can switch back to Staging Mode in the 🎟 BOOKING WINDOW panel to ${action}.`,
			{ title: `🔒 Locked ${lockedDuring(phase)}`, tone: 'warning' }
		);
	}

	// Below the split breakpoint the sidebar sits under the map, possibly off
	// screen: bring it into view when it opens.
	async function revealSidebar() {
		await tick();
		if (!window.matchMedia('(max-width: 1100px)').matches) return;
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
			handleLayoutLocked();
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

	async function handleSaveHouse(event: CustomEvent) {
		if (isLayoutLocked) {
			explainLocked('add or rename houses');
			return;
		}
		const newHouseData = event.detail;
		const name = (newHouseData.name || '').trim();

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
			formData.append('bedCount', newHouseData.totalBeds?.toString() || '0');
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
	let showTemplates = false;
</script>

<svelte:head>
	<title>Control Center · CozyNights</title>
</svelte:head>

<div class="dashboard-wrapper">
	<header class="page-header">
		<div class="header-left">
			<h1>Control Center 🔥</h1>
			<p class="subtitle">Orchestrating the chaos of the playa 🏜️</p>
		</div>

		<div class="header-right">
			<a class="btn-docs" href="/admin/docs/" target="_blank" rel="noopener">ADMIN GUIDE 📖</a>

			<button class="btn-secondary" on:click={() => (showTemplates = !showTemplates)}>
				{showTemplates ? 'CLOSE TOOLS 🛠' : 'TEMPLATES 💾'}
			</button>

			<button class="btn-guide" on:click={() => (showGuide = !showGuide)} class:active={showGuide}>
				{showGuide ? 'CLOSE INTEL 📡' : 'SHOW INTEL 📊'}
			</button>

			<button class="btn-toggle" on:click={() => (showMap = !showMap)}>
				{showMap ? '🛰️ LIST VIEW' : '🗺️ MAP VIEW'}
			</button>
		</div>
	</header>

	<BookingWindowPanel
		{phase}
		{bookingWindow}
		{isSuperuser}
		{occupiedBeds}
		{crewBookedSpots}
		{checkedInBeds}
	/>

	<section class="requests-panel" class:open={requestsOpen}>
		<span class="requests-icon" aria-hidden="true">♿</span>
		<span class="requests-text">
			Special-needs requests: <strong>{requestsOpen ? 'OPEN' : 'CLOSED'}</strong>
			{#if openRequests}· {openRequests} waiting for a decision{/if}
		</span>
		<form method="POST" action="/admin/requests?/toggleRequests" use:enhance={handleToggleRequests}>
			<input type="hidden" name="open" value={String(!requestsOpen)} />
			<button type="submit" class="btn-requests" disabled={requestsSaving}>
				{requestsOpen ? 'Close requests' : 'Open requests'}
			</button>
		</form>
		<a class="requests-review" href="/admin/requests">Review requests →</a>
	</section>

	{#if showTemplates}
		<TemplateManager {isSuperuser} on:close={() => (showTemplates = false)} />
	{/if}

	{#if showGuide}
		<section class="intel-panel" transition:slide>
			<div class="intel-container">
				<div class="dashboard-section">
					<div class="section-header">
						<span class="laser-dot pink"></span>
						<h3>LIVE OPERATIONS INTEL</h3>
						<span class="live-chip" data-status={$poll.status} title={liveLabel}>
							<span class="live-dot"></span>
							<span class="live-text">{liveLabel}</span>
						</span>
						<button
							class="btn-refresh"
							on:click={() => poll.refresh()}
							title="Fetch the numbers again now"
							aria-label="Refresh the numbers now">↻</button
						>
					</div>

					{#if layoutChanged}
						<p class="layout-changed" role="status">
							🛖 The camp layout changed while this page was open.
							<button class="btn-inline" on:click={() => invalidateAll()}>Reload the page</button>
							to see the houses themselves.
						</p>
					{/if}

					<IntelDashboard stats={live} />
				</div>

				<div class="dashboard-section">
					<div class="section-header">
						<span class="laser-dot turquoise"></span>
						<h3>PLAYA PROTOCOLS</h3>
					</div>
					<div class="intel-grid">
						<div class="intel-card turquoise">
							<span class="icon">📍</span>
							<p>Click map to ignite house. (STAGING ONLY)</p>
						</div>
						<div class="intel-card pink">
							<span class="icon">🖱️</span>
							<p>Drag to reposition. (STAGING ONLY)</p>
						</div>
						<div class="intel-card orange">
							<span class="icon">⚙️</span>
							<p>Click house for House Intel sidebar.</p>
						</div>
						<div class="intel-card green">
							<span class="icon">🎟</span>
							<p>Plan the booking window, arm the timer: it opens & closes by itself.</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<SanityChecks warnings={sanityWarnings} />

	<main class="view-container">
		{#if showMap}
			<div class="map-view" in:fade={{ duration: 300 }}>
				<div class="map-status-bar state-ring" data-state={phase}>
					{#if isLayoutLocked}
						<span class="status-msg"
							>🔒 LOCKED: {phase === 'closed' ? 'Booking is closed' : 'Live Booking is active'}.
							Only a superuser can switch back to 🛠 STAGING MODE to add, move or delete houses.</span
						>
					{:else}
						<span class="status-msg"
							>🛠 EDITOR ACTIVE: Drag houses to reposition. Click house or space to manage.</span
						>
					{/if}
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
									on:save={handleSaveHouse}
									on:move={handleMoveFromEditor}
									on:cancel={() => {
										selectedHouseId = null;
										editingHouse = null;
									}}
								/>

								{#if selectedHouseId}
									<div class="danger-zone" in:fade>
										<span class="zone-label">CRITICAL ACTIONS</span>
										<a href="/admin/house/{selectedHouseId}" class="btn-manage-link"
											>MANAGE ROOMS ⚙️</a
										>
										<button
											class="btn-vanish-big"
											on:click={handleDeleteActiveHouse}
											class:disabled={isLayoutLocked}
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

								<footer class="card-footer">
									<span>📍 X: {house.x} / Y: {house.y}</span>
								</footer>
							</div>
						</a>

						<div class="card-admin-actions">
							<button
								class="btn-action-small"
								on:click={() => handleRenameHouse(house)}
								class:disabled={isLayoutLocked}>RENAME ✏️</button
							>
							<button
								class="btn-action-small vanish"
								on:click={() => handleDeleteHouse(house)}
								class:disabled={isLayoutLocked}>VANISH 🌪️</button
							>
						</div>
					</div>
				{/each}

				<button
					class="add-house-card"
					on:click={handleIgniteFromList}
					class:disabled={isLayoutLocked}
				>
					<span class="plus">+</span>
					<span>Ignite New House</span>
					<small>Starts in the middle of the map</small>
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

	.btn-toggle,
	.btn-guide,
	.btn-docs {
		background: #111;
		border: 1px solid #222;
		color: #888;
		padding: 0.75rem 1.25rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		font-size: 0.75rem;
		transition: all 0.2s;
	}
	.btn-docs {
		display: inline-flex;
		align-items: center;
		box-sizing: border-box;
		text-decoration: none;
	}
	.btn-toggle:hover,
	.btn-guide:hover,
	.btn-docs:hover {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border-color: #2dd4bf;
	}
	.btn-guide.active {
		background: #2dd4bf;
		color: #000;
		border-color: #2dd4bf;
	}

	.requests-panel {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.5px;
		background: rgba(115, 115, 115, 0.05);
		border: 1px solid #333;
		border-radius: 12px;
		padding: 0.6rem 1.5rem;
		color: #a3a3a3;
	}
	.requests-panel.open {
		background: rgba(244, 114, 182, 0.05);
		border-color: rgba(244, 114, 182, 0.3);
	}
	.requests-panel strong {
		color: #f472b6;
	}
	.requests-icon {
		font-size: 1rem;
	}
	.requests-text {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.btn-requests {
		min-height: 44px;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid #f472b6;
		background: transparent;
		color: #f472b6;
		font-weight: 900;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-requests:hover {
		background: rgba(244, 114, 182, 0.12);
	}
	.btn-requests:disabled {
		opacity: 0.5;
		cursor: progress;
	}
	.requests-review {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: #2dd4bf;
		text-decoration: none;
	}

	.intel-panel {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 2rem;
		box-shadow:
			inset 0 0 50px rgba(0, 0, 0, 0.8),
			0 0 20px rgba(0, 0, 0, 0.5);
	}

	.intel-container {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 3rem;
	}

	@media (max-width: 1000px) {
		.intel-container {
			grid-template-columns: 1fr;
			gap: 2rem;
		}
	}

	.dashboard-section {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		/* A grid item may not shrink below its content unless it is told to:
		   without this the live chip's one long line ("Live · last change 4 min
		   ago", never wrapping) made the whole page 430 px wide on a 320 px
		   phone. Found by the layout suite. */
		min-width: 0;
	}

	.section-header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 0.75rem;
	}
	.section-header h3 {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2.5px;
		color: #666;
	}

	.intel-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
		gap: 1rem;
	}

	.intel-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: #111;
		border-radius: 10px;
		border: 1px solid #1a1a1a;
	}
	.intel-card p {
		margin: 0;
		font-size: 0.75rem;
		color: #888;
		line-height: 1.2;
		font-weight: bold;
	}
	.icon {
		font-size: 1rem;
	}

	.live-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		/* Narrow screens: the chip drops to its own line and, if even that is
		   tight, its text ends in an ellipsis instead of pushing the page. */
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.55rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #222;
		color: #737373;
	}
	.live-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #737373;
		flex-shrink: 0;
	}
	/* The only thing that blinks on this page: proof the numbers are moving. */
	.live-chip[data-status='live'] {
		color: var(--state-open);
		border-color: rgba(74, 222, 128, 0.3);
	}
	.live-chip[data-status='live'] .live-dot {
		background: var(--state-open);
		box-shadow: 0 0 8px var(--state-open);
		animation: live-pulse 2s ease-in-out infinite;
	}
	.live-chip[data-status='stale'] {
		color: var(--state-filling);
		border-color: rgba(251, 146, 60, 0.3);
	}
	.live-chip[data-status='stale'] .live-dot {
		background: var(--state-filling);
	}
	.live-chip[data-status='offline'] {
		color: var(--state-full);
		border-color: rgba(248, 113, 113, 0.3);
	}
	.live-chip[data-status='offline'] .live-dot {
		background: var(--state-full);
	}

	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}

	.btn-refresh {
		background: transparent;
		border: 1px solid #222;
		color: #737373;
		border-radius: 8px;
		width: 28px;
		height: 28px;
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		flex-shrink: 0;
	}
	.btn-refresh:hover {
		color: #2dd4bf;
		border-color: #2dd4bf;
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
	.laser-dot.pink {
		background: #f472b6;
		box-shadow: 0 0 10px #f472b6;
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
	.map-status-bar {
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
	   same breakpoint. */
	@media (max-width: 1100px) {
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
	.btn-vanish-big:hover {
		background: #ef4444;
		color: #fff;
		box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
	}

	.btn-vanish-big.disabled,
	.btn-action-small.disabled,
	.add-house-card.disabled {
		opacity: 0.3;
		cursor: not-allowed !important;
		filter: grayscale(1);
		pointer-events: auto !important;
	}
	.btn-vanish-big.disabled:hover,
	.btn-action-small.disabled:hover,
	.add-house-card.disabled:hover {
		background: rgba(255, 255, 255, 0.05) !important;
		box-shadow: none !important;
		transform: none !important;
		border-color: #333 !important;
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
	.btn-action-small:hover:not(.disabled) {
		background: #222;
		border-color: #2dd4bf;
		color: #fff;
	}
	.btn-action-small.vanish:hover:not(.disabled) {
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
	.add-house-card:hover:not(.disabled) {
		border-color: #2dd4bf;
		color: #2dd4bf;
		background: rgba(45, 212, 191, 0.05);
	}
	.add-house-card.disabled:hover {
		border-color: #222;
		color: #444;
		background: transparent;
	}
	.add-house-card .plus {
		font-size: 3rem;
		font-weight: 100;
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
		.intel-panel {
			padding: 1rem;
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
