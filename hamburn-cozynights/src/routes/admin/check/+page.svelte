<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import type { ActionData } from './$types';
	import type { PassCheckResult } from '$lib/pass';
	import PassScanner from '$lib/components/admin/PassScanner.svelte';

	export let form: ActionData;

	let input = '';
	let inputEl: HTMLInputElement;
	let formEl: HTMLFormElement;
	let checking = false;
	let error = '';
	// The last checks, newest first: handy at a check-in desk.
	let history: PassCheckResult[] = [];

	$: if (form && 'result' in form && form.result) showResult(form.result as PassCheckResult);

	function showResult(result: PassCheckResult) {
		if (history[0] === result) return;
		history = [result, ...history].slice(0, 6);
	}

	// Scanners end with Enter; submit explicitly instead of relying on the
	// browser's implicit submission, which some setups don't trigger.
	function submitOnEnter(event: KeyboardEvent) {
		if (event.key !== 'Enter' || checking) return;
		event.preventDefault();
		if (input.trim()) formEl.requestSubmit();
	}

	async function scanned(event: CustomEvent<string>) {
		input = event.detail;
		await tick();
		formEl.requestSubmit();
	}

	function time(iso: string) {
		return new Date(iso).toLocaleTimeString('en-GB', {
			timeZone: 'Europe/Berlin',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	// Ready for the next scan right away (USB scanners type into the focused field).
	onMount(() => inputEl?.focus());

	const VERDICT: Record<PassCheckResult['status'], string> = {
		valid: '✅ VALID — holds a spot',
		nospot: '⚠️ NO SPOT — ticket exists, no spot booked',
		unknown: '❌ UNKNOWN — no ticket has this pass'
	};
</script>

<svelte:head>
	<title>Check passes · CozyNights Admin</title>
</svelte:head>

<div class="check-page">
	<a href="/admin" class="back">← Control Center</a>
	<h1>Check booking passes 🎫</h1>
	<p class="intro">
		Scan the guest's QR code or type the code under it. With a phone you can also use the phone's
		camera app: the pass opens with the result on top, as long as you are signed in here in the same
		browser.
	</p>

	<form
		method="POST"
		action="?/check"
		bind:this={formEl}
		class="check-form"
		use:enhance={() => {
			checking = true;
			error = '';
			return async ({ result, update }) => {
				checking = false;
				if (result.type === 'failure') {
					error = typeof result.data?.error === 'string' ? result.data.error : 'The check failed.';
				} else if (result.type === 'error') {
					error = 'We could not reach the server. Check the connection and try again.';
				} else {
					await update({ reset: false });
					input = '';
				}
				inputEl?.focus();
			};
		}}
	>
		<label for="pass-code">Pass code or scanned link</label>
		<div class="row">
			<input
				id="pass-code"
				name="code"
				bind:this={inputEl}
				bind:value={input}
				on:keydown={submitOnEnter}
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				placeholder="7F3K-9QXM-2CWD"
				required
			/>
			<button type="submit" disabled={checking}>{checking ? 'Checking…' : 'Check'}</button>
		</div>
		<small>A USB barcode scanner works too: it types the code and presses Enter.</small>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>

	<PassScanner on:scan={scanned} />

	{#each history as result, i (result.checkedAt + result.code)}
		<section
			class="result {result.status}"
			class:latest={i === 0}
			aria-live={i === 0 ? 'polite' : 'off'}
		>
			<p class="verdict">{VERDICT[result.status]}</p>
			<p class="meta">
				<span class="code">{result.code}</span> · checked {time(result.checkedAt)}
			</p>
			{#if result.status !== 'unknown'}
				<dl>
					<dt>Ticket</dt>
					<dd>{result.ticketName || '—'}</dd>
					{#if result.email}
						<dt>E-mail</dt>
						<dd>{result.email}</dd>
					{/if}
					{#if result.spot}
						<dt>Spot</dt>
						<dd>
							<strong>{result.spot.spot}</strong> · {result.spot.room} · {result.spot.house}
							<a href="/admin/room/{result.spot.roomId}">open room</a>
						</dd>
						{#if result.burnerName}
							<dt>Burner name</dt>
							<dd>{result.burnerName}</dd>
						{/if}
					{/if}
				</dl>
				{#if result.warning}<p class="warn">{result.warning}</p>{/if}
			{/if}
		</section>
	{/each}
</div>

<style>
	.check-page {
		max-width: 720px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
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
	.intro {
		margin: 0;
		color: #b5b5b5;
		line-height: 1.5;
	}

	.check-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	label {
		font-weight: 800;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	input {
		flex: 1 1 14rem;
		min-height: 48px;
		padding: 0 1rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #111;
		color: #fff;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 1.2rem;
		letter-spacing: 0.06em;
	}
	input:focus {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.row button {
		min-height: 48px;
		padding: 0 1.5rem;
		border: none;
		border-radius: 10px;
		background: #2dd4bf;
		color: #000;
		font-weight: 900;
		cursor: pointer;
	}
	.row button:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	small {
		color: #8a8a8a;
	}
	.error {
		color: #fecaca;
		font-weight: 700;
		margin: 0;
	}

	.result {
		border-radius: 16px;
		padding: 1rem 1.25rem;
		background: #111;
		border: 1px solid #262626;
		opacity: 0.6;
	}
	.result.latest {
		opacity: 1;
		border-width: 2px;
	}
	.result.valid.latest {
		border-color: #2dd4bf;
	}
	.result.nospot.latest {
		border-color: #fb923c;
	}
	.result.unknown.latest {
		border-color: #f43f5e;
	}
	.verdict {
		margin: 0;
		font-weight: 900;
		font-size: 1.1rem;
	}
	.result.valid .verdict {
		color: #2dd4bf;
	}
	.result.nospot .verdict {
		color: #fb923c;
	}
	.result.unknown .verdict {
		color: #f43f5e;
	}
	.meta {
		margin: 0.25rem 0 0.75rem;
		color: #8a8a8a;
		font-size: 0.9rem;
	}
	.code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: #e5e5e5;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 1rem;
		margin: 0;
	}
	dt {
		color: #8a8a8a;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	dd a {
		color: #2dd4bf;
		margin-left: 0.5rem;
	}
	.warn {
		color: #fecaca;
		font-weight: 700;
		margin: 0.75rem 0 0;
	}
</style>
