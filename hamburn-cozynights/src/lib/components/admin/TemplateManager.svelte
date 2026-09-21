<!--
@component
The admin's template tools: export the camp layout as JSON, and compare a
template file with the camp. The review shows every difference as a tree of
houses ▸ rooms ▸ spots; superusers pick what to take over and apply it in
Staging Mode. Unchanged spots keep their bookings.
-->
<script lang="ts">
	import type { ActionResult } from '@sveltejs/kit';
	import { applyAction, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher, tick } from 'svelte';
	import { alertDialog, confirmDialog, dialogQueue } from '$lib/dialogs';
	import { parseTemplate, TEMPLATE_LIMITS, type TemplateSummary } from '$lib/template';
	import {
		changeKeys,
		describePlan,
		planChanges,
		planSize,
		type ApplyOutcome,
		type LayoutDiff,
		type LayoutPlan
	} from '$lib/template-diff';
	import DropZone from './DropZone.svelte';
	import LayoutReview from './LayoutReview.svelte';

	export let isSuperuser = false;
	/** Why applying has to wait (the layout is locked), '' while it can be applied. */
	export let lockedNote = '';

	const EXAMPLE_URL = '/templates/brahmsee-starter.json';

	interface Review {
		name: string;
		summary: TemplateSummary;
		warnings: string[];
		diff: LayoutDiff;
		selection: string[];
		/** Why this admin can only look (regular admin, Live Booking); '' = may apply. */
		lockedReason: string;
	}

	const dispatch = createEventDispatcher<{ close: void }>();

	let busy: 'checking' | 'importing' | null = null;
	let isExporting = false;
	let exportNote: { fileName: string; line: string; problems: string[] } | null = null;

	let selectedFile: File | null = null;
	// Exactly the text that was checked is imported, even if the file changes on disk.
	let checkedText: string | null = null;
	let review: Review | null = null;
	let selection = new Set<string>();
	let errors: string[] = [];
	let errorTitle = '';
	// Only promised when the server said so: after a broken connection nobody knows.
	let campUnchangedHint = false;
	let backupFailed = false;
	let skipBackup = false;
	let applied: ApplyOutcome | null = null;
	let reviewSection: HTMLElement;

	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	const layoutLine = (counts: { houses: number; rooms: number; beds: number }) =>
		`${plural(counts.houses, 'house')} · ${plural(counts.rooms, 'room')} · ${plural(counts.beds, 'spot')}`;

	$: applicable = review ? changeKeys(review.diff).length : 0;
	$: plan = review ? planChanges(review.diff, selection) : null;
	$: steps = plan ? planSize(plan) : 0;
	$: planLines = plan ? describePlan(plan) : [];
	$: releases = plan ? plan.removeSpots.filter((spot) => spot.booked).length : 0;
	$: canApply = !!review && !review.lockedReason && steps > 0 && busy === null;

	function close() {
		if (busy !== 'importing') dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		// An open confirm dialog handles Escape itself.
		if (event.key === 'Escape' && $dialogQueue.length === 0) close();
	}

	function resetCheck() {
		review = null;
		selection = new Set();
		errors = [];
		campUnchangedHint = false;
		backupFailed = false;
		skipBackup = false;
	}

	function showErrors(title: string, problems: string[], unchangedHint = false) {
		errorTitle = title;
		errors = problems;
		campUnchangedHint = unchangedHint;
	}

	const fileProblems = (problems: string[]) =>
		showErrors(`This file can't be used (${plural(problems.length, 'problem')})`, problems, true);

	async function post(action: string, form: FormData): Promise<ActionResult> {
		try {
			const response = await fetch(`/admin?/${action}`, {
				method: 'POST',
				body: form,
				headers: { 'x-sveltekit-action': 'true', accept: 'application/json' }
			});
			// The `data` of an action response is devalue-encoded.
			return deserialize(await response.text());
		} catch (err) {
			return { type: 'error', error: err };
		}
	}

	function templateForm(): FormData {
		const form = new FormData();
		form.set(
			'template',
			new Blob([checkedText ?? ''], { type: 'application/json' }),
			selectedFile?.name ?? 'template.json'
		);
		return form;
	}

	async function handleExportTemplate() {
		isExporting = true;
		exportNote = null;
		try {
			const response = await fetch('/admin/api/export-template');
			const isJson = response.headers.get('content-type')?.includes('application/json');
			if (!response.ok || !isJson) throw new Error(`HTTP ${response.status}`);

			const text = await response.text();
			const fileName =
				/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
				`cozynights-layout-${new Date().toISOString().slice(0, 10)}.json`;

			const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = fileName;
			document.body.appendChild(link);
			link.click();
			link.remove();
			// Safari still reads the blob after click() returns.
			setTimeout(() => URL.revokeObjectURL(url), 30_000);

			// The editor allows things the import refuses (two houses with the same
			// name, …). Better to hear about it now than when the file is needed.
			const check = parseTemplate(text);
			exportNote = check.ok
				? { fileName, line: layoutLine(check.summary), problems: [] }
				: { fileName, line: '', problems: check.errors };
		} catch (err) {
			console.error('[Export] Error:', err);
			await alertDialog(
				'The layout could not be downloaded. Reload the page (your session may have expired) and try again.',
				{ title: 'Export failed', tone: 'danger' }
			);
		} finally {
			isExporting = false;
		}
	}

	/** A file was picked or dropped: compare it with the camp right away. */
	async function handleFile(event: CustomEvent<File>) {
		selectedFile = event.detail;
		applied = null;
		resetCheck();
		if (selectedFile.size > TEMPLATE_LIMITS.fileBytes) {
			fileProblems([
				`The file is ${Math.ceil(selectedFile.size / 1024)} KB, templates are limited to ${TEMPLATE_LIMITS.fileBytes / 1024} KB. A layout file is usually far smaller, so this is probably the wrong file.`
			]);
			return;
		}
		try {
			checkedText = await selectedFile.text();
		} catch {
			showErrors('File not readable', [
				'The file could not be read. If you changed or moved it after choosing it, choose it again.'
			]);
			return;
		}
		await compare();
	}

	async function compare() {
		busy = 'checking';
		const result = await post('previewTemplate', templateForm());
		busy = null;
		if (result.type === 'success') {
			review = result.data?.review as Review;
			selection = new Set(review.selection);
			// The review is below both cards: bring it into view.
			await tick();
			reviewSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} else if (result.type === 'failure') {
			const data = result.data as { error?: string; errors?: string[] } | undefined;
			const problems = data?.errors ?? [
				data?.error ?? `The server refused the file (${result.status}).`
			];
			if (result.status === 400) fileProblems(problems);
			else showErrors('Check not possible', problems);
		} else if (result.type === 'error') {
			showErrors('Connection problem', [
				`The file could not be sent to the server (${(result.error as Error)?.message ?? 'no connection'}). Check your connection and try again.`
			]);
		} else {
			await applyAction(result);
		}
	}

	function confirmText(current: LayoutPlan): string {
		const lines = describePlan(current);
		const bookings =
			releases > 0
				? `${plural(releases, 'booking')} will be released: those guests are told by e-mail and have to book again.`
				: 'No booking is affected.';
		return (
			`From "${selectedFile?.name ?? 'the file'}":\n${lines.map((line) => `• ${line}`).join('\n')}\n\n` +
			`${bookings} Ticket codes stay valid.\n\n` +
			(skipBackup
				? 'No backup will be made, so this cannot be undone.'
				: 'A backup of the database is made first, so a superuser can undo this.')
		);
	}

	async function apply() {
		if (!review || !plan || !canApply) return;
		const removes =
			plan.removeHouses.length + plan.removeRooms.length + plan.removeSpots.length > 0;
		if (removes || skipBackup) {
			const confirmed = await confirmDialog(confirmText(plan), {
				title: removes ? 'Remove parts of the camp?' : 'Apply without a backup?',
				tone: 'danger',
				confirmLabel: `Apply ${plural(steps, 'change')}`,
				cancelLabel: 'Back to the review'
			});
			if (!confirmed) return;
		}

		const form = templateForm();
		form.set('selection', JSON.stringify([...selection]));
		if (skipBackup) form.set('skipBackup', '1');
		busy = 'importing';
		const result = await post('importTemplate', form);
		busy = null;

		if (result.type === 'success') {
			applied = result.data?.applied as ApplyOutcome;
			backupFailed = false;
			skipBackup = false;
			// Reloads the map behind this window, then shows what is left to do.
			await invalidateAll();
			await compare();
		} else if (result.type === 'failure') {
			const data = result.data as
				{ error?: string; errors?: string[]; backupFailed?: boolean } | undefined;
			backupFailed = data?.backupFailed === true;
			showErrors(
				'Nothing was imported',
				data?.errors ?? [data?.error ?? `The server refused (${result.status}).`]
			);
			await invalidateAll();
		} else if (result.type === 'error') {
			showErrors('Connection problem', [
				'The connection broke while the import was running, so its result is unknown. Close this window and check the map before you try again.'
			]);
			await invalidateAll();
		} else {
			await applyAction(result);
		}
	}

	$: totals = applied
		? {
				created: applied.created.houses + applied.created.rooms + applied.created.spots,
				updated: applied.updated.houses + applied.updated.rooms + applied.updated.spots,
				removed: applied.removed.houses + applied.removed.rooms + applied.removed.spots
			}
		: null;
