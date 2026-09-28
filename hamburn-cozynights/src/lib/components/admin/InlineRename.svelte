<script lang="ts">
	/**
	 * A name the crew changes by clicking it (docs/admin/camp-layout.md,
	 * "Renaming"): in Staging Mode the title is a button, and a click turns it
	 * into a field with ✓ save and ✕ cancel. Enter saves, Esc cancels, an
	 * unchanged name just closes; a room edits its number next to its name.
	 * While booking is live or closed the title stays plain text: names belong
	 * to the layout, and the layout is locked then (the server checks too).
	 *
	 * Only phrasing elements (button, input, span), so it may sit inside a
	 * heading; that is also why it posts with fetch instead of a <form> —
	 * the way SvelteKit documents a custom submit (x-sveltekit-action).
	 */
	import { tick, type Snippet } from 'svelte';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/dialogs';

	let {
		value,
		action,
		what,
		editable = false,
		id = '',
		field = 'name',
		maxLength = 100,
		number = undefined,
		numberMax = 9999,
		children
	}: {
		/** The name as it is stored. */
		value: string;
		/** The form action that renames, e.g. "?/renameRoom". */
		action: string;
		/** What is renamed, in words: "house", "room", "spot". */
		what: string;
		/** Staging Mode: the title can be clicked. */
		editable?: boolean;
		/** The record, when the action has to be told which one (a spot). */
		id?: string;
		/** The form field of the name: "name", or "label" for a spot. */
		field?: string;
		maxLength?: number;
		/** A room's number, edited next to its name. */
		number?: number;
		numberMax?: number;
		/** The title as it looks while nobody edits it. */
		children: Snippet;
	} = $props();

	let editing = $state(false);
	let saving = $state(false);
	let error = $state('');
	let draft = $state('');
	let draftNumber = $state('');
	let nameInput: HTMLInputElement | undefined = $state();
	let trigger: HTMLButtonElement | undefined = $state();

	const withNumber = $derived(number !== undefined);

	async function open() {
		draft = value;
		draftNumber = withNumber ? String(number) : '';
		error = '';
		editing = true;
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	async function close() {
		editing = false;
		saving = false;
		error = '';
		await tick();
		trigger?.focus();
	}

	/** "Villa", or "Ground Floor 1 #1" for a room. */
	const shown = (name: string, num: string) => (withNumber ? `${name} #${num}` : name);

	async function save() {
		if (saving) return;
		const name = draft.trim();
		const num = draftNumber.trim();
		if (name === value.trim() && (!withNumber || num === String(number))) {
			await close();
			return;
		}
		saving = true;
		error = '';
		const body = new FormData();
		if (id) body.append('id', id);
		body.append(field, name);
		if (withNumber) body.append('room_number', num);
		try {
			const response = await fetch(action, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				await invalidateAll();
				toast(`✏️ Renamed to "${shown(name, num)}".`, 'success');
				await close();
				return;
			}
			const data = result.type === 'failure' ? (result.data as Record<string, unknown>) : {};
			error =
				(typeof data?.message === 'string' && data.message) ||
				(typeof data?.error === 'string' && data.error) ||
				`The ${what} was not renamed. Reload the page and try again.`;
		} catch {
			error = 'The server could not be reached, so nothing was saved. Try again.';
		}
		saving = false;
		await tick();
		nameInput?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			save();
		} else if (event.key === 'Escape') {
			// Not the page's own Esc (the room page leaves stacking with it).
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}
</script>

{#if editing}
	<span class="rename" role="group" aria-label="Rename the {what}">
		<input
			bind:this={nameInput}
			bind:value={draft}
			class="rename-name"
			class:short={field === 'label'}
			type="text"
			name={field}
			maxlength={maxLength}
			autocomplete="off"
			spellcheck="false"
			aria-label="Name of the {what}"
			aria-invalid={error ? 'true' : undefined}
			readonly={saving}
			onkeydown={onKeydown}
		/>
		{#if withNumber}
			<span class="rename-hash" aria-hidden="true">#</span>
			<input
				bind:value={draftNumber}
				class="rename-number"
				type="text"
				inputmode="numeric"
				name="room_number"
				maxlength={String(numberMax).length}
				autocomplete="off"
				aria-label="Number of the {what}"
				readonly={saving}
				onkeydown={onKeydown}
			/>
		{/if}
		<!-- ✓ and ✕ stay together when the field wraps on a phone. -->
		<span class="rename-actions">
			<button
				type="button"
				class="rename-icon save"
				title="Save"
				aria-label="Save the new name"
				disabled={saving}
				onclick={save}>{saving ? '…' : '✓'}</button
			>
			<button
				type="button"
				class="rename-icon cancel"
				title="Cancel (Esc)"
				aria-label="Cancel renaming"
				disabled={saving}
				onclick={close}>✕</button
			>
		</span>
		{#if error}<span class="rename-error" role="alert">⚠️ {error}</span>{/if}
	</span>
{:else if editable}
	<button
		bind:this={trigger}
		type="button"
		class="rename-title"
		title="Click to rename"
		onclick={open}
		>{@render children()}<span class="rename-cue" aria-hidden="true">✏️</span><span
			class="rename-hint">(rename)</span
		></button
	>
{:else}
	{@render children()}
{/if}

<style>
	/* The title keeps the look of the heading or label it sits in. */
	.rename-title {
		display: inline;
		font: inherit;
		color: inherit;
		letter-spacing: inherit;
		text-align: inherit;
		text-transform: inherit;
		background: none;
		border: none;
		border-radius: 6px;
		padding: 0;
		margin: 0;
		cursor: pointer;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.rename-title:hover,
	.rename-title:focus-visible {
		text-decoration: underline dotted rgba(0, 255, 224, 0.7);
		text-underline-offset: 0.18em;
	}

	.rename-title:focus-visible {
		outline: 2px solid #00ffe0;
		outline-offset: 3px;
	}

	.rename-cue {
		display: inline-block;
		margin-left: 0.3em;
		font-size: 0.55em;
		vertical-align: middle;
		opacity: 0.35;
		transition: opacity 0.15s;
	}

	.rename-title:hover .rename-cue,
	.rename-title:focus-visible .rename-cue {
		opacity: 0.9;
	}

	/* For screen readers only: the button says what it does. The same rule as
	   the app's .sr-only (clip, which the layout test recognises too). */
	.rename-hint {
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

	.rename {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		max-width: 100%;
		min-width: 0;
		vertical-align: middle;
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
	}

	.rename input {
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.45);
		border: 1px solid rgba(0, 255, 224, 0.55);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		color: #eee;
		font: inherit;
		min-width: 0;
	}

	.rename input:focus {
		outline: 2px solid #00ffe0;
		outline-offset: 1px;
	}

	.rename-name {
		flex: 1 1 12rem;
		width: 12rem;
	}

	/* A spot's label is short, and its card is narrow. */
	.rename-name.short {
		flex-basis: 6rem;
		width: 6rem;
	}

	.rename-hash {
		color: #9aa;
	}

	.rename-number {
		flex: 0 0 auto;
		width: 4.5rem;
	}

	.rename-actions {
		display: inline-flex;
		flex: none;
		gap: 0.35rem;
	}

	.rename-icon {
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 900;
		line-height: 1;
		cursor: pointer;
	}

	.rename-icon.save {
		background: linear-gradient(135deg, #00ffe0, #00b3ff);
		color: #04121a;
		border: none;
	}

	.rename-icon.cancel {
		background: rgba(255, 255, 255, 0.06);
		color: #cfd6dd;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.rename-icon:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.rename-error {
		flex: 1 0 100%;
		font-size: 0.8rem;
		font-weight: 600;
		color: #ff6b8b;
		overflow-wrap: anywhere;
	}
</style>
