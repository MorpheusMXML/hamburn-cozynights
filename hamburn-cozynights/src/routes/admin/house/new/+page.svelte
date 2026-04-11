<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	// Extrahiere Koordinaten aus der URL (?x=880&y=373)
	$: x = $page.url.searchParams.get('x') || 0;
	$: y = $page.url.searchParams.get('y') || 0;

	let name = '';
	let description = '';

	async function createHouse() {
		const response = await fetch('?/create', {
			method: 'POST',
			body: new URLSearchParams({
				name,
				description,
				x: x.toString(),
				y: y.toString()
			})
		});

		if (response.ok) {
			// Zurück zur Admin-Übersicht nach Erfolg
			window.location.href = '/admin';
		}
	}
</script>

<div class="edit-container">
	<h1>Add New House</h1>
	<p class="coords-display">Location: 📍 X: {x} / Y: {y}</p>

	<form method="POST" action="?/create" class="edit-form">
		<input type="hidden" name="x" value={x} />
		<input type="hidden" name="y" value={y} />

		<div class="form-group">
			<label for="name">House Name</label>
			<input
				type="text"
				id="name"
				name="name"
				bind:value={name}
				placeholder="e.g. Eagle's Nest"
				required
			/>
		</div>

		<div class="form-group">
			<label for="description">Description</label>
			<textarea id="description" name="description" bind:value={description}></textarea>
		</div>

		<div class="actions">
			<a href="/admin" class="btn-cancel">Cancel</a>
			<button type="submit" class="btn-save">Save House</button>
		</div>
	</form>
</div>

<style>
	.edit-container {
		max-width: 600px;
		margin: 4rem auto;
		padding: 2rem;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
	}
	.coords-display {
		color: #4ade80;
		font-family: monospace;
		background: rgba(74, 222, 128, 0.1);
		padding: 0.5rem;
		border-radius: 4px;
		display: inline-block;
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-top: 2rem;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	input,
	textarea {
		background: #222;
		border: 1px solid #444;
		color: white;
		padding: 0.8rem;
		border-radius: 6px;
	}
	.actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
	}
	.btn-save {
		background: #22c55e;
		color: white;
		border: none;
		padding: 0.8rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-weight: bold;
	}
	.btn-cancel {
		color: #888;
		text-decoration: none;
		padding: 0.8rem;
	}
</style>
