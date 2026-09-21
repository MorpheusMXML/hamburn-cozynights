<!--
@component
Renders the app's own alert/confirm dialogs and toasts (see `$lib/dialogs`).
Mounted once in the root layout.
-->
<script lang="ts">
	import { dialogQueue, toasts, settleDialog, dismissToast } from '$lib/dialogs';
	import { fade, fly } from 'svelte/transition';
	import { tick } from 'svelte';

	$: current = $dialogQueue[0];

	let primaryButton: HTMLButtonElement | undefined;
	let altButton: HTMLButtonElement | undefined;
	let cancelButton: HTMLButtonElement | undefined;
	let previouslyFocused: HTMLElement | null = null;
	let shownId: number | null = null;

	// Focus moves into the dialog when it opens and back when it closes. A
	// destructive confirm starts on "cancel", so Enter can't confirm by accident.
	$: void syncFocus(current?.id ?? null);

	async function syncFocus(id: number | null) {
		if (id === shownId || typeof document === 'undefined') return;
		if (shownId === null) previouslyFocused = document.activeElement as HTMLElement | null;
		shownId = id;
		await tick();
		if (id === null) {
			previouslyFocused?.focus?.();
			previouslyFocused = null;
			return;
		}
		const safeStart = current?.kind === 'confirm' && current.tone === 'danger';
		(safeStart ? cancelButton : primaryButton)?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!current) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			settleDialog(current.id, 'cancel');
		} else if (event.key === 'Tab') {
			// Three buttons at most: keep the focus inside the dialog.
			const buttons = [cancelButton, altButton, primaryButton].filter(
				Boolean
			) as HTMLButtonElement[];
			if (buttons.length === 0) return;
			event.preventDefault();
			const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
			const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
			buttons[next].focus();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if current}
	<div class="dialog-backdrop" transition:fade={{ duration: 120 }}>
		<div
			class="dialog-card {current.tone}"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby={current.title ? 'app-dialog-title' : undefined}
			aria-describedby="app-dialog-message"
			in:fly={{ y: 16, duration: 160 }}
		>
			{#if current.title}
				<h2 id="app-dialog-title">{current.title}</h2>
			{/if}
			<p id="app-dialog-message">{current.message}</p>
			<div class="dialog-actions">
				{#if current.kind === 'confirm'}
					<button
						type="button"
						class="dialog-btn ghost"
						bind:this={cancelButton}
						on:click={() => settleDialog(current.id, 'cancel')}
					>
						{current.cancelLabel}
					</button>
				{/if}
				{#if current.altLabel}
					<button
						type="button"
						class="dialog-btn alt"
						bind:this={altButton}
						on:click={() => settleDialog(current.id, 'alt')}
					>
						{current.altLabel}
					</button>
				{/if}
				<button
					type="button"
					class="dialog-btn primary"
					bind:this={primaryButton}
					on:click={() => settleDialog(current.id, 'confirm')}
				>
					{current.confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}

<div class="toast-stack" aria-live="polite">
	{#each $toasts as entry (entry.id)}
		<div class="toast {entry.tone}" role="status" transition:fly={{ y: 12, duration: 160 }}>
			<span>{entry.message}</span>
			<button type="button" aria-label="Dismiss message" on:click={() => dismissToast(entry.id)}>
				&times;
			</button>
		</div>
	{/each}
</div>

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(4px);
	}

	.dialog-card {
		--accent: #2dd4bf;
		width: min(100%, 440px);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		padding: 1.5rem;
		border-radius: 16px;
		border: 1px solid var(--accent);
		background: #0b0b0b;
		color: #f5f5f5;
		box-shadow: 0 0 40px color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.dialog-card.success {
		--accent: #4ade80;
	}
	.dialog-card.warning {
		--accent: #fb923c;
	}
	.dialog-card.danger {
		--accent: #f87171;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--accent);
	}

	p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.5;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.dialog-btn {
		min-height: 44px;
		padding: 0.6rem 1.25rem;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 800;
		letter-spacing: 0.5px;
		cursor: pointer;
	}
	.dialog-btn.ghost {
		background: transparent;
		border: 1px solid #444;
		color: #ccc;
	}
	.dialog-btn.alt {
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
	}
	.dialog-btn.primary {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: #050505;
	}
	.dialog-btn:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.toast-stack {
		position: fixed;
		left: 50%;
		bottom: max(1rem, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 10001;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(calc(100vw - 2rem), 480px);
		pointer-events: none;
	}

	.toast {
		--accent: #2dd4bf;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid var(--accent);
		background: rgba(10, 10, 10, 0.96);
		color: #f5f5f5;
		font-size: 0.9rem;
		line-height: 1.4;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		pointer-events: auto;
	}
	.toast.success {
		--accent: #4ade80;
	}
	.toast.warning {
		--accent: #fb923c;
	}
	.toast.danger {
		--accent: #f87171;
	}
	.toast span {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.toast button {
		background: none;
		border: none;
		color: #999;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.25rem;
	}
</style>
