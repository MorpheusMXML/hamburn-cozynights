<script lang="ts">
	import type { HouseData } from '$lib/types';
	import { MAP_WIDTH, MAP_HEIGHT, parseMapCoordinate } from '$lib/map-geometry';
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';

	export let x: number;
	export let y: number;
	export let name = '';
	export let houseId: string | undefined = undefined;
	export let flat = false;

	const dispatch = createEventDispatcher();

	let bedCount = 4;
	let showValidationError = false;

	$: isEditing = !!houseId;

	// Typed coordinates: follow the pin (drag, arrow keys, another house) until
	// the admin edits them, then "MOVE PIN" sends them to the parent.
	let xInput = String(x);
	let yInput = String(y);
	let positionError = '';
	$: syncPositionInputs(x, y);

	function syncPositionInputs(nextX: number, nextY: number) {
		xInput = String(nextX);
		yInput = String(nextY);
		positionError = '';
	}

	$: positionChanged = xInput !== String(x) || yInput !== String(y);

	function handleMove() {
		const nextX = parseMapCoordinate(xInput, MAP_WIDTH);
		const nextY = parseMapCoordinate(yInput, MAP_HEIGHT);
		if (nextX === null || nextY === null) {
			positionError = `Enter whole numbers: X from 0 to ${MAP_WIDTH}, Y from 0 to ${MAP_HEIGHT}.`;
			return;
		}
		positionError = '';
		dispatch('move', { x: nextX, y: nextY });
	}

	function handleSave() {
		if (!name || name.trim() === '') {
			showValidationError = true;
			console.error(
				`[HouseEditor] Validation failed: Empty name for ${isEditing ? 'existing' : 'new'} house at (${x}, ${y})`
			);
			return;
		}

		showValidationError = false;
		console.log(`[HouseEditor] Saving house: "${name}" (ID: ${houseId || 'NEW'}) at (${x}, ${y})`);

		const now = new Date().toISOString() as any;
		const newHouse: HouseData = {
			id: houseId || String(Date.now()),
			collectionId: '',
			collectionName: 'houses' as any,
			created: now,
			updated: now,
			name,
			occupied: false,
			x,
			y,
			rooms: [
				{
					id: 'temp-room',
					collectionId: '',
					collectionName: 'rooms' as any,
					created: now,
					updated: now,
					name: 'Room 1',
					room_number: 1,
					house: houseId || '',
					amount_beds: bedCount,
					occupied: false,
					beds: Array.from({ length: bedCount }, (_, i) => ({
						id: String(Date.now() + i),
						collectionId: '',
						collectionName: 'beds' as any,
						created: now,
						updated: now,
						label: `B${i + 1}`,
						enabled: false,
						occupied: false,
						is_locked: false,
						is_special: false,
						booked_at: '',
						room: 'temp-room',
						order: ''
					}))
				}
			],
			totalBeds: bedCount,
			occupiedBeds: 0,
			freeBeds: bedCount
		};
		dispatch('save', newHouse);
	}
</script>

