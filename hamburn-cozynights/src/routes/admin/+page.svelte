<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import Map from '$lib/components/Map.svelte';
	import HouseEditor from '$lib/components/HouseEditor.svelte';
	import IntelDashboard from '$lib/components/admin/IntelDashboard.svelte';
	import SanityChecks from '$lib/components/admin/SanityChecks.svelte';
	import TemplateManager from '$lib/components/admin/TemplateManager.svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance, deserialize } from '$app/forms';
	import { fade, fly, slide } from 'svelte/transition';
	import { berlinLocalToIso, isoToBerlinLocal } from '$lib/time';
	import { MAP_WIDTH, MAP_HEIGHT, clampToMap, isTooCloseToOtherHouse } from '$lib/map-geometry';
	import { tick } from 'svelte';
	import { alertDialog, confirmDialog, toast } from '$lib/dialogs';

	export let data: PageData;

	// Only admins reach this page (hooks + layout); superusers additionally get
	// the destructive tools (clear all bookings, template import).
	$: ({ houses, sanityWarnings, history, isSuperuser, isBookingActive, bookingUnlockAt } = data);
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
	let unlockDateInput = bookingUnlockAt ? isoToBerlinLocal(bookingUnlockAt) : '';
	let timerError = '';

	const unlockTimeFormat = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Berlin',
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});

	function formatUnlockTime(iso: string) {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? iso : unlockTimeFormat.format(date);
	}

	// Editor Sidebar State
	let editingHouse: { id?: string; x: number; y: number; name: string } | null = null;

	// Compute the currently active house for the sidebar
	$: activeHouse =
		houses.find((h) => h.id === selectedHouseId) || (editingHouse?.id ? null : editingHouse);

	function getStatusColor(free: number, total: number) {
		if (total === 0) return 'gray';
		if (free === 0) return 'red';
		if (free < 3) return 'orange';
		return 'green';
	}

	function getStatusText(free: number, total: number) {
		if (total === 0) return 'Not setup';
		if (free === 0) return 'Fully booked';
		return `${free} spots free`;
	}

	const handleTogglePhase: SubmitFunction = async ({ cancel }) => {
		const goingLive = !isBookingActive;
		let clearBookings = false;

		if (!goingLive) {
			const proceed = await confirmDialog(
				'Guests will no longer be able to book or change their spot until you go live again. Existing bookings stay as they are.',
				{
					title: 'Switch to Staging Mode?',
					tone: 'warning',
					confirmLabel: 'Switch to Staging',
					cancelLabel: 'Stay live'
				}
			);
			if (!proceed) {
				cancel();
				return;
			}

			if (occupiedBeds > 0 && isSuperuser) {
				clearBookings = await confirmDialog(
					`There are ${occupiedBeds} booked spots right now. Do you also want to clear ALL bookings? Every guest loses their spot and has to book again. Spots the crew assigned for special-needs requests stay. Ticket codes stay valid. This cannot be undone.`,
					{
						title: 'Also clear all bookings?',
						tone: 'danger',
						confirmLabel: 'Clear all bookings',
						cancelLabel: 'Keep bookings'
					}
				);
			}
		}

		return async ({ result, update }) => {
			if (result.type === 'success') {
				// The server toggles the phase it sees, which can differ from this
				// page's when the go-live timer ran out or another admin was faster.
				const nowLive =
					(result.data as { isBookingActive?: boolean } | undefined)?.isBookingActive ?? goingLive;
				const phaseMessage = nowLive
					? '🎪 Live Booking is active. Guests can book now, the layout is locked.'
					: '🛠 Staging Mode is active. Booking is closed, the layout can be edited.';
				if (nowLive === goingLive) {
					toast(phaseMessage, 'success');
				} else {
					await alertDialog(
						`The booking phase had already changed before your click (the go-live timer ran out, or another admin switched it). ${phaseMessage} Press the button again if that is not what you want.`,
						{ title: 'Check the booking phase', tone: 'warning' }
					);
				}
				if (clearBookings && !nowLive) {
					const purge = await submitAction('?/clearAllBookings', new FormData());
					if (purge.type === 'success') {
						const kept = Number((purge.data as { kept?: number } | undefined)?.kept) || 0;
						toast(
							kept > 0
								? `✨ All bookings were cleared, except ${kept} special-needs spot${kept === 1 ? '' : 's'} assigned by the crew.`
								: '✨ All bookings were cleared. Every spot is free again.',
							'success'
						);
					} else {
						await alertDialog(
							`${actionErrorMessage(purge) || 'The server could not be reached.'} No bookings were changed by this step; the app is in Staging Mode. Check the spots before you try again.`,
							{ title: 'Bookings were not cleared', tone: 'danger' }
						);
					}
				}
			} else if (result.type === 'failure' || result.type === 'error') {
				await alertDialog(
					`${actionErrorMessage(result) || 'The server could not be reached.'} The booking phase was not changed. Reload the page and try again.`,
					{ title: 'Phase not changed', tone: 'danger' }
				);
			}
			await update();
		};
	};

	const handleSetTimer: SubmitFunction = ({ cancel }) => {
		timerError = '';
		const iso = berlinLocalToIso(unlockDateInput || '');
		if (!unlockDateInput) {
			timerError = 'Pick a date and time first.';
		} else if (!iso) {
			timerError = 'That is not a complete date and time. Use the format YYYY-MM-DD HH:MM.';
		} else if (new Date(iso).getTime() <= Date.now()) {
			timerError =
				'That time is already in the past (Berlin time). Pick a later time, or go live right now with the STAGING MODE button.';
		}
		if (timerError) {
			cancel();
			return;
		}

		return async ({ result, update }) => {
			if (result.type === 'success') {
				toast(
					`⏱ Timer set: Live Booking opens on ${formatUnlockTime(iso)} (Berlin time).`,
					'success'
				);
			} else if (result.type === 'failure' || result.type === 'error') {
				timerError = `The timer was not saved: ${actionErrorMessage(result) || 'the server did not accept it.'} Check the date and try again.`;
			}
			await update({ reset: false });
		};
	};

	const handleCancelTimer: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				toast('⏱ Timer cancelled. Live Booking only opens when you switch it on.', 'success');
			} else if (result.type === 'failure' || result.type === 'error') {
				await alertDialog(
					`${actionErrorMessage(result) || 'The server could not be reached.'} The timer is still set. Reload the page and try again.`,
					{ title: 'Timer not cancelled', tone: 'danger' }
				);
			}
			await update();
		};
	};

	async function submitAction(actionUrl: string, formData: FormData): Promise<ActionResult> {
		try {
			const response = await fetch(actionUrl, {
				method: 'POST',
				body: formData,
				headers: {
					'x-sveltekit-action': 'true',
					accept: 'application/json'
				}
			});
			// The `data` of an action response is devalue-encoded: response.json()
			// would leave it a string, so the real error message never showed up.
			return deserialize(await response.text());
		} catch (err: any) {
			console.error(`[Action Error] Fetch failed for ${actionUrl}:`, err);
			return { type: 'error', error: err };
		}
	}

	/** Server-provided reason of a failed action: fail(…, { error | message }) or error(…). */
	function actionErrorMessage(result: ActionResult): string | undefined {
		if (result.type === 'failure') {
			const data = result.data as { error?: unknown; message?: unknown } | undefined;
			const reason = data?.error ?? data?.message;
			return typeof reason === 'string' ? reason : undefined;
		}
		if (result.type === 'error') {
			return typeof result.error?.message === 'string' ? result.error.message : undefined;
		}
		return undefined;
	}

	const LAYOUT_LOCKED_MESSAGE =
		'The layout is locked while Live Booking is active. Switch to Staging Mode to add or move houses.';
	let lastLockedToast = 0;

	function handleLayoutLocked() {
		// One hint per gesture is enough.
		if (Date.now() - lastLockedToast < 2500) return;
		lastLockedToast = Date.now();
		toast(`🔒 ${LAYOUT_LOCKED_MESSAGE}`, 'warning');
	}

	/** Explains why a structural action is refused during Live Booking. */
	function explainLocked(action: string) {
		return alertDialog(
			`Live Booking is active, so the camp layout is locked. Switch to Staging Mode (the 🎪 LIVE BOOKING ACTIVE button) to ${action}.`,
			{ title: '🔒 Locked during Live Booking', tone: 'warning' }
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
		if (isBookingActive) {
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
		if (isBookingActive) {
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
		if (isBookingActive) {
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
		if (isBookingActive) {
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
		if (isBookingActive) {
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
		if (isBookingActive) {
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

			<form method="POST" action="?/togglePhase" use:enhance={handleTogglePhase}>
				<button type="submit" class="btn-laser" class:live={isBookingActive}>
					{isBookingActive ? '🎪 LIVE BOOKING ACTIVE' : '🛠 STAGING MODE'}
					<div class="laser-glow"></div>
				</button>
			</form>

			<button class="btn-toggle" on:click={() => (showMap = !showMap)}>
				{showMap ? '🛰️ LIST VIEW' : '🗺️ MAP VIEW'}
			</button>
		</div>
	</header>

	<section class="timer-panel">
		{#if bookingUnlockAt}
			<div class="timer-active">
				<span class="timer-icon">⏱</span>
				<span class="timer-text"
					>Auto-opens live booking on <strong>{formatUnlockTime(bookingUnlockAt)}</strong> (CET/CEST)</span
				>
				<form method="POST" action="?/cancelUnlockTimer" use:enhance={handleCancelTimer}>
					<button type="submit" class="btn-timer-cancel">Cancel Timer ✕</button>
				</form>
			</div>
		{:else}
			<form
				method="POST"
				action="?/setUnlockTimer"
				use:enhance={handleSetTimer}
				class="timer-set-form"
				novalidate
			>
				<span class="timer-icon">⏱</span>
				<label class="timer-label" for="unlock-at">Schedule automatic go-live:</label>
				<input
					id="unlock-at"
					type="datetime-local"
					name="unlockAt"
					placeholder="YYYY-MM-DD HH:MM"
					bind:value={unlockDateInput}
					class:error={!!timerError}
					aria-describedby="unlock-at-hint"
					on:input={() => (timerError = '')}
				/>
				<button type="submit" class="btn-timer-set">Schedule ✨</button>
				<span class="timer-hint" id="unlock-at-hint"
					>Berlin time (CET/CEST), no matter where you or the server are.</span
				>
				{#if timerError}
					<p class="timer-error" role="alert">⚠️ {timerError}</p>
				{/if}
			</form>
		{/if}
	</section>

	<section class="requests-panel" class:open={requestsOpen}>
		<span class="timer-icon" aria-hidden="true">♿</span>
		<span class="timer-text">
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
					</div>

					<IntelDashboard {totalBeds} {occupiedBeds} {history} />

					<div class="visual-progress">
						<div class="status-legend">
							<div class="legend-item">
								<span class="dot empty"></span>
								<span class="count">{houseStats.empty}</span>
								<span class="text">EMPTY HOUSES</span>
							</div>
							<div class="legend-item">
								<span class="dot partial"></span>
								<span class="count">{houseStats.partial}</span>
								<span class="text">FILLING</span>
							</div>
							<div class="legend-item">
								<span class="dot full"></span>
								<span class="count">{houseStats.full}</span>
								<span class="text">FULL</span>
							</div>
						</div>
					</div>
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
							<span class="icon">🎪</span>
							<p>Go LIVE to lock layout & allow bookings.</p>
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
				<div class="map-status-bar" class:live={isBookingActive}>
					{#if isBookingActive}
						<span class="status-msg"
							>🔒 LOCKED: Live Booking is active. Switch to 🛠 STAGING MODE to add, move or delete
							houses.</span
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
							{isBookingActive}
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
											class:disabled={isBookingActive}
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
						<a href="/admin/house/{house.id}" class="house-card">
							<div class="card-glow"></div>
							<header class="card-header">
								<h2>{house.name} 🛖</h2>
								<span class="badge {getStatusColor(house.freeBeds, house.totalBeds)}">
									{getStatusText(house.freeBeds, house.totalBeds)}
								</span>
							</header>

							<div class="card-body">
								<div class="stat-group">
									<span class="stat-label">Spots Claimed 👥</span>
									<span class="stat-value">{house.occupiedBeds} / {house.totalBeds}</span>
								</div>

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
								class:disabled={isBookingActive}>RENAME ✏️</button
							>
							<button
								class="btn-action-small vanish"
								on:click={() => handleDeleteHouse(house)}
								class:disabled={isBookingActive}>VANISH 🌪️</button
							>
						</div>
					</div>
				{/each}

				<button
					class="add-house-card"
					on:click={handleIgniteFromList}
					class:disabled={isBookingActive}
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
	.header-right form {
		display: flex;
	}
	.header-right button,
	.header-right a {
		min-height: 44px;
		white-space: nowrap;
	}

	.btn-laser {
		background: #111;
		border: 1px solid #333;
		color: #fff;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-weight: 900;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition: all 0.3s;
		font-size: 0.8rem;
		letter-spacing: 1px;
	}
	.btn-laser.live {
		border-color: #f472b6;
		color: #f472b6;
	}
	.btn-laser.live .laser-glow {
		background: rgba(244, 114, 182, 0.2);
		box-shadow: 0 0 20px rgba(244, 114, 182, 0.2);
	}

	.laser-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
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

	.timer-panel {
		background: rgba(251, 146, 60, 0.05);
		border: 1px solid rgba(251, 146, 60, 0.2);
		border-radius: 12px;
		padding: 0.85rem 1.5rem;
	}
	.timer-active,
	.timer-set-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: #888;
		font-weight: 700;
	}
	.timer-text {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.timer-active form {
		display: flex;
		margin-left: auto;
	}
	.timer-hint {
		color: #777;
		font-weight: 600;
	}
	.timer-error {
		flex-basis: 100%;
		margin: 0;
		color: #f87171;
		line-height: 1.4;
	}
	.timer-icon {
		font-size: 1rem;
	}
	.timer-active strong {
		color: #fb923c;
	}
	.timer-label {
		color: #888;
	}
	.timer-set-form input[type='datetime-local'] {
		background: #050505;
		border: 1px solid #333;
		color: #fff;
		color-scheme: dark;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		font-family: inherit;
		min-height: 44px;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
	}
	.timer-set-form input.error {
		border-color: #f87171;
	}
	.btn-timer-set,
	.btn-timer-cancel {
		background: #fb923c;
		border: none;
		color: #000;
		min-height: 44px;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-weight: 900;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.btn-timer-set:hover:not(:disabled) {
		transform: scale(1.05);
	}
	.btn-timer-set:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-timer-cancel {
		background: transparent;
		border: 1px solid #444;
		color: #888;
	}
	.btn-timer-cancel:hover {
		border-color: #ef4444;
		color: #f87171;
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
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 12px;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 0.75rem;
	}
	.section-header h3 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2.5px;
		color: #666;
	}

	.visual-progress {
		background: #111;
		padding: 1.5rem;
		border-radius: 12px;
		border: 1px solid #222;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.status-legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-around;
		gap: 0.75rem 1.5rem;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.legend-item .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.legend-item .dot.empty {
		background: #444;
	}
	.legend-item .dot.partial {
		background: #fb923c;
		box-shadow: 0 0 10px #fb923c;
	}
	.legend-item .dot.full {
		background: #f87171;
		box-shadow: 0 0 10px #f87171;
	}
	.legend-item .count {
		font-weight: 900;
		color: #fff;
		font-size: 0.9rem;
	}
	.legend-item .text {
		font-size: 0.6rem;
		font-weight: 900;
		color: #666;
		letter-spacing: 1px;
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
		background: rgba(45, 212, 191, 0.05);
		border: 1px solid rgba(45, 212, 191, 0.1);
		border-radius: 12px;
		font-size: 0.7rem;
		font-weight: 900;
		color: #2dd4bf;
		letter-spacing: 1px;
		line-height: 1.5;
	}
	.map-status-bar.live {
		color: #f472b6;
		background: rgba(244, 114, 182, 0.05);
		border-color: rgba(244, 114, 182, 0.1);
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
		border-color: #444;
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

	.badge {
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 0.6rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
		white-space: nowrap;
	}
	.badge.green {
		background: rgba(74, 222, 128, 0.1);
		color: #4ade80;
		border: 1px solid #4ade80;
	}
	.badge.orange {
		background: rgba(251, 146, 60, 0.1);
		color: #fb923c;
		border: 1px solid #fb923c;
	}
	.badge.red {
		background: rgba(248, 113, 113, 0.1);
		color: #f87171;
		border: 1px solid #f87171;
	}
	.badge.gray {
		background: rgba(102, 102, 102, 0.1);
		color: #666;
		border: 1px solid #666;
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
		.header-right form {
			grid-column: 1 / -1;
		}
		.timer-panel {
			padding: 0.85rem 1rem;
		}
		.timer-set-form input[type='datetime-local'] {
			flex: 1 1 100%;
			width: 100%;
		}
		.btn-timer-set {
			flex: 1 1 100%;
		}
		.timer-active form {
			margin-left: 0;
			flex: 1 1 100%;
		}
		.btn-timer-cancel {
			width: 100%;
		}
		.intel-panel {
			padding: 1rem;
		}
		.visual-progress {
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
