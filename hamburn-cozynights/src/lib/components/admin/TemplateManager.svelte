<!--
@component
The admin's template tools: export the camp layout as JSON, import one (superusers).
-->
<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';

	export let isSuperuser = false;

	const dispatch = createEventDispatcher<{ close: void }>();
	const close = () => dispatch('close');

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
				'☢️ NUCLEAR WARNING ☢️\n\nImporting a template will PERMANENTLY ERASE:\n- All current Houses\n- All current Rooms\n- All current Beds and the bookings on them\n\nTicket codes are kept, so guests can book again afterwards.\n\nThis cannot be undone. Are you absolutely sure the playa is ready for a reset?'
			)
		) {
			cancel();
			return;
		}

		isImporting = true;
		return async ({ result, update }) => {
			isImporting = false;
			if (result.type === 'success') {
				close();
				alert('✨ PLAYA REBORN: Template applied successfully.');
			}
			await update();
		};
	};
</script>

<section class="templates-overlay" in:fade out:fade>
	<div class="templates-content" in:fly={{ y: 20 }}>
		<div class="modal-header">
			<h2>Burn Template Manager</h2>
			<button class="btn-close" on:click={close}>✕</button>
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

			{#if isSuperuser}
				<div class="tool-card import-card">
					<div class="icon">🌀</div>
					<h3>Import New Layout</h3>
					<p>
						Wipe all houses, rooms and beds and rebuild the playa from a JSON template. Ticket codes
						are kept, existing bookings are released. <strong
							>Warning: This replaces the whole layout!</strong
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
						<button
							type="submit"
							class="btn-action danger"
							disabled={isImporting || !selectedFileName}
						>
							{isImporting ? 'IGNITING...' : 'APPLY TEMPLATE 🔥'}
						</button>
					</form>
				</div>
			{:else}
				<div class="tool-card import-card">
					<div class="icon">🔒</div>
					<h3>Import New Layout</h3>
					<p>
						Importing a template replaces all houses, rooms and beds. Only superusers can do this.
					</p>
				</div>
			{/if}
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

<style>
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