<div class="editor-card-container" class:edit-mode={isEditing} class:flat>
	<div class="editor-card">
		<header class="editor-header">
			<div class="mode-badge">{isEditing ? 'RECONFIGURING' : 'IGNITING NEW'} ⚡️</div>
			<h4>{isEditing ? 'UPDATE COORDINATES' : 'GENERATE SANCTUARY'} 🏠</h4>
			{#if isEditing}
				<span class="house-name-tag">{name}</span>
			{/if}
		</header>

		<div class="input-group">
			<label for="house-name">UNIT DESIGNATION</label>
			<input
				id="house-name"
				bind:value={name}
				placeholder="e.g. Neon Cave"
				class:error={showValidationError}
				on:input={() => (showValidationError = false)}
			/>
			{#if showValidationError}
				<span class="error-msg" transition:fade>⚠️ NAME REQUIRED FOR LOCALIZATION</span>
			{/if}
		</div>

		{#if !isEditing}
			<div class="input-group" in:fade>
				<label for="bed-count">INITIAL CAPACITY (BEDS) 🛌</label>
				<div class="number-input-wrapper">
					<input id="bed-count" type="number" bind:value={bedCount} min="1" />
					<div class="laser-accent"></div>
				</div>
				<p class="hint">Base occupancy for the first module.</p>
			</div>
		{:else}
			<div class="input-group position-group" in:fade>
				<span class="group-label">MAP POSITION 📍</span>
				<div class="position-row">
					<label class="coord-field" for="house-x">
						<span>X</span>
						<input
							id="house-x"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							bind:value={xInput}
							class:error={!!positionError}
							on:keydown={(e) => e.key === 'Enter' && handleMove()}
						/>
					</label>
					<label class="coord-field" for="house-y">
						<span>Y</span>
						<input
							id="house-y"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							bind:value={yInput}
							class:error={!!positionError}
							on:keydown={(e) => e.key === 'Enter' && handleMove()}
						/>
					</label>
					<button type="button" class="btn-move" disabled={!positionChanged} on:click={handleMove}>
						MOVE PIN
					</button>
				</div>
				{#if positionError}
					<span class="error-msg" transition:fade>⚠️ {positionError}</span>
				{:else}
					<p class="hint">
						Drag the pin on the map, use the arrow keys, or type a position (X 0–{MAP_WIDTH}, Y 0–{MAP_HEIGHT}).
						Moves are saved right away.
					</p>
				{/if}
			</div>
		{/if}

		<div class="actions">
			<button class="btn-cancel" on:click={() => dispatch('cancel')}>ABORT 🏜️</button>
			<button class="btn-save" on:click={handleSave}>
				{isEditing ? 'SYNC MODULE' : 'IGNITE HOUSE'} ✨
			</button>
		</div>
	</div>
</div>

<style>
	.editor-card-container {
		background: #0f0f0f;
		border: 1px solid #2dd4bf;
		padding: 2rem;
		border-radius: 12px;
		color: white;
		width: min(360px, 100%);
		box-sizing: border-box;
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.2);
		position: relative;
		overflow: hidden;
	}

	.editor-card-container.flat {
		background: transparent;
		border: none;
		padding: 0;
		width: 100%;
		box-shadow: none;
	}
	.flat::before {
		display: none;
	}

	.mode-badge {
		font-size: 0.6rem;
		background: #222;
		color: #888;
		padding: 2px 8px;
		border-radius: 4px;
		display: inline-block;
		margin-bottom: 0.5rem;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.edit-mode .mode-badge {
		color: #f472b6;
		border: 1px solid #f472b6;
	}

	/* Decorative Laser Corner */
	.editor-card-container::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 40px;
		height: 40px;
		border-top: 2px solid #f472b6;
		border-left: 2px solid #f472b6;
	}
	.edit-mode::before {
		border-color: #2dd4bf;
	}

	.editor-card {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.editor-header {
		border-bottom: 1px solid #222;
		padding-bottom: 1rem;
	}
	h4 {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 2px;
		color: #666;
		font-weight: 900;
	}
	.house-name-tag {
		font-size: 1.25rem;
		font-weight: bold;
		color: #fff;
		margin-top: 0.5rem;
		display: block;
		text-transform: uppercase;
		letter-spacing: -0.5px;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #444;
		letter-spacing: 1px;
	}

	input {
		background: #050505;
		border: 1px solid #222;
		color: white;
		padding: 1rem;
		border-radius: 8px;
		font-size: 1rem;
		transition: all 0.3s;
	}
	input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}
	.edit-mode input:focus {
		border-color: #f472b6;
	}
	input.error {
		border-color: #ef4444;
		background: rgba(239, 68, 68, 0.05);
	}

	.error-msg {
		font-size: 0.65rem;
		color: #ef4444;
		font-weight: bold;
		margin-top: 0.25rem;
	}
	.hint {
		font-size: 0.65rem;
		color: #444;
		font-style: italic;
	}
	.group-label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #444;
		letter-spacing: 1px;
	}
	.position-row {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0.5rem;
	}
	.coord-field {
		flex: 1 1 5rem;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #f472b6;
	}
	.coord-field input {
		width: 100%;
		min-width: 0;
		padding: 0.75rem;
	}
	.btn-move {
		flex: 1 1 100%;
		background: transparent;
		border: 1px solid #f472b6;
		color: #f472b6;
	}
	.btn-move:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.number-input-wrapper {
		position: relative;
	}
	.laser-accent {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 0%;
		height: 2px;
		background: #f472b6;
		transition: width 0.3s ease;
	}
	input:focus + .laser-accent {
		width: 100%;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.actions button {
		flex: 1 1 auto;
	}

	button {
		padding: 0.75rem 1.25rem;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 900;
		font-size: 0.8rem;
		letter-spacing: 1px;
		transition: all 0.2s;
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid #444;
		color: #888;
	}
	.btn-cancel:hover {
		color: #fff;
		border-color: #666;
		background: rgba(255, 255, 255, 0.05);
	}

	.btn-save {
		background: #2dd4bf;
		border: none;
		color: #000;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
	}
	.edit-mode .btn-save {
		background: #f472b6;
		box-shadow: 0 0 15px rgba(244, 114, 182, 0.3);
	}
	.btn-save:hover {
		transform: scale(1.05);
		box-shadow: 0 0 25px rgba(45, 212, 191, 0.5);
	}
	.edit-mode .btn-save:hover {
		box-shadow: 0 0 25px rgba(244, 114, 182, 0.5);
	}
</style>
