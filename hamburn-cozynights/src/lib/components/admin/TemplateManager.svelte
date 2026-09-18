<!--
@component
The admin's template tools: export the camp layout as JSON; superusers can check
a template file and then replace the layout with it.
-->
<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	import { alertDialog, confirmDialog, dialogQueue } from '$lib/dialogs';
	import { parseTemplate, TEMPLATE_LIMITS, type TemplateSummary } from '$lib/template';

	export let isSuperuser = false;

	const EXAMPLE_URL = '/templates/brahmsee-starter.json';

	interface LayoutCounts {
		houses: number;
		rooms: number;
		beds: number;
	}
	interface Preview {
		summary: TemplateSummary;
		warnings: string[];
		current: LayoutCounts & { bookings: number };
	}
	interface ImportResult {
		summary: TemplateSummary;
		backup: string | null;
		releasedBookings: number;
		leftovers: number;
		namesCleared: boolean;
	}

	const dispatch = createEventDispatcher<{ close: void }>();

	let busy: 'checking' | 'importing' | null = null;
	let isExporting = false;
	let exportNote: { fileName: string; line: string; problems: string[] } | null = null;

	let fileInput: HTMLInputElement;
	let selectedFile: File | null = null;
	// Exactly the text that was checked is imported, even if the file changes on disk.
	let checkedText: string | null = null;
	let preview: Preview | null = null;
	let errors: string[] = [];
	let errorTitle = '';
	// Only promised when the server said so: after a broken connection nobody knows.
	let campUnchangedHint = false;
	let backupFailed = false;
	let skipBackup = false;
	let importResult: ImportResult | null = null;

	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	const layoutLine = (counts: LayoutCounts) =>
		`${plural(counts.houses, 'house')} · ${plural(counts.rooms, 'room')} · ${plural(counts.beds, 'spot')}`;

	function close() {
		if (busy !== 'importing') dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		// An open confirm dialog handles Escape itself.
		if (event.key === 'Escape' && $dialogQueue.length === 0) close();
	}

	function resetCheck() {
		checkedText = null;
		preview = null;
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
		showErrors(
			`This file can't be imported (${plural(problems.length, 'problem')})`,
			problems,
			true
		);

	// Browsers fire no change event when the same file is chosen again, so a
	// file that was fixed in an editor could never be re-checked. Every pick
	// therefore starts from an empty input.
	function handleFilePick() {
		fileInput.value = '';
		selectedFile = null;
		resetCheck();
	}

	function handleFileChange() {
		selectedFile = fileInput.files?.[0] ?? null;
		importResult = null;
		resetCheck();
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

	const handleSubmit: SubmitFunction = async ({ action, formData, cancel }) => {
		const importing = action.search.includes('importTemplate');

		if (!selectedFile) {
			cancel();
			showErrors('No file chosen', ['Choose a template file first.']);
			return;
		}

		if (!importing) {
			resetCheck();
			importResult = null;
			if (selectedFile.size > TEMPLATE_LIMITS.fileBytes) {
				cancel();
				fileProblems([
					`The file is ${Math.ceil(selectedFile.size / 1024)} KB, templates are limited to ${TEMPLATE_LIMITS.fileBytes / 1024} KB. A layout file is usually far smaller, so this is probably the wrong file.`
				]);
				return;
			}
			try {
				checkedText = await selectedFile.text();
			} catch {
				cancel();
				showErrors('File not readable', [
					'The file could not be read. If you changed or moved it after choosing it, choose it again.'
				]);
				return;
			}
		} else {
			if (checkedText === null || !preview) {
				cancel();
				return;
			}
			const { current, summary } = preview;
			const bookings =
				current.bookings > 0
					? `${plural(current.bookings, 'booking')} will be released, those guests have to book again.`
					: 'There are no bookings right now.';
			const confirmed = await confirmDialog(
				`Your camp's ${layoutLine(current)} will be deleted and replaced by the ${layoutLine(summary)} from "${selectedFile.name}".\n\n` +
					`${bookings} All ticket codes stay valid.\n\n` +
					(skipBackup
						? 'No backup will be made, so this cannot be undone.'
						: 'A backup of the database is made first, so a superuser can undo this.'),
				{
					title: 'Replace the whole layout?',
					tone: 'danger',
					confirmLabel: 'Replace layout',
					cancelLabel: 'Keep current layout'
				}
			);
			if (!confirmed) {
				cancel();
				return;
			}
		}

		formData.set(
			'template',
			new Blob([checkedText ?? ''], { type: 'application/json' }),
			selectedFile.name
		);
		busy = importing ? 'importing' : 'checking';

		return async ({ result, update }) => {
			busy = null;

			if (result.type === 'success' && !importing) {
				preview = result.data?.preview as Preview;
			} else if (result.type === 'success') {
				importResult = result.data as unknown as ImportResult;
				selectedFile = null;
				resetCheck();
				// Resets the form and reloads the map behind this window.
				await update();
			} else if (result.type === 'failure') {
				const data = result.data as { error?: string; errors?: string[]; backupFailed?: boolean };
				const problems = data?.errors ?? [
					data?.error ?? `The server refused the request (${result.status}).`
				];
				backupFailed = data?.backupFailed === true;
				if (!backupFailed) preview = null;
				if (result.status === 400) fileProblems(problems);
				else showErrors(importing ? 'Nothing was imported' : 'Check not possible', problems);
				if (importing) await invalidateAll();
			} else if (result.type === 'error') {
				preview = null;
				showErrors('Connection problem', [
					importing
						? 'The connection broke while the import was running, so its result is unknown. Close this window and check the map before you try again.'
						: `The file could not be sent to the server (${result.error?.message ?? 'no connection'}). Check your connection and try again.`
				]);
				if (importing) await invalidateAll();
			} else {
				// Redirect, e.g. to the login page after the session expired.
				await update();
			}
		};
	};
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

				<div class="howto">
					<h4>How to build a starting layout</h4>
					<ol>
						<li>In Staging Mode, place your houses on the map and add their rooms and spots.</li>
						<li>Download the layout and keep the file somewhere safe, e.g. the team drive.</li>
						<li>On a fresh or reset database, a superuser imports that file here.</li>
					</ol>
					<a href={EXAMPLE_URL} download="brahmsee-starter.json">Download example template</a>
				</div>

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
						Replaces <strong>all</strong> houses, rooms and spots with the ones from a template file.
						Bookings are released, ticket codes stay valid. Works in Staging Mode only.
					</p>

					<form
						method="POST"
						action="?/previewTemplate"
						enctype="multipart/form-data"
						novalidate
						use:enhance={handleSubmit}
					>
						<div class="file-input-wrapper">
							<input
								type="file"
								name="template"
								accept=".json,application/json"
								id="template-upload"
								bind:this={fileInput}
								on:click={handleFilePick}
								on:change={handleFileChange}
							/>
							<label for="template-upload" class:selected={selectedFile}>
								<span class="file-icon">{selectedFile ? '📄' : '📁'}</span>
								{selectedFile?.name ?? 'CHOOSE TEMPLATE FILE'}
							</label>
						</div>

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

						{#if preview}
							<div class="note" role="status" in:fade>
								<strong>This file</strong>
								<span>{layoutLine(preview.summary)}</span>
								<span class="dim">
									{preview.summary.activeBeds} active · {preview.summary.lockedBeds} locked ·
									{preview.summary.deactivatedBeds} deactivated
								</span>
								<strong>Your camp now</strong>
								<span>{layoutLine(preview.current)}</span>
								<span class="dim">
									{preview.current.bookings > 0
										? `${plural(preview.current.bookings, 'booking')} will be released.`
										: 'No bookings to release.'}
									Ticket codes stay valid.
								</span>
							</div>

							{#if preview.warnings.length > 0}
								<div class="note warn">
									<strong>Good to know ({preview.warnings.length})</strong>
									<ul>
										{#each preview.warnings as warning}
											<li>{warning}</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if backupFailed}
								<label class="skip-backup">
									<input type="checkbox" name="skipBackup" value="1" bind:checked={skipBackup} />
									Import without a backup. It can't be undone then.
								</label>
							{/if}

							<button
								type="submit"
								formaction="?/importTemplate"
								class="btn-action danger"
								disabled={busy !== null}
							>
								REPLACE LAYOUT 🔥
							</button>
						{:else}
							<button type="submit" class="btn-action" disabled={busy !== null || !selectedFile}>
								{busy === 'checking' ? 'CHECKING...' : 'CHECK TEMPLATE 🔍'}
							</button>
							<small class="dim"
								>Checking changes nothing. You confirm before anything is replaced.</small
							>
						{/if}
					</form>

					{#if importResult}
						<div class="note good" role="status" in:fade>
							<strong>✨ Layout replaced</strong>
							<span>Your camp now has {layoutLine(importResult.summary)}.</span>
							<span class="dim">
								{plural(importResult.releasedBookings, 'booking')} released. All ticket codes still work.
							</span>
							<span class="dim">
								{#if importResult.backup}
									Backup made before the import: <code>{importResult.backup}</code>. A superuser can
									restore it in the PocketBase dashboard under Settings → Backups.
								{:else}
									No backup was made.
								{/if}
							</span>
							{#if importResult.leftovers > 0}
								<span class="alarm">
									{plural(importResult.leftovers, 'old record')} could not be deleted. Look for duplicate
									houses on the map and delete them in the editor.
								</span>
							{/if}
							{#if !importResult.namesCleared}
								<span class="alarm">
									The burner names of the released bookings could not be cleared. Use "Clear all
									bookings" on the dashboard to finish that.
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<div class="tool-card import-card">
					<div class="icon">🔒</div>
					<h3>Import New Layout</h3>
					<p>
						Importing a template replaces all houses, rooms and spots. Only superusers can do this.
					</p>
				</div>
			{/if}
		</div>
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

	form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
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

	/* Hidden from view, but still focusable and tappable through its label. */
	.file-input-wrapper {
		position: relative;
		width: 100%;
	}
	.file-input-wrapper input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.file-input-wrapper label {
		display: block;
		padding: 1.2rem;
		background: #050505;
		border: 1px dashed #444;
		border-radius: 12px;
		color: #999;
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
		color: #ccc;
	}
	.file-input-wrapper input:focus-visible + label {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
	}
	.file-input-wrapper label.selected {
		border: 2px solid #2dd4bf;
		background: rgba(45, 212, 191, 0.05);
		color: #fff;
		box-shadow: 0 0 20px rgba(45, 212, 191, 0.1);
	}
	.file-icon {
		margin-right: 0.5rem;
		font-size: 1.1rem;
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
	small.dim {
		font-size: 0.75rem;
		line-height: 1.5;
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
	.howto h4 {
		margin: 0 0 0.6rem;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #ccc;
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
