<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import Map from '$lib/components/Map.svelte';
	import HouseEditor from '$lib/components/HouseEditor.svelte';
	import IntelDashboard from '$lib/components/admin/IntelDashboard.svelte';
	import SanityChecks from '$lib/components/admin/SanityChecks.svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { fade, fly, slide } from 'svelte/transition';

	export let data: PageData;

	$: ({ houses, sanityWarnings, history, isVerified, isBookingActive, bookingUnlockAt } = data);

	// Management Summary Calculations
	$: totalBeds = houses.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
	$: occupiedBeds = houses.reduce((sum, h) => sum + (h.occupiedBeds || 0), 0);
	$: freeBeds = totalBeds - occupiedBeds;
	$: occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

	$: houseStats = {
		empty: houses.filter((h) => h.occupiedBeds === 0 && h.totalBeds > 0).length,
		partial: houses.filter((h) => h.occupiedBeds > 0 && h.occupiedBeds < h.totalBeds).length,
		full: houses.filter((h) => h.occupiedBeds >= h.totalBeds && h.totalBeds > 0).length,
		unconfigured: houses.filter((h) => h.totalBeds === 0).length
	};

	// Main View state
	let showMap = true;
	let showGuide = false;
	let selectedHouseId: string | null = null;
	let unlockDateInput = bookingUnlockAt ? new Date(bookingUnlockAt).toISOString().slice(0, 16) : '';

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

	const handleTogglePhase: SubmitFunction = ({ cancel }) => {
		if (isBookingActive) {
			const proceed = confirm(
				'⚠️ WARNING: You are about to DEACTIVATE Live Booking mode. Regular users will no longer be able to claim spots. Continue?'
			);
			if (!proceed) {
				cancel();
				return;
			}

			if (occupiedBeds > 0) {
				const clear = confirm(
					`📊 DETECTED: There are currently ${occupiedBeds} active bookings. Would you like to CLEAR ALL BOOKINGS now to reset the database? (This cannot be undone!)`
				);
				if (clear) {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							const formData = new FormData();
							await submitAction('?/clearAllBookings', formData);
							alert('✨ PLAYA PURGED: All spots are vacant once more.');
						}
						await update();
					};
				}
			}
		}
		return async ({ update }) => {
			await update();
		};
	};

	async function submitAction(actionUrl: string, formData: FormData) {
		try {
			const response = await fetch(actionUrl, {
				method: 'POST',
				body: formData,
				headers: {
					'x-sveltekit-action': 'true',
					accept: 'application/json'
				}
			});
			const result = await response.json();
			return result;
		} catch (err: any) {
			console.error(`[Action Error] Fetch failed for ${actionUrl}:`, err);
			return { type: 'error', error: err.message };
		}
	}

	// When clicking empty space on the map in editor mode
	function handleLocationSelected(data: { x: number; y: number }) {
		const { x, y } = data;
		selectedHouseId = null; // Deselect existing
		editingHouse = { x, y, name: '' };
		console.log(`[Dashboard] Preparing new house deployment at (${x}, ${y})`);
	}

	async function handleHouseMoved(event: CustomEvent) {
		if (isBookingActive) {
			alert(
				'🔒 LOCKDOWN ACTIVE: Map layout is locked during Live Booking. Switch to Staging Mode to reposition houses.'
			);
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

		if (result.type !== 'success') {
			alert(
				`🔥 THE PLAYA PROTECTS! 🛡️ ${result.data?.error || 'This house has active bookings and cannot be moved.'}`
			);
			editingHouse = null;
			selectedHouseId = null;
			invalidateAll();
		}
	}

	function handleSelectHouse(event: CustomEvent) {
		const house = event.detail;
		selectedHouseId = house.id;
		editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
		console.log(`[Dashboard] House selected: ${house.name}`);
	}

	function handleRenameHouse(house: any) {
		if (isBookingActive) {
			alert(
				'🔒 LOCKDOWN ACTIVE: House names are locked during Live Booking. Switch to Staging Mode to manage.'
			);
			return;
		}
		selectedHouseId = house.id;
		editingHouse = { id: house.id, x: house.x, y: house.y, name: house.name };
		console.log(`[Dashboard] House selected for rename: ${house.name}`);
	}

	async function handleDeleteHouse(house: any) {
		if (isBookingActive) {
			alert(
				'🔒 LOCKDOWN ACTIVE: You cannot vanish sanctuaries while bookings are live! Switch to Staging Mode first.'
			);
			return;
		}
		if (!house || !house.id) return;

		if (
			confirm(
				`⚠️ DANGER! ⚠️ Are you sure you want to vanish "${house.name}"? This will evaporate all rooms and spots! 🌪️`
			)
		) {
			const formData = new FormData();
			formData.append('id', house.id);

			const result = await submitAction('?/deleteHouse', formData);

			if (result.type !== 'success') {
				alert(`❌ VANISH FAILED! ${result.data?.error || 'The playa protects this sanctuary.'}`);
			}
			invalidateAll();
		}
	}

	async function handleSaveHouse(event: CustomEvent) {
		if (isBookingActive) {
			alert('🔒 LOCKDOWN ACTIVE: House deployment is locked during Live Booking.');
			editingHouse = null;
			selectedHouseId = null;
			return;
		}
		const newHouseData = event.detail;

		if (!newHouseData.name || newHouseData.name.trim() === '') {
			alert('⚠️ NAME REQUIRED! A sanctuary needs a name to exist in the dust.');
			return;
		}

		const formData = new FormData();
		formData.append('name', newHouseData.name);

		if (editingHouse?.id) {
			formData.append('id', editingHouse.id);
			const result = await submitAction('?/renameHouse', formData);
			if (result.type !== 'success')
				alert(`❌ RENAME FAILED! ${result.data?.error || 'The desert winds are too strong.'}`);
		} else {
			formData.append('x', editingHouse?.x.toString() || '0');
			formData.append('y', editingHouse?.y.toString() || '0');
			formData.append('bedCount', newHouseData.totalBeds?.toString() || '0');

			const result = await submitAction('/admin/house/new?/create', formData);
			if (result.type !== 'success')
				alert(`❌ CREATION FAILED! ${result.data?.error || 'The dust has clogged the gears.'}`);
		}

		editingHouse = null;
		selectedHouseId = null;
		invalidateAll();
	}

	async function handleDeleteActiveHouse() {
		if (isBookingActive) {
			alert('🔒 LOCKDOWN ACTIVE: You cannot vanish sanctuaries while bookings are live!');
			return;
		}
		if (!activeHouse || !activeHouse.id) return;

		if (
			confirm(
				`⚠️ DANGER! ⚠️ Are you sure you want to vanish "${activeHouse.name}"? This will evaporate all rooms and spots! 🌪️`
			)
		) {
			console.log(`[Dashboard] Requesting VANISH for house ID: ${activeHouse.id}`);

			const card = document.querySelector(`.house-card-wrapper:has([href*="${activeHouse.id}"])`);
			if (card) card.classList.add('disintegrating');
			const sidebar = document.querySelector('.details-sidebar');
			if (sidebar) sidebar.classList.add('disintegrating');

			const formData = new FormData();
			formData.append('id', activeHouse.id);

			await new Promise((resolve) => setTimeout(resolve, 500));

			const result = await submitAction('?/deleteHouse', formData);

			if (result.type !== 'success') {
				console.error('[Dashboard] Vanish FAILED:', result);
				if (card) card.classList.remove('disintegrating');
				if (sidebar) sidebar.classList.remove('disintegrating');
				alert(`❌ VANISH FAILED: ${result.data?.error || 'The playa protects this sanctuary.'}`);
			} else {
				console.log('[Dashboard] Vanish SUCCESS. Clearing state...');
				selectedHouseId = null;
				editingHouse = null;
				await invalidateAll();
			}
		}
	}
	let showTemplates = false;
	let isImporting = false;
	let isExporting = false;
	let selectedFileName = '';

	function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			selectedFileName = input.files[0].name;
		} else {
			selectedFileName = '';
		}
	}

	async function handleExportTemplate() {
		isExporting = true;
		try {
			const response = await fetch('/admin/api/export-template');
			if (!response.ok) throw new Error('Export failed');

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `burn-template-${new Date().toISOString().slice(0, 10)}.json`;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			document.body.removeChild(a);
		} catch (err) {
			console.error('[Export] Error:', err);
			alert('❌ EXPORT FAILED: The data stream was interrupted.');
		} finally {
			// Stay in loading state a bit longer for visual fun
			setTimeout(() => {
				isExporting = false;
			}, 1500);
		}
	}

	const handleImportTemplate: SubmitFunction = ({ cancel }) => {
		if (
			!confirm(
				'☢️ NUCLEAR WARNING ☢️\n\nImporting a template will PERMANENTLY ERASE:\n- All current Houses\n- All current Rooms\n- All current Beds\n- ALL ACTIVE BOOKINGS AND ORDERS\n\nThis cannot be undone. Are you absolutely sure the playa is ready for a reset?'
			)
		) {
			cancel();
			return;
		}

		isImporting = true;
		return async ({ result, update }) => {
			isImporting = false;
			if (result.type === 'success') {
				showTemplates = false;
				alert('✨ PLAYA REBORN: Template applied successfully.');
			}
			await update();
		};
	};
