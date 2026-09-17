<script lang="ts">
	import { slide, fade, fly } from 'svelte/transition';
	import AddRoomForm from './AddRoomForm.svelte';
	import AddBedForm from './AddBedForm.svelte';

	export let warnings: Array<{
		id: string;
		name: string;
		noRooms: boolean;
		roomsWithNoBeds: Array<{
			id: string;
			name: string;
			number: number;
		}>;
	}>;

	$: hasWarnings = warnings.length > 0;

	let activeModal: 'house' | 'room' | null = null;
	let activeId: string | null = null;
	let activeName: string | null = null;
	let isSubmitting = false;
	let errorMessage: string | null = null;

	function openModal(type: 'house' | 'room', id: string, name: string) {
		activeModal = type;
		activeId = id;
		activeName = name;
		errorMessage = null;
	}

	function closeModal() {
		if (isSubmitting) return;
		activeModal = null;
		activeId = null;
		activeName = null;
		errorMessage = null;
	}
</script>

{#if hasWarnings}
	<div class="sanity-wrapper" transition:slide>
		<header class="sanity-header">
			<span class="alert-icon">⚠️</span>
			<h3>RED ALERT: ARCHITECTURAL DEVIATIONS</h3>
			<span class="count">{warnings.length} ISSUES DETECTED</span>
		</header>

		<div class="tree-container">
			{#each warnings as warning}
				<div class="house-node">
					<div class="node-content">
						<span class="icon">🛖</span>
						<span class="name">{warning.name}</span>
						{#if warning.noRooms}
							<span class="error-tag">NO ROOMS DETECTED</span>
							<button class="fix-btn" on:click={() => openModal('house', warning.id, warning.name)}>
								SOLVE ISSUE NOW ⚡️
							</button>
						{/if}
					</div>

					{#if warning.roomsWithNoBeds.length > 0}
						<div class="children">
							{#each warning.roomsWithNoBeds as room}
								<div class="room-node">
									<div class="node-content">
										<span class="icon">🚪</span>
										<span class="name">{room.name || `Room ${room.number}`}</span>
										<span class="error-tag">EMPTY MODULE (NO BEDS)</span>
										<button
											class="fix-btn"
											on:click={() => openModal('room', room.id, room.name || `Room ${room.number}`)}
										>
											SOLVE ISSUE NOW ⚡️
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if activeModal}
	<div class="modal-backdrop" on:mousedown={closeModal} in:fade out:fade>
		<div class="modal-content" on:mousedown|stopPropagation in:fly={{ y: 20 }}>
			<header class="modal-header">
				<h2>FIXING: {activeName}</h2>
				<button class="btn-close" on:click={closeModal} disabled={isSubmitting}>✕</button>
			</header>
			<div class="modal-body">
				{#if errorMessage}
					<div class="error-banner" in:slide>
						<span>⚠️</span>
						<p>{errorMessage}</p>
					</div>
				{/if}

				{#if activeModal === 'house' && activeId}
					<p class="hint">Ignite a new module for this sanctuary.</p>
					<AddRoomForm
						houseId={activeId}
						actionBase={`/admin/house/${activeId}`}
						disabled={isSubmitting}
						on:submitting={handleFormStart}
						on:result={handleFormResult}
						on:success={closeModal}
					/>
				{:else if activeModal === 'room' && activeId}
					<p class="hint">Define a spot label for this room.</p>
					<AddBedForm
						roomId={activeId}
						actionBase={`/admin/room/${activeId}`}
						disabled={isSubmitting}
						on:submitting={handleFormStart}
						on:result={handleFormResult}
						on:success={closeModal}
					/>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(8px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.modal-content {
		background: #0a0a0a;
		border: 1px solid #333;
		border-top: 2px solid #2dd4bf;
		border-radius: 16px;
		width: 95%;
		max-width: 500px;
		padding: 2.5rem;
		box-shadow: 0 30px 60px rgba(0, 0, 0, 0.8);
		position: relative;
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid #222;
		padding-bottom: 1rem;
		margin-bottom: 2rem;
	}
	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: #2dd4bf;
		font-weight: 900;
		letter-spacing: 1px;
	}
	.btn-close {
		background: none;
		border: none;
		color: #444;
		font-size: 1.5rem;
		cursor: pointer;
		transition: color 0.2s;
	}
	.btn-close:hover {
		color: #fff;
	}
	.hint {
		color: #666;
		font-size: 0.8rem;
		margin-bottom: 1.5rem;
		font-weight: bold;
		letter-spacing: 0.5px;
	}

	.error-banner {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid #ef4444;
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		color: #f87171;
		font-size: 0.85rem;
		font-weight: bold;
	}
	.error-banner p {
		margin: 0;
	}

	.sanity-wrapper {
		background: rgba(239, 68, 68, 0.05);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 12px;
		margin-bottom: 2rem;
		overflow: hidden;
	}
	.sanity-header {
		background: rgba(239, 68, 68, 0.1);
		padding: 0.75rem 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		border-bottom: 1px solid rgba(239, 68, 68, 0.1);
	}
	.sanity-header h3 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2px;
		color: #f87171;
		flex: 1;
	}
	.count {
		font-size: 0.6rem;
		font-weight: 900;
		background: #f87171;
		color: #000;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.tree-container {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.node-content {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0;
	}
	.name {
		font-weight: 900;
		font-size: 0.85rem;
		color: #fff;
	}
	.error-tag {
		font-size: 0.65rem;
		color: #f87171;
		font-weight: bold;
		letter-spacing: 0.5px;
	}

	.fix-btn {
		margin-left: auto;
		font-size: 0.6rem;
		font-weight: 900;
		color: #2dd4bf;
		text-decoration: none;
		border: 1px solid #2dd4bf;
		padding: 4px 10px;
		border-radius: 4px;
		transition: all 0.2s;
		background: transparent;
		cursor: pointer;
	}
	.fix-btn:hover {
		background: #2dd4bf;
		color: #000;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
	}

	.children {
		margin-left: 1.5rem;
		padding-left: 1.5rem;
		border-left: 1px dashed #333;
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.room-node {
		position: relative;
	}
	.room-node::before {
		content: '';
		position: absolute;
		top: 50%;
		left: -1.5rem;
		width: 1rem;
		height: 1px;
		background: #333;
	}
</style>