</script>

<svelte:window on:keydown={handleKeydown} />

<div
	class="templates-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="templates-title"
	in:fade
	out:fade
>
	<div class="templates-content" in:fly={{ y: 20 }}>
		<div class="modal-header">
			<h2 id="templates-title">Burn Template Manager</h2>
			<button class="btn-close" type="button" aria-label="Close template manager" on:click={close}>
				✕
			</button>
		</div>

		<div class="templates-grid">
			<div class="tool-card export-card">
				<div class="icon">📡</div>
				<h3>Export Current Layout</h3>
				<p>
					Download all houses with their map positions, rooms and spots as one JSON file. It
					contains no bookings, ticket codes or names.
				</p>
				<button
					class="btn-action"
					type="button"
					on:click={handleExportTemplate}
					disabled={isExporting}
				>
					{isExporting ? 'ENCODING...' : 'DOWNLOAD JSON 💾'}
				</button>

				{#if exportNote}
					<div class="note" class:bad={exportNote.problems.length > 0} role="status" in:fade>
						{#if exportNote.problems.length === 0}
							<strong>Saved {exportNote.fileName}</strong>
							<span>{exportNote.line}</span>
						{:else}
							<strong>Saved, but the import would refuse this file:</strong>
							<ul>
								{#each exportNote.problems as problem}
									<li>{problem}</li>
								{/each}
							</ul>
							<span>Fix this in the editor, then download again.</span>
						{/if}
					</div>
				{/if}

				<details class="howto">
					<summary>How to build a starting layout</summary>
					<ol>
						<li>In Staging Mode, place your houses on the map and add their rooms and spots.</li>
						<li>Download the layout and keep the file somewhere safe, e.g. the team drive.</li>
						<li>
							Next time (or on a fresh database) drop that file on Compare &amp; Import and apply
							what you need.
						</li>
					</ol>
					<a href={EXAMPLE_URL} download="brahmsee-starter.json">Download example template</a>
				</details>

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
				<h3>Compare &amp; Import</h3>
				<p>
					Drop a layout file: you see what differs from your camp and pick what to take over.
					Nothing changes before you apply, and unchanged spots keep their bookings.
					{#if !isSuperuser}<strong>Applying is for superusers.</strong>
					{:else if lockedNote}<strong class="lock-note">🔒 {lockedNote}</strong>{/if}
				</p>

				<DropZone
					accept=".json,application/json"
					label="Drop a layout file here"
					hint="or tap to choose one · it is compared right away"
					fileName={selectedFile?.name ?? ''}
					busy={busy === 'checking'}
					disabled={busy === 'importing'}
					on:file={handleFile}
				/>

				{#if errors.length > 0}
					<div class="note bad" role="alert">
						<strong>{errorTitle}</strong>
						<ul>
							{#each errors as problem}
								<li>{problem}</li>
							{/each}
						</ul>
						{#if campUnchangedHint}
							<span>Fix the file, then choose it again. Your camp was not changed.</span>
						{/if}
					</div>
				{/if}

				{#if applied && totals}
					<div class="note good" role="status" in:fade>
						<strong>✨ Applied</strong>
						<span>
							{totals.created} created · {totals.updated} changed · {totals.removed} removed{applied.skipped
								? ` · ${applied.skipped} no longer needed`
								: ''}.
						</span>
						<span class="dim">
							{applied.releasedBookings > 0
								? `${plural(applied.releasedBookings, 'booking')} released; those guests are told. `
								: ''}All ticket codes still work.
						</span>
						<span class="dim">
							{#if applied.backup}
								Backup made first: <code>{applied.backup}</code>. A superuser can restore it in the
								PocketBase dashboard under Settings → Backups.
							{:else}
								No backup was made.
							{/if}
						</span>
						{#each applied.problems as problem}<span class="alarm">{problem}</span>{/each}
						{#if !applied.namesCleared}
							<span class="alarm">
								Some burner names of the released bookings could not be deleted. They are not shown
								anywhere, but should go: apply the file again, or ask an operator (server log:
								"[Template import]").
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if review}
			<section
				class="review-section"
				bind:this={reviewSection}
				in:fade={{ duration: 150 }}
				aria-labelledby="review-title"
			>
				<div class="review-head">
					<h3 id="review-title">Review: “{review.name}”</h3>
					<span class="dim">
						The file has {layoutLine(review.summary)}{review.summary.specialBeds
							? ` · ${review.summary.specialBeds} special-needs`
							: ''}
					</span>
				</div>

				{#if review.lockedReason}
					<p class="locked">🔒 {review.lockedReason}</p>
				{/if}

				{#if review.warnings.length > 0}
					<details class="note warn">
						<summary><strong>Good to know ({review.warnings.length})</strong></summary>
						<ul>
							{#each review.warnings as warning}
								<li>{warning}</li>
							{/each}
						</ul>
					</details>
				{/if}

				<LayoutReview diff={review.diff} bind:selection readOnly={!!review.lockedReason} />

				{#if !review.lockedReason && applicable > 0}
					<div class="apply-bar">
						<div class="apply-text">
							{#if steps === 0}
								<span>Nothing chosen.</span>
							{:else}
								{#each planLines as line}<span>{line}</span>{/each}
								{#if releases > 0}
									<span class="alarm">⚠️ {plural(releases, 'booking')} will be released</span>
								{/if}
							{/if}
						</div>
						{#if backupFailed}
							<label class="skip-backup">
								<input type="checkbox" bind:checked={skipBackup} />
								Apply without a backup. It can't be undone then.
							</label>
						{/if}
						<button
							type="button"
							class="btn-action"
							class:danger={releases > 0 || (plan?.removeHouses.length ?? 0) > 0}
							disabled={!canApply}
							on:click={apply}
						>
							{busy === 'importing'
								? 'APPLYING…'
								: `APPLY ${steps} CHANGE${steps === 1 ? '' : 'S'} 🔥`}
						</button>
					</div>
				{/if}
			</section>
		{/if}
	</div>

	{#if busy === 'importing'}
		<div class="loading-overlay" role="status" in:fade>
			<div class="spinner"></div>
			<p>REBUILDING THE PLAYA STRUCTURE...</p>
			<small>Keep this window open until it is done.</small>
		</div>
	{/if}
</div>

<style>
	.templates-overlay {
		position: fixed;
		inset: 0;
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
		max-height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 3rem;
		box-shadow: 0 50px 100px rgba(0, 0, 0, 0.8);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2.5rem;
	}
	.modal-header h2 {
		font-size: 2.5rem;
		font-weight: 900;
		letter-spacing: -1px;
		line-height: 1.1;
		margin: 0;
	}
	.btn-close {
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		background: transparent;
		border: none;
		color: #888;
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
		align-items: start;
	}

	.tool-card {
		position: relative;
		min-width: 0;
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
		color: #999;
		font-size: 0.9rem;
		line-height: 1.6;
		margin: 0;
	}
	.tool-card p strong {
		color: #ddd;
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
	.btn-action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	/* Summaries, warnings and errors */
	.note {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem 1.1rem;
		border: 1px solid #2a2a2a;
		border-left: 4px solid #2dd4bf;
		border-radius: 12px;
		background: #080808;
		color: #e5e5e5;
		font-size: 0.85rem;
		line-height: 1.5;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.note strong {
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #2dd4bf;
	}
	.note strong:not(:first-child) {
		margin-top: 0.6rem;
	}
	.note ul {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.note.warn {
		border-left-color: #fb923c;
	}
	.note.warn strong {
		color: #fb923c;
	}
	.note.bad {
		border-left-color: #ef4444;
	}
	.note.bad strong,
	.note .alarm {
		color: #f87171;
	}
	.note.good {
		border-left-color: #4ade80;
	}
	.note.good strong {
		color: #4ade80;
	}
	.note code {
		font-family: 'JetBrains Mono', monospace;
		color: #fff;
	}
	.dim {
		color: #999;
	}

	.skip-backup {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		text-align: left;
		font-size: 0.85rem;
		line-height: 1.4;
		color: #fca5a5;
		cursor: pointer;
	}
	.skip-backup input {
		margin-top: 0.15rem;
		flex-shrink: 0;
	}

	.howto {
		width: 100%;
		text-align: left;
		border-top: 1px solid #222;
		padding-top: 1.25rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #999;
	}
	.howto summary {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 36px;
		cursor: pointer;
		list-style: none;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #ccc;
	}
	.howto summary::-webkit-details-marker {
		display: none;
	}
	.howto summary::before {
		content: '+';
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #333;
		color: #2dd4bf;
		font-size: 0.95rem;
	}
	.howto[open] summary::before {
		content: '−';
	}
	.howto[open] summary {
		margin-bottom: 0.6rem;
	}
	.howto ol {
		margin: 0 0 0.9rem;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: decimal;
	}
	.howto a {
		color: #2dd4bf;
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	/* The review below both cards */
	.review-section {
		margin-top: 2rem;
		padding-top: 1.5rem;
		border-top: 1px solid #222;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.review-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 1rem;
	}
	.review-head h3 {
		margin: 0;
		font-weight: 900;
		font-size: 1.2rem;
		letter-spacing: -0.3px;
		overflow-wrap: anywhere;
	}
	.lock-note {
		color: #fb923c;
	}
	.locked {
		margin: 0;
		padding: 0.8rem 1rem;
		border: 1px solid #3a2a12;
		border-radius: 12px;
		background: rgba(251, 146, 60, 0.07);
		color: #fdba74;
		font-size: 0.85rem;
		line-height: 1.5;
	}
	details.note summary {
		cursor: pointer;
		list-style: none;
	}
	details.note summary::-webkit-details-marker {
		display: none;
	}
	details.note summary::before {
		content: '+ ';
		color: #fb923c;
		font-weight: 900;
	}
	details.note[open] summary::before {
		content: '− ';
	}
	.apply-bar {
		position: sticky;
		bottom: -3rem;
		z-index: 3;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem 1.2rem;
		padding: 1rem 1.1rem;
		background: rgba(10, 10, 10, 0.96);
		backdrop-filter: blur(8px);
		border: 1px solid #2dd4bf;
		border-radius: 16px;
		box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.6);
	}
	.apply-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
		color: #ccc;
		text-align: left;
	}
	.apply-text .alarm {
		color: #f87171;
		font-weight: 700;
	}
	.apply-bar .btn-action {
		width: auto;
		padding: 1rem 1.6rem;
	}

	/* Whole-screen overlay while the import runs */
	.loading-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.92);
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		padding: 1rem;
		text-align: center;
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
		color: #999;
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

	@media (max-width: 760px) {
		.templates-overlay {
			padding: 0;
			align-items: stretch;
		}
		.templates-content {
			max-height: 100dvh;
			border-radius: 0;
			border-left: none;
			border-right: none;
			padding: 1.25rem 1rem 2rem;
		}
		.modal-header {
			margin-bottom: 1.5rem;
		}
		.modal-header h2 {
			font-size: 1.6rem;
		}
		.templates-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
		.tool-card {
			padding: 1.5rem 1.1rem;
			gap: 1.1rem;
		}
		.tool-card .icon {
			font-size: 2.2rem;
		}
		.apply-bar {
			bottom: -2rem;
		}
		.apply-bar .btn-action {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner,
		.bit {
			animation-duration: 3s;
		}
		.btn-action:hover:not(:disabled) {
			transform: none;
		}
	}
</style>