</script>

<div class="dashboard-wrapper">
	<header class="page-header">
		<div class="header-left">
			<h1>Control Center 🔥</h1>
			<p class="subtitle">Orchestrating the chaos of the playa 🏜️</p>
		</div>

		<div class="header-right">
			<button class="btn-secondary" on:click={() => (showTemplates = !showTemplates)}>
				{showTemplates ? 'CLOSE TOOLS 🛠' : 'TEMPLATES 💾'}
			</button>

			<button class="btn-guide" on:click={() => (showGuide = !showGuide)} class:active={showGuide}>
				{showGuide ? 'CLOSE INTEL 📡' : 'SHOW INTEL 📊'}
			</button>

			{#if isVerified}
				<form method="POST" action="?/togglePhase" use:enhance={handleTogglePhase}>
					<button type="submit" class="btn-laser" class:live={isBookingActive}>
						{isBookingActive ? '🎪 LIVE BOOKING ACTIVE' : '🛠 STAGING MODE'}
						<div class="laser-glow"></div>
					</button>
				</form>
			{/if}

			<button class="btn-toggle" on:click={() => (showMap = !showMap)}>
				{showMap ? '🛰️ LIST VIEW' : '🗺️ MAP VIEW'}
			</button>
		</div>
	</header>

	{#if showTemplates}
		<section class="templates-overlay" in:fade out:fade>
			<div class="templates-content" in:fly={{ y: 20 }}>
				<div class="modal-header">
					<h2>Burn Template Manager</h2>
					<button class="btn-close" on:click={() => (showTemplates = false)}>✕</button>
				</div>

				<div class="templates-grid">
					<div class="tool-card export-card">
						<div class="icon">📡</div>
						<h3>Export Current Layout</h3>
						<p>
							Download the entire structure of houses, rooms, and beds as a JSON file. Use this for
							backups or starting new burns.
						</p>
						<button class="btn-action" on:click={handleExportTemplate} disabled={isExporting}>
							{isExporting ? 'ENCODING...' : 'DOWNLOAD JSON 💾'}
						</button>

						{#if isExporting}
							<div class="card-loading-overlay" in:fade>
								<div class="data-stream">
									{#each Array(10) as _, i}
										<div class="bit" style="--delay: {i * 0.1}s; --left: {Math.random() * 100}%">
											{Math.random() > 0.5 ? '1' : '0'}
										</div>
									{/each}
								</div>
								<p>PACKAGING THE PLAYA...</p>
							</div>
						{/if}
					</div>

					<div class="tool-card import-card">
						<div class="icon">🌀</div>
						<h3>Import New Layout</h3>
						<p>
							Wipe the current database and rebuild the playa from a JSON template. <strong
								>Warning: This clears all data!</strong
							>
						</p>

						<form
							method="POST"
							action="?/importTemplate"
							enctype="multipart/form-data"
							use:enhance={handleImportTemplate}
						>
							<div class="file-input-wrapper">
								<input
									type="file"
									name="template"
									accept=".json"
									required
									id="template-upload"
									on:change={handleFileChange}
								/>
								<label for="template-upload" class:selected={selectedFileName}>
									<span class="file-icon">{selectedFileName ? '📄' : '📁'}</span>
									{selectedFileName || 'CHOOSE TEMPLATE FILE'}
								</label>
							</div>
							<button type="submit" class="btn-action danger" disabled={isImporting || !selectedFileName}>
								{isImporting ? 'IGNITING...' : 'APPLY TEMPLATE 🔥'}
							</button>
						</form>
					</div>
				</div>

				{#if isImporting}
					<div class="loading-overlay" in:fade>
						<div class="spinner"></div>
						<p>REBUILDING THE PLAYA STRUCTURE...</p>
						<small>The desert winds are reshaping the dust.</small>
					</div>
				{/if}
			</div>
		</section>
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
							>🔒 LOCKDOWN: Map layout is locked. Switch to 🛠 STAGING to manage.</span
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

						{#if isVerified}
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
						{/if}
					</div>
				{/each}

				{#if isVerified}
					<button
						class="add-house-card"
						on:click={() =>
							isBookingActive
								? alert('🔒 LOCKDOWN ACTIVE: Switch to 🛠 STAGING to ignite new sanctuaries.')
								: handleLocationSelected({ x: 500, y: 350 })}
						class:disabled={isBookingActive}
					>
						<span class="plus">+</span>
						<span>Ignite New House</span>
						<small>Auto-centered at 500/350</small>
					</button>
				{/if}
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
		color: #fff;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
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
		gap: 1rem;
		align-items: center;
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
	.btn-guide {
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
	.btn-toggle:hover,
	.btn-guide:hover {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border-color: #2dd4bf;
	}
	.btn-guide.active {
		background: #2dd4bf;
		color: #000;
		border-color: #2dd4bf;
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
		justify-content: space-around;
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
		grid-template-columns: repeat(2, 1fr);
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
	}
	.map-status-bar.live {
		color: #f472b6;
		background: rgba(244, 114, 182, 0.05);
		border-color: rgba(244, 114, 182, 0.1);
	}

	.map-layout-split {
		display: flex;
		gap: 2rem;
		height: 700px;
	}
	.map-frame {
		flex: 1;
		background: #0a0a0a;
		border: 2px solid #222;
		border-radius: 16px;
		overflow: hidden;
		position: relative;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	}

	.details-sidebar {
		width: 400px;
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
		color: #444;
		font-size: 1.5rem;
		cursor: pointer;
		line-height: 1;
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
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 2rem;
	}

	.house-card-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.card-admin-actions {
		display: flex;
		gap: 0.5rem;
		padding: 0 0.5rem;
	}

	.btn-action-small {
		flex: 1;
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
		justify-content: space-between;
		align-items: flex-start;
	}
	.card-header h2 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 900;
		color: #fff;
	}

	.badge {
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 0.6rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
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

	/* Templates UI */
	.templates-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(0, 0, 0, 0.9);
		backdrop-filter: blur(20px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.templates-content {
		background: #0a0a0a;
		border: 1px solid #222;
		border-top: 4px solid #fb923c;
		border-radius: 32px;
		width: 100%;
		max-width: 900px;
		padding: 3rem;
		position: relative;
		box-shadow: 0 50px 100px rgba(0, 0, 0, 0.8);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 3rem;
	}
	.modal-header h2 {
		font-size: 2.5rem;
		font-weight: 900;
		letter-spacing: -1px;
		margin: 0;
	}
	.btn-close {
		background: transparent;
		border: none;
		color: #444;
		font-size: 1.5rem;
		cursor: pointer;
		transition: color 0.2s;
	}
	.btn-close:hover {
		color: #fff;
	}

	.templates-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
	}

	.tool-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 24px;
		padding: 2.5rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		transition: border-color 0.3s;
	}
	.tool-card:hover {
		border-color: #333;
	}
	.tool-card .icon {
		font-size: 3rem;
	}
	.tool-card h3 {
		margin: 0;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.tool-card p {
		color: #666;
		font-size: 0.9rem;
		line-height: 1.6;
		margin: 0;
	}

	.btn-action {
		display: inline-block;
		width: 100%;
		padding: 1.2rem;
		background: #2dd4bf;
		color: #000;
		text-decoration: none;
		border-radius: 16px;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-size: 0.9rem;
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}
	.btn-action:hover:not(:disabled) {
		background: #fff;
		transform: scale(1.02);
	}
	.btn-action.danger {
		background: transparent;
		border: 2px solid #ef4444;
		color: #ef4444;
	}
	.btn-action.danger:hover:not(:disabled) {
		background: #ef4444;
		color: #000;
	}

	.file-input-wrapper {
		width: 100%;
		margin-bottom: 1rem;
	}
	.file-input-wrapper input {
		display: none;
	}
	.file-input-wrapper label {
		display: block;
		padding: 1.2rem;
		background: #050505;
		border: 1px dashed #333;
		border-radius: 12px;
		color: #444;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.3s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.8rem;
		letter-spacing: 1px;
	}
	.file-input-wrapper label:hover {
		border-color: #666;
		color: #888;
	}
	.file-input-wrapper label.selected {
		border: 2px solid #2dd4bf;
		background: rgba(45, 212, 191, 0.05);
		color: #fff;
		border-style: solid;
		box-shadow: 0 0 20px rgba(45, 212, 191, 0.1);
	}
	.file-icon {
		margin-right: 0.5rem;
		font-size: 1.1rem;
	}

	/* Loading Overlay */
	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.9);
		border-radius: 32px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
	}
	.spinner {
		width: 50px;
		height: 50px;
		border: 4px solid #2dd4bf;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	.loading-overlay p {
		font-weight: 900;
		letter-spacing: 2px;
		margin: 0;
	}
	.loading-overlay small {
		color: #444;
		text-transform: uppercase;
		font-weight: 900;
		letter-spacing: 1px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Card Specific Loading */
	.card-loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.95);
		border-radius: 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 5;
		overflow: hidden;
	}
	.card-loading-overlay p {
		font-weight: 900;
		color: #2dd4bf;
		font-size: 0.8rem;
		letter-spacing: 2px;
		margin-top: 1rem;
	}

	.data-stream {
		position: relative;
		width: 60px;
		height: 60px;
	}
	.bit {
		position: absolute;
		top: -20px;
		left: var(--left);
		color: #2dd4bf;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 900;
		font-size: 1.2rem;
		opacity: 0;
		animation: fall-bit 1s linear infinite;
		animation-delay: var(--delay);
	}

	@keyframes fall-bit {
		0% {
			top: -20px;
			opacity: 0;
		}
		20% {
			opacity: 1;
		}
		80% {
			opacity: 1;
		}
		100% {
			top: 60px;
			opacity: 0;
		}
	}
</style>
