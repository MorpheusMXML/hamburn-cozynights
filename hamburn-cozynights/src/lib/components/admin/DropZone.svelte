<!--
@component
A file field that also takes a dropped file. Picking or dropping a file fires
`file` right away: the caller checks it without another click.
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let accept = '';
	export let label = 'Drop a file here';
	export let hint = 'or tap to choose one';
	/** Name of the file in use, shown instead of the label. */
	export let fileName = '';
	export let busy = false;
	export let disabled = false;

	const dispatch = createEventDispatcher<{ file: File }>();
	const id = `drop-${Math.random().toString(36).slice(2, 10)}`;
	let input: HTMLInputElement;
	// dragenter/dragleave fire for every child element as well.
	let depth = 0;

	// Browsers fire no change event when the same file is chosen again, so a
	// file fixed in an editor could not be checked again: start empty each time.
	function reset() {
		input.value = '';
	}

	function changed() {
		const file = input.files?.[0];
		if (file) dispatch('file', file);
	}

	function drop(event: DragEvent) {
		depth = 0;
		const file = event.dataTransfer?.files?.[0];
		if (file && !disabled && !busy) dispatch('file', file);
	}
</script>

<div
	class="drop"
	class:dragging={depth > 0}
	class:selected={!!fileName}
	class:busy
	role="group"
	on:dragenter|preventDefault={() => depth++}
	on:dragover|preventDefault
	on:dragleave={() => (depth = Math.max(0, depth - 1))}
	on:drop|preventDefault={drop}
>
	<input
		{id}
		type="file"
		{accept}
		disabled={disabled || busy}
		bind:this={input}
		on:click={reset}
		on:change={changed}
	/>
	<label for={id}>
		<span class="drop-icon" aria-hidden="true">{busy ? '⏳' : fileName ? '📄' : '📥'}</span>
		<span class="drop-label">{fileName || label}</span>
		<span class="drop-hint">
			{busy ? 'Checking…' : fileName ? 'Drop or choose another file to check it instead' : hint}
		</span>
	</label>
</div>

<style>
	.drop {
		position: relative;
		width: 100%;
	}
	/* Hidden from view, still focusable and tappable through its label. */
	input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	label {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1.2rem 1rem;
		background: #050505;
		border: 2px dashed #3a3a3a;
		border-radius: 14px;
		color: #aaa;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.2s,
			background 0.2s;
	}
	label:hover,
	.dragging label {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.06);
		color: #e5e5e5;
	}
	input:focus-visible + label {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
	}
	.selected label {
		border-style: solid;
		border-color: #2dd4bf;
	}
	.busy label {
		cursor: progress;
		opacity: 0.8;
	}
	input:disabled + label {
		cursor: not-allowed;
	}
	.drop-icon {
		font-size: 1.6rem;
	}
	.drop-label {
		max-width: 100%;
		font-weight: 900;
		font-size: 0.85rem;
		letter-spacing: 0.5px;
		color: #fff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drop-hint {
		font-size: 0.75rem;
		color: #888;
		line-height: 1.4;
	}
</style>
