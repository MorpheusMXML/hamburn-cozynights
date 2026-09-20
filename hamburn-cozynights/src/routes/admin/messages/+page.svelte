<!--
Message texts (docs/admin/notifications.md, "Message texts"): every sentence
guests get by e-mail, on Telegram and from the bot, with a preview of whole
messages rendered by PocketBase — the same code that sends them.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { confirmDialog, toast } from '$lib/dialogs';
	import type { MessageChannel, MessagePreview, MessageTextView } from '$lib/message-texts';

	export let data: PageData;
	// Without JavaScript a refused change comes back here (with it: a toast).
	export let form: ActionData;

	// What is in the boxes, by key; starts as what is in use.
	let drafts: Record<string, string> = Object.fromEntries(
		data.items.map((item) => [item.key, item.value])
	);
	let busy = '';
	let filter = '';

	$: needle = filter.trim().toLowerCase();
	$: visible = (item: MessageTextView) =>
		!needle ||
		item.label.toLowerCase().includes(needle) ||
		item.value.toLowerCase().includes(needle) ||
		item.text.toLowerCase().includes(needle) ||
		item.key.includes(needle);
	$: sections = data.groups
		.map((group) => ({
			group,
			items: data.items.filter((i) => i.group === group.id && visible(i))
		}))
		.filter((section) => section.items.length > 0);
	$: changed = data.items.filter((item) => item.custom).length;

	const NO_CONNECTION = 'We could not reach the server, so nothing was changed. Try again.';

	/** Save or reset (the submitter's formaction decides), with a toast; then the box and the preview follow. */
	function act(key: string): SubmitFunction {
		return async ({ action, cancel }) => {
			const reset = action.search === '?/reset';
			if (reset) {
				const ok = await confirmDialog(
					'The text you wrote is replaced by the default one. Guests get the default from then on.',
					{
						title: 'Reset to the default?',
						tone: 'warning',
						confirmLabel: 'Reset',
						cancelLabel: 'Keep mine'
					}
				);
				if (!ok) {
					cancel();
					return;
				}
			}
			busy = key;
			return async ({ result, update }) => {
				busy = '';
				if (result.type === 'failure') {
					const message = (result.data as { error?: string } | undefined)?.error;
					toast(message || 'That did not work. Reload the page and try again.', 'danger', 8000);
					await update({ reset: false });
					return;
				}
				if (result.type === 'error') {
					toast(NO_CONNECTION, 'danger');
					return;
				}
				toast(
					reset ? 'Back to the default text.' : 'Saved. Guests get this text from now on.',
					'success'
				);
				await update();
				drafts[key] = data.items.find((item) => item.key === key)?.value ?? '';
				loadPreview();
			};
		};
	}

	function undo(key: string) {
		drafts[key] = data.items.find((item) => item.key === key)?.value ?? '';
		schedulePreview();
	}

	function rows(text: string) {
		const lines = text.split('\n').reduce((n, line) => n + 1 + Math.floor(line.length / 70), 0);
		return Math.min(8, Math.max(2, lines));
	}

	function when(value: string) {
		const date = new Date(value.replace(' ', 'T'));
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Berlin',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	// --- preview: whole messages with the texts as typed --------------------------

	let preview: MessagePreview | null = null;
	let previewError = '';
	let channel: MessageChannel = 'mail';
	let sample = '';
	let asHtml = false;
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewRun = 0;

	// E-mails have a subject and an HTML version; Telegram and bot messages are text only.
	type Sample = { id: string; title: string; text: string; subject?: string; html?: string };
	$: samples = (preview ? preview[channel] : []) as Sample[];
	$: current = samples.find((s) => s.id === sample) ?? samples[0] ?? null;
	$: if (samples.length > 0 && !samples.some((s) => s.id === sample)) sample = samples[0].id;

	async function loadPreview() {
		const run = ++previewRun;
		try {
			const res = await fetch('/admin/messages/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ texts: drafts })
			});
			if (!res.ok) throw new Error(String(res.status));
			const next = (await res.json()) as MessagePreview;
			if (run !== previewRun) return; // a newer one is on its way
			preview = next;
			previewError = '';
		} catch {
			if (run !== previewRun) return;
			previewError = 'The preview could not be loaded right now. Your texts are still here.';
		}
	}

	function schedulePreview() {
		clearTimeout(previewTimer);
		previewTimer = setTimeout(loadPreview, 500);
	}

	onMount(() => {
		loadPreview();
		return () => clearTimeout(previewTimer);
	});
</script>

<svelte:head>
	<title>Message texts · CozyNights Admin</title>
</svelte:head>

<div class="messages-page">
	<a href="/admin" class="back">← Control Center</a>
	<h1>Message texts ✉️</h1>
	<p class="intro">
		Every sentence guests get by e-mail, on Telegram and from the bot. Change one, save it, and
		every message from then on uses it; <em>Reset to default</em> takes it back. Which lines a message
		has in which case stays as it is — the preview shows whole messages with your texts. Messages are
		in English; the crew chat hears about every change.
	</p>

	{#if form && 'error' in form && form.error}
		<p class="form-error" role="alert">{form.error}</p>
	{/if}

	<details class="placeholders">
		<summary>Placeholders: what the curly braces stand for</summary>
		<p>
			A text may use the placeholders listed under its box; PocketBase fills them in when it sends.
			Anything else in curly braces is sent as written.
		</p>
		<dl>
			{#each data.placeholders as placeholder}
				<dt><code>{'{' + placeholder.name + '}'}</code></dt>
				<dd>{placeholder.meaning}</dd>
			{/each}
		</dl>
	</details>

	<div class="toolbar">
		<label class="filter">
			<span>Find a text</span>
			<input type="search" bind:value={filter} placeholder="e.g. released, pass, crew" />
		</label>
		<span class="summary">{data.items.length} texts · {changed} changed</span>
	</div>

	<div class="columns">
		<div class="editor">
			{#if sections.length === 0}
				<p class="empty">No text matches "{filter}".</p>
			{/if}
			{#each sections as { group, items } (group.id)}
				<section class="group">
					<h2>{group.title}</h2>
					{#each items as item (item.key)}
						<article class="text" class:custom={item.custom} id={item.key}>
							<form method="POST" action="?/save" use:enhance={act(item.key)}>
								<input type="hidden" name="key" value={item.key} />
								<label for="text-{item.key}">{item.label}</label>
								{#if item.hint}<p class="hint">{item.hint}</p>{/if}
								<textarea
									id="text-{item.key}"
									name="text"
									rows={rows(drafts[item.key] ?? '')}
									bind:value={drafts[item.key]}
									on:input={schedulePreview}
								></textarea>
								<div class="row">
									{#if item.placeholders.length > 0}
										<span class="chips" title="This text may use these placeholders">
											{#each item.placeholders as name}<code>{'{' + name + '}'}</code>{/each}
										</span>
									{/if}
									{#if drafts[item.key] !== item.value}
										<button class="btn primary" disabled={!!busy}>Save</button>
										<button type="button" class="btn" on:click={() => undo(item.key)}>Undo</button>
									{/if}
									{#if item.custom}
										<button class="btn subtle" formaction="?/reset" disabled={!!busy}
											>Reset to default</button
										>
									{/if}
								</div>
								{#if item.custom}
									<p class="meta">
										Changed{item.updatedBy ? ` by ${item.updatedBy}` : ''}{item.updatedAt
											? ` · ${when(item.updatedAt)}`
											: ''}. Default: <q>{item.text}</q>
									</p>
								{/if}
							</form>
						</article>
					{/each}
				</section>
			{/each}
		</div>

		<aside class="preview" aria-live="polite">
			<h2>Preview</h2>
			<p class="hint">
				Whole messages for a sample guest, rendered by the server that sends them. Unsaved texts are
				included.
			</p>
			<div class="pickers">
				<select bind:value={channel} aria-label="Channel">
					<option value="mail">E-mail</option>
					<option value="telegram">Telegram</option>
					<option value="bot">Bot replies</option>
				</select>
				<select bind:value={sample} aria-label="Situation">
					{#each samples as s}<option value={s.id}>{s.title}</option>{/each}
				</select>
			</div>
			{#if previewError}
				<p class="form-error" role="alert">{previewError}</p>
			{:else if !current}
				<p class="empty">Loading the preview…</p>
			{:else if current.subject !== undefined}
				<p class="subject"><span>Subject</span> {current.subject}</p>
				<label class="switch">
					<input type="checkbox" bind:checked={asHtml} /> Show as the e-mail looks
				</label>
				{#if asHtml}
					<iframe class="html" title="The e-mail" sandbox="" srcdoc={current.html ?? ''}></iframe>
				{:else}
					<pre class="message">{current.text}</pre>
				{/if}
			{:else}
				<pre class="message">{current.text}</pre>
			{/if}
		</aside>
	</div>
</div>

<style>
	.messages-page {
		max-width: 1180px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.back {
		color: #2dd4bf;
		font-weight: 800;
		text-decoration: none;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-weight: 900;
		font-size: clamp(1.5rem, 5vw, 2rem);
	}
	.intro,
	.hint,
	.empty,
	.meta {
		margin: 0;
		color: #b5b5b5;
		line-height: 1.5;
	}
	.hint,
	.meta {
		font-size: 0.85rem;
	}
	.meta q {
		color: #d4d4d4;
	}

	.placeholders {
		border: 1px dashed #3f3f46;
		border-radius: 12px;
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
		color: #b5b5b5;
	}
	.placeholders summary {
		cursor: pointer;
		font-weight: 700;
		color: #d4d4d4;
		min-height: 32px;
		line-height: 32px;
	}
	.placeholders p {
		margin: 0.25rem 0 0.5rem;
	}
	.placeholders dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0 0 0.5rem;
	}
	.placeholders dd {
		margin: 0;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85em;
		color: #f9a8d4;
		background: #1c1c1f;
		padding: 0.1rem 0.35rem;
		border-radius: 6px;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.filter {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		flex: 1 1 16rem;
		max-width: 26rem;
		font-weight: 800;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.filter input,
	select,
	textarea {
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #0a0a0a;
		color: #fff;
		font: inherit;
		text-transform: none;
		letter-spacing: normal;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		line-height: 1.45;
	}
	textarea:focus,
	.filter input:focus,
	select:focus {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.summary {
		color: #a3a3a3;
		font-size: 0.9rem;
		padding-bottom: 0.6rem;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem);
		gap: 1.5rem;
		align-items: start;
	}
	@media (max-width: 900px) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
		.preview {
			position: static;
		}
	}

	.group h2 {
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #d4d4d4;
		margin: 1.25rem 0 0.6rem;
	}
	.text {
		background: #111;
		border: 1px solid #262626;
		border-left: 4px solid #3f3f46;
		border-radius: 14px;
		padding: 0.85rem 1rem;
		margin-bottom: 0.75rem;
	}
	.text.custom {
		border-left-color: #f472b6;
	}
	.text form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.text label {
		font-weight: 800;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-right: auto;
	}
	.btn {
		min-height: 40px;
		padding: 0 1rem;
		border-radius: 10px;
		border: 1px solid #52525b;
		background: transparent;
		color: #e5e5e5;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.btn.primary {
		background: #2dd4bf;
		border-color: #2dd4bf;
		color: #000;
	}
	.btn.subtle {
		border-color: transparent;
		color: #a3a3a3;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.preview {
		position: sticky;
		top: calc(var(--booking-bar-height, 0px) + 5.5rem);
		background: #111;
		border: 1px solid #262626;
		border-radius: 16px;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.preview h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.pickers {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.subject {
		margin: 0;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.subject span {
		color: #a3a3a3;
		font-weight: 800;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		margin-right: 0.4rem;
	}
	.switch {
		font-size: 0.85rem;
		color: #b5b5b5;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.message {
		margin: 0;
		padding: 0.75rem 1rem;
		background: #0a0a0a;
		border-radius: 10px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font: inherit;
		font-size: 0.92rem;
		line-height: 1.5;
	}
	.html {
		width: 100%;
		height: 30rem;
		border: 0;
		border-radius: 10px;
		background: #f6f3ee;
	}
</style>
