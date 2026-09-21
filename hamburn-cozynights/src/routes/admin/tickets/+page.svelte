<script lang="ts">
	import { applyAction, deserialize, enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import FoldPanel from '$lib/components/admin/FoldPanel.svelte';
	import DropZone from '$lib/components/admin/DropZone.svelte';
	import TicketCard from '$lib/components/admin/TicketCard.svelte';
	import {
		TICKET_LIMITS,
		defaultRosterSelection,
		defaultTicketName,
		readRosterFile,
		type ColumnMap,
		type RosterChange,
		type RosterImportOutcome,
		type RosterPreview,
		type RosterRow,
		type TicketSearch,
		type TicketView
	} from '$lib/tickets';

	export let data: PageData;
	/** Set when the page answers a form post without JavaScript. */
	export let form: ActionData;
	$: isSuperuser = data.isSuperuser;

	const plural = (count: number, word: string, many = `${word}s`) =>
		`${count} ${count === 1 ? word : many}`;

	// --- find a ticket -------------------------------------------------------------

	let query = '';
	let searchInput: HTMLInputElement;
	let searching = false;
	let searchError = '';
	let search: TicketSearch | null = null;

	// Ready to type a code, unless the admin is already typing somewhere else
	// (the page can take a moment to start on a slow phone).
	onMount(() => {
		const active = document.activeElement;
		if (!active || active === document.body) searchInput?.focus();
	});

	// Enter submits explicitly: some setups (scanners, automation) don't trigger
	// the browser's implicit submission.
	function submitOnEnter(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing || searching) return;
		event.preventDefault();
		(event.currentTarget as HTMLInputElement).form?.requestSubmit();
	}

	// Without JavaScript the actions answer with this page: show their result.
	$: if (form) showFormResult(form);
	function showFormResult(result: NonNullable<ActionData>) {
		if ('search' in result && result.search) {
			search = result.search as TicketSearch;
			query = search.query;
		} else if ('updated' in result && result.updated) {
			const ticket = result.updated.ticket as TicketView;
			search = { by: 'code', query: ticket.code, tickets: [ticket], more: false };
		} else if ('error' in result && result.error) {
			searchError = String(result.error);
		}
	}

	const handleSearch: SubmitFunction = ({ cancel }) => {
		if (!query.trim()) {
			cancel();
			searchError = 'Type a ticket code or an e-mail address first.';
			return;
		}
		searching = true;
		searchError = '';
		return async ({ result }) => {
			searching = false;
			if (result.type === 'success') {
				search = (result.data?.search as TicketSearch) ?? null;
			} else if (result.type === 'failure') {
				search = null;
				searchError = (result.data as { error?: string })?.error ?? 'The search failed.';
			} else if (result.type === 'error') {
				searchError = 'The server could not be reached. Check your connection and try again.';
			} else {
				await applyAction(result);
			}
		};
	};

	function ticketSaved(fresh: TicketView) {
		if (!search) return;
		// By id: a newer search may have replaced the list meanwhile.
		const index = search.tickets.findIndex((ticket) => ticket.id === fresh.id);
		if (index < 0) return;
		// The server answers with the code hidden; keep showing what was shown.
		const shown = search.tickets[index];
		search.tickets[index] = { ...fresh, code: shown.code, codeMasked: shown.codeMasked };
		search = search;
	}

	// --- import the ticket list --------------------------------------------------------

	let file: File | null = null;
	let fileText = '';
	let fileError = '';
	let header: string[] = [];
	let columns: ColumnMap = { code: -1, email: -1, name: -1 };
	let rows: RosterRow[] = [];
	let checking = false;
	let importing = false;
	let preview: RosterPreview | null = null;
	let selected = new Set<string>();
	let newHolders = new Set<string>();
	/** Ids of cancelled tickets ticked for removal (only ones without a spot). */
	let removals = new Set<string>();
	let imported: RosterImportOutcome | null = null;
	let filter = '';

	async function post(action: string, form: FormData): Promise<ActionResult> {
		try {
			const response = await fetch(`?/${action}`, {
				method: 'POST',
				body: form,
				headers: { 'x-sveltekit-action': 'true', accept: 'application/json' }
			});
			return deserialize(await response.text());
		} catch (err) {
			return { type: 'error', error: err };
		}
	}

	function failureText(result: ActionResult, fallback: string): string {
		if (result.type === 'failure') {
			return (result.data as { error?: string } | undefined)?.error ?? fallback;
		}
		if (result.type === 'error') return 'The server could not be reached. Check your connection.';
		return fallback;
	}

	async function pickFile(event: CustomEvent<File>) {
		const picked = event.detail;
		imported = null;
		preview = null;
		fileError = '';
		header = [];
		file = picked;
		if (picked.size > TICKET_LIMITS.fileBytes) {
			fileError = `The file is ${Math.ceil(picked.size / 1024)} KB. A ticket list is far smaller, so this is probably the wrong file.`;
			return;
		}
		try {
			fileText = await picked.text();
		} catch {
			fileError = 'The file could not be read. Choose it again.';
			return;
		}
		await check();
	}

	/** Only the answer to the newest check counts (quick column changes). */
	let checkSeq = 0;

	/** Reads the file with the chosen columns and asks the server what would change. */
	async function check(chosen?: Partial<ColumnMap>) {
		const read = readRosterFile(fileText, chosen);
		header = read.header ?? header;
		const seq = ++checkSeq;
		if (!read.ok) {
			fileError = read.error;
			preview = null;
			checking = false;
			return;
		}
		fileError = '';

		checking = true;
		const form = new FormData();
		form.set('rows', JSON.stringify(read.rows));
		const result = await post('previewRoster', form);
		if (seq !== checkSeq) return;
		checking = false;
		if (result.type === 'success') {
			// The review and what Import sends always belong together.
			columns = read.columns;
			rows = read.rows;
			preview = result.data?.roster as RosterPreview;
			const start = defaultRosterSelection(preview.diff);
			selected = new Set(start.selected);
			newHolders = new Set(start.newHolders);
			// Deleting is never preselected.
			removals = new Set();
			filter = '';
		} else if (result.type === 'redirect') {
			await applyAction(result);
		} else {
			preview = null;
			fileError = failureText(result, 'The file could not be checked.');
		}
	}

	function setColumn(column: keyof ColumnMap, value: string) {
		check({ ...columns, [column]: Number(value) });
	}

	$: changes = preview?.diff.changes ?? [];
	$: newOnes = changes.filter((change) => change.kind === 'new');
	$: updates = changes.filter((change) => change.kind === 'changed');
	$: needle = filter.trim().toLowerCase();
	$: matches = (change: RosterChange) =>
		!needle ||
		change.code.toLowerCase().includes(needle) ||
		change.email.includes(needle) ||
		change.name.toLowerCase().includes(needle) ||
		(change.before?.email ?? '').includes(needle);
	$: shownNew = newOnes.filter(matches);
	$: shownUpdates = updates.filter(matches);
	$: chosen = changes.filter((change) => selected.has(change.key));
	$: chosenHolders = chosen.filter(
		(change) => change.canBeNewHolder && newHolders.has(change.key)
	).length;
	$: confirmations = chosen.filter(
		(change) => change.kind === 'changed' && change.emailChanged && change.hasSpot && change.email
	).length;
	// A ticket the file no longer lists can be deleted — but only when it holds
	// no spot. One that does stays, whatever the file says.
	$: removable = preview ? preview.diff.notInFile.filter((ticket) => !ticket.hasSpot) : [];
	$: chosenRemovals = removable.filter((ticket) => removals.has(ticket.id)).length;

	function toggle(key: string) {
		if (selected.has(key)) selected.delete(key);
		else selected.add(key);
		selected = selected;
	}

	function toggleRemoval(id: string) {
		if (removals.has(id)) removals.delete(id);
		else removals.add(id);
		removals = removals;
	}

	function toggleHolder(key: string) {
		if (newHolders.has(key)) newHolders.delete(key);
		else newHolders.add(key);
		newHolders = newHolders;
	}

	function groupState(list: RosterChange[]): 'all' | 'some' | 'none' {
		const on = list.filter((change) => selected.has(change.key)).length;
		return on === 0 ? 'none' : on === list.length ? 'all' : 'some';
	}

	function toggleGroup(list: RosterChange[]) {
		const on = groupState(list) !== 'all';
		for (const change of list) {
			if (on) selected.add(change.key);
			else selected.delete(change.key);
		}
		selected = selected;
	}

	async function runImport() {
		if (!preview || (chosen.length === 0 && chosenRemovals === 0)) return;
		importing = true;
		const form = new FormData();
		form.set('rows', JSON.stringify(rows));
		form.set('selected', JSON.stringify(chosen.map((change) => change.key)));
		form.set(
			'newHolders',
			JSON.stringify(chosen.filter((c) => newHolders.has(c.key)).map((c) => c.key))
		);
		form.set(
			'remove',
			JSON.stringify(removable.filter((t) => removals.has(t.id)).map((t) => t.id))
		);
		const result = await post('importRoster', form);
		importing = false;
		if (result.type === 'success') {
			imported = result.data?.imported as RosterImportOutcome;
			// Compare again: what is left shows right away.
			await check(columns);
		} else if (result.type === 'redirect') {
			await applyAction(result);
		} else {
			fileError = failureText(result, 'The import failed. Check the tickets before you try again.');
		}
	}

	/** New tickets without a name get the label "Ticket <code>": show that as no name. */
	const isDefaultName = (change: RosterChange) => change.name === defaultTicketName(change.code);
</script>

<svelte:head>
	<title>Tickets · CozyNights Admin</title>
</svelte:head>

<div class="tickets-page">
	<a href="/admin" class="back">← Control Center</a>
	<h1>Tickets 🎟️</h1>
	<p class="intro">
		Find a ticket by its code, fix its e-mail address or hand it over when it was passed on.
		Superusers load the ticket shop's list here and pick what to take over.
	</p>

	<FoldPanel title="Find a ticket" icon="🔎" open>
		<form
			method="POST"
			action="?/search"
			class="search-form"
			use:enhance={handleSearch}
			novalidate
			role="search"
		>
			<label for="ticket-query" class="sr-only">Ticket code or e-mail address</label>
			<input
				id="ticket-query"
				name="q"
				type="text"
				bind:this={searchInput}
				bind:value={query}
				placeholder="Code or e-mail"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="search"
				on:input={() => (searchError = '')}
				on:keydown={submitOnEnter}
			/>
			<button type="submit" class="btn-primary" disabled={searching}>
				{searching ? 'Searching…' : 'Search'}
			</button>
		</form>
		<p class="hint">
			Codes are found in any upper and lower case. Addresses must be complete; tickets found by
			address show their code hidden.
		</p>

		{#if searchError}<p class="error" role="alert">⚠️ {searchError}</p>{/if}

		{#if search}
			<div class="results" in:fade={{ duration: 150 }}>
				{#if search.tickets.length === 0}
					<p class="empty">
						No ticket {search.by === 'code' ? 'has the code' : 'has the address'}
						<strong>{search.query}</strong>.
						{#if search.by === 'code' && isSuperuser}
							New tickets come in with the ticket list below.
						{/if}
					</p>
				{:else}
					<p class="result-meta">
						{plural(search.tickets.length, 'ticket')}
						{search.by === 'code' ? 'with the code' : 'with the address'}
						<strong>{search.query}</strong>{search.more ? ' (only the first ones are shown)' : ''}
					</p>
					{#each search.tickets as ticket (ticket.id)}
						<TicketCard {ticket} on:saved={(event) => ticketSaved(event.detail)} />
					{/each}
				{/if}
			</div>
		{/if}
	</FoldPanel>

	<FoldPanel
		title="Load the ticket list"
		icon="📥"
		summary={isSuperuser ? 'CSV from the ticket shop' : 'superusers only'}
		open={isSuperuser}
	>
		{#if !isSuperuser}
			<p class="locked">
				🔒 Only superusers can load the ticket list. You can still find single tickets above and
				change their address.
			</p>
		{:else}
			<DropZone
				accept=".csv,.tsv,.txt,text/csv,text/plain"
				label="Drop the ticket list (CSV) here"
				hint="or tap to choose it · only code, e-mail and name leave your browser"
				fileName={file?.name ?? ''}
				busy={checking}
				disabled={importing}
				on:file={pickFile}
			/>

			{#if fileError}<p class="error" role="alert">⚠️ {fileError}</p>{/if}

			{#if imported}
				<div class="note good" role="status" in:fade>
					<strong>✨ Imported</strong>
					<span>
						{plural(imported.created, 'new ticket')}, {plural(imported.updated, 'ticket')} updated{imported.newHolders
							? ` (${imported.newHolders} handed over${imported.requestsRemoved
									? `, ${plural(imported.requestsRemoved, 'special-needs request')} deleted`
									: ''})`
							: ''}.
						{#if imported.confirmations}
							{plural(imported.confirmations, 'new address', 'new addresses')} get a confirmation of their
							spot.
						{/if}
						{#if imported.removed}
							{plural(imported.removed, 'cancelled ticket')} deleted.
						{/if}
						{#if imported.skipped}{plural(imported.skipped, 'ticket')} needed nothing anymore.{/if}
					</span>
					{#if imported.failed.length > 0}
						<span class="alarm">Not imported:</span>
						<ul>
							{#each imported.failed as failure}<li>
									<code>{failure.code}</code>: {failure.error}
								</li>{/each}
						</ul>
					{/if}
				</div>
			{/if}

			{#if header.length > 0 && preview}
				<div class="columns" aria-label="Columns used from the file">
					<label>
						<span>Ticket code</span>
						<select
							disabled={checking || importing}
							value={String(columns.code)}
							on:change={(e) => setColumn('code', e.currentTarget.value)}
						>
							{#each header as name, index}<option value={String(index)}
									>{name || `Column ${index + 1}`}</option
								>{/each}
						</select>
					</label>
					<label>
						<span>E-mail</span>
						<select
							disabled={checking || importing}
							value={String(columns.email)}
							on:change={(e) => setColumn('email', e.currentTarget.value)}
						>
							<option value="-1">— none —</option>
							{#each header as name, index}<option value={String(index)}
									>{name || `Column ${index + 1}`}</option
								>{/each}
						</select>
					</label>
					<label>
						<span>Name</span>
						<select
							disabled={checking || importing}
							value={String(columns.name)}
							on:change={(e) => setColumn('name', e.currentTarget.value)}
						>
							<option value="-1">— none —</option>
							{#each header as name, index}<option value={String(index)}
									>{name || `Column ${index + 1}`}</option
								>{/each}
						</select>
					</label>
				</div>
			{/if}

			{#if preview}
				{@const diff = preview.diff}
				<div class="review" in:fade={{ duration: 150 }}>
					<ul class="summary-chips" aria-label="What the file changes">
						<li class="new">{plural(newOnes.length, 'new ticket')}</li>
						<li class="changed">{plural(updates.length, 'change')}</li>
						<li>{diff.unchanged.length} unchanged</li>
						{#if diff.problems.length}<li class="bad">
								{plural(diff.problems.length, 'problem')}
							</li>{/if}
						{#if diff.notInFile.length}<li>{diff.notInFile.length} not in the file</li>{/if}
						{#if chosenRemovals}<li class="bad">{plural(chosenRemovals, 'to delete')}</li>{/if}
					</ul>

					{#if changes.length === 0}
						<p class="all-set">
							{#if diff.problems.length > 0}
								✅ Everything else of the file is in the database. The rows under Problems need
								fixing first.
							{:else}
								✅ Nothing to do: every ticket of the file is in the database, with the same address
								and name.
							{/if}
						</p>
					{/if}

					{#if changes.length > 12}
						<input
							class="filter"
							type="search"
							placeholder="Filter by code, e-mail or name"
							bind:value={filter}
							aria-label="Filter the list"
						/>
					{/if}

					{#if newOnes.length > 0}
						<FoldPanel
							nested
							tone="new"
							title="New tickets"
							summary={`${newOnes.filter((c) => selected.has(c.key)).length} of ${newOnes.length} chosen`}
							open={newOnes.length <= 50 || !!needle}
						>
							<label slot="actions" class="select-all">
								<input
									type="checkbox"
									checked={groupState(newOnes) === 'all'}
									indeterminate={groupState(newOnes) === 'some'}
									on:change={() => toggleGroup(newOnes)}
								/>
								<span>All</span>
							</label>
							<ul class="rows">
								{#each shownNew as change (change.key)}
									<li class="row" class:off={!selected.has(change.key)}>
										<label class="row-main">
											<input
												type="checkbox"
												checked={selected.has(change.key)}
												on:change={() => toggle(change.key)}
											/>
											<code class="row-code">{change.code}</code>
											<span class="row-email" class:muted={!change.email}
												>{change.email || 'no e-mail'}</span
											>
											<span class="row-name" class:muted={isDefaultName(change)}
												>{isDefaultName(change) ? 'no name' : change.name}</span
											>
										</label>
									</li>
								{/each}
							</ul>
						</FoldPanel>
					{/if}

					{#if updates.length > 0}
						<FoldPanel
							nested
							tone="changed"
							title="Changed tickets"
							summary={`${updates.filter((c) => selected.has(c.key)).length} of ${updates.length} chosen`}
						>
							<label slot="actions" class="select-all">
								<input
									type="checkbox"
									checked={groupState(updates) === 'all'}
									indeterminate={groupState(updates) === 'some'}
									on:change={() => toggleGroup(updates)}
								/>
								<span>All</span>
							</label>
							<ul class="rows">
								{#each shownUpdates as change (change.key)}
									<li class="row" class:off={!selected.has(change.key)}>
										<label class="row-main">
											<input
												type="checkbox"
												checked={selected.has(change.key)}
												on:change={() => toggle(change.key)}
											/>
											<code class="row-code">{change.code}</code>
											<span class="row-diff">
												{#if change.emailChanged}
													<span
														>✉️ <s>{change.before?.email || 'no e-mail'}</s> →
														<b>{change.email}</b></span
													>
												{/if}
												{#if change.nameChanged}
													<span
														>👤 <s
															>{change.before?.name === defaultTicketName(change.code)
																? 'no name'
																: change.before?.name}</s
														>
														→ <b>{change.name}</b></span
													>
												{/if}
											</span>
										</label>
										<div class="row-extra">
											{#if change.hasSpot}
												<span class="tag"
													>🛏 holds a spot{change.emailChanged
														? ': the new address gets a confirmation'
														: ''}</span
												>
											{/if}
											{#if change.telegram}<span class="tag">💬 Telegram linked</span>{/if}
											{#if change.canBeNewHolder}
												<button
													type="button"
													class="holder"
													class:on={newHolders.has(change.key)}
													aria-pressed={newHolders.has(change.key)}
													disabled={!selected.has(change.key)}
													on:click={() => toggleHolder(change.key)}
													title="Passed on: disconnect Telegram, new booking pass, forget the burner name"
												>
													🔁 {newHolders.has(change.key) ? 'New holder' : 'Same holder'}
												</button>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						</FoldPanel>
					{/if}

					{#if diff.problems.length > 0}
						<FoldPanel
							nested
							tone="removed"
							title="Problems"
							summary={`${diff.problems.length} row(s) left out`}
							open={diff.problems.length <= 10}
						>
							<ul class="plain">
								{#each diff.problems as problem}
									<li>
										Row {problem.line}{problem.code ? `, ${problem.code}` : ''}: {problem.message}
									</li>
								{/each}
							</ul>
							<p class="hint">
								Fix these rows in the file and load it again{changes.length > 0
									? ', or import the rest now'
									: ''}.
							</p>
						</FoldPanel>
					{/if}

					{#if diff.sharedEmails.length > 0}
						<FoldPanel
							nested
							tone="muted"
							title="Shared addresses"
							summary={`${diff.sharedEmails.length} address(es) with several tickets`}
							open={false}
						>
							<p class="hint">
								Allowed, e.g. when one person bought for friends. Each ticket gets its own e-mails.
							</p>
							<ul class="plain">
								{#each diff.sharedEmails as shared}
									<li>{shared.email}: {shared.codes.join(', ')}</li>
								{/each}
							</ul>
						</FoldPanel>
					{/if}

					{#if diff.notInFile.length > 0}
						<FoldPanel
							nested
							tone="muted"
							title="Not in the file"
							summary={chosenRemovals
								? `${chosenRemovals} of ${diff.notInFile.length} to delete`
								: `${diff.notInFile.length} ticket(s) stay as they are`}
							open={false}
						>
							<p class="hint">
								These tickets are in the database but not in the file — cancelled in the ticket shop,
								or from another file. They stay unless you tick one: a ticked ticket is deleted with
								the import, together with its Telegram link and its special-needs request. Their
								codes are shown shortened, and a ticket that holds a spot 🛏 cannot be deleted here
								— free the spot first.
							</p>
							<ul class="code-list">
								{#each diff.notInFile as ticket}
									<li>
										{#if ticket.hasSpot}
											<code>{ticket.code}</code> 🛏
										{:else}
											<label class="drop-row">
												<input
													type="checkbox"
													checked={removals.has(ticket.id)}
													on:change={() => toggleRemoval(ticket.id)}
												/>
												<code>{ticket.code}</code>
												<span class="muted">{removals.has(ticket.id) ? 'delete' : 'keep'}</span>
											</label>
										{/if}
									</li>
								{/each}
							</ul>
						</FoldPanel>
					{/if}

					{#if diff.unchanged.length > 0}
						<FoldPanel
							nested
							tone="muted"
							title="Unchanged"
							summary={`${diff.unchanged.length} ticket(s)`}
							open={false}
						>
							<ul class="code-list">
								{#each diff.unchanged as ticket}<li><code>{ticket.code}</code></li>{/each}
							</ul>
						</FoldPanel>
					{/if}

					{#if changes.length > 0 || removable.length > 0}
						<div class="action-bar">
							<span class="action-text">
								{plural(chosen.filter((c) => c.kind === 'new').length, 'new ticket')} ·
								{plural(chosen.filter((c) => c.kind === 'changed').length, 'update')}
								{#if chosenHolders}· {chosenHolders} handed over{/if}
								{#if confirmations}· {plural(confirmations, 'confirmation')}{/if}
								{#if chosenRemovals}· <span class="alarm">{chosenRemovals} deleted</span>{/if}
							</span>
							<button
								type="button"
								class="btn-primary"
								disabled={importing || checking || (chosen.length === 0 && chosenRemovals === 0)}
								on:click={runImport}
							>
								{importing
									? 'Importing…'
									: chosen.length === 0
										? `Delete ${chosenRemovals} cancelled`
										: `Import ${chosen.length} selected`}
							</button>
						</div>
					{/if}
				</div>
			{:else if !fileError && !checking}
				<p class="hint">
					Export the ticket list from the ticket shop as CSV, with the ticket code and the holder's
					e-mail address (a name column is optional), and drop it here. Nothing changes before you
					press Import. Loading the same file again later only shows what changed.
				</p>
			{/if}
		{/if}
	</FoldPanel>
</div>

<style>
	.tickets-page {
		max-width: 980px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		color: #e5e5e5;
	}
	.back {
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 800;
		font-size: 0.85rem;
		align-self: flex-start;
		min-height: 36px;
		display: inline-flex;
		align-items: center;
	}
	h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: -1px;
	}
	.intro {
		margin: -0.4rem 0 0.3rem;
		color: #999;
		line-height: 1.5;
		font-size: 0.9rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.search-form {
		display: flex;
		gap: 0.6rem;
	}
	.search-form input {
		flex: 1;
		min-width: 0;
		min-height: 52px;
		padding: 0 1rem;
		background: #050505;
		border: 1px solid #333;
		border-radius: 12px;
		color: #fff;
		font-size: 1.05rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}
	.search-form input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.15);
	}
	.btn-primary {
		min-height: 52px;
		padding: 0 1.4rem;
		border: none;
		border-radius: 12px;
		background: #2dd4bf;
		color: #000;
		font-weight: 900;
		letter-spacing: 0.5px;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.hint {
		margin: 0.6rem 0 0;
		color: #888;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.error {
		margin: 0.8rem 0 0;
		color: #f87171;
		font-size: 0.9rem;
	}
	.results {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.result-meta,
	.empty {
		margin: 0;
		color: #aaa;
		font-size: 0.85rem;
	}
	.result-meta strong,
	.empty strong {
		color: #fff;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		overflow-wrap: anywhere;
	}
	.locked {
		margin: 0;
		color: #aaa;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.columns {
		margin-top: 1rem;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.columns label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.columns span {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #999;
	}
	.columns select {
		min-height: 42px;
		padding: 0 0.6rem;
		background: #050505;
		border: 1px solid #333;
		border-radius: 10px;
		color: #fff;
		font-size: 0.9rem;
		min-width: 0;
	}

	.review {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.summary-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.summary-chips li {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid #333;
		font-size: 0.8rem;
		font-weight: 800;
		color: #bbb;
	}
	.summary-chips .new {
		border-color: rgba(74, 222, 128, 0.5);
		color: #86efac;
	}
	.summary-chips .changed {
		border-color: rgba(251, 146, 60, 0.5);
		color: #fdba74;
	}
	.summary-chips .bad {
		border-color: rgba(248, 113, 113, 0.5);
		color: #fca5a5;
	}
	.all-set {
		margin: 0;
		color: #86efac;
		font-size: 0.9rem;
	}
	.filter {
		min-height: 42px;
		padding: 0 0.8rem;
		background: #050505;
		border: 1px solid #333;
		border-radius: 10px;
		color: #fff;
	}
	.select-all {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #aaa;
		cursor: pointer;
		min-height: 40px;
	}
	.select-all input,
	.row-main input {
		width: 20px;
		height: 20px;
		/* accent-color for plain browsers, color for the Tailwind forms plugin */
		accent-color: #2dd4bf;
		color: #14b8a6;
		flex-shrink: 0;
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.row {
		border: 1px solid #1f1f1f;
		border-radius: 10px;
		background: #0e0e0e;
		padding: 0.45rem 0.6rem;
		transition: opacity 0.15s;
	}
	.row.off {
		opacity: 0.55;
	}
	.row-main {
		display: grid;
		grid-template-columns: auto minmax(7rem, auto) 1fr auto;
		align-items: center;
		gap: 0.3rem 0.7rem;
		cursor: pointer;
		min-height: 36px;
	}
	.row-code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: #2dd4bf;
		font-weight: 700;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.row-email {
		color: #ddd;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.row-name {
		color: #999;
		font-size: 0.8rem;
		text-align: right;
	}
	.muted {
		color: #666;
		font-style: italic;
	}
	.row-diff {
		grid-column: 3 / 5;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
		color: #ddd;
		overflow-wrap: anywhere;
	}
	.row-diff s {
		color: #888;
	}
	.row-diff b {
		color: #fdba74;
	}
	.row-extra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0.35rem 0 0 2rem;
	}
	.row-extra:empty {
		display: none;
	}
	.tag {
		font-size: 0.72rem;
		color: #aaa;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
	}
	.holder {
		min-height: 34px;
		padding: 0 0.8rem;
		border-radius: 999px;
		border: 1px solid #444;
		background: transparent;
		color: #bbb;
		font-size: 0.75rem;
		font-weight: 800;
		cursor: pointer;
	}
	.holder.on {
		border-color: #fb923c;
		background: rgba(251, 146, 60, 0.12);
		color: #fdba74;
	}
	.holder:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.plain {
		margin: 0;
		padding-left: 1.2rem;
		color: #ddd;
		font-size: 0.85rem;
		line-height: 1.6;
	}
	.drop-row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
	}

	.code-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		font-size: 0.8rem;
		color: #aaa;
	}
	code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}

	.action-bar {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.6rem 1rem;
		padding: 0.7rem 0.8rem;
		margin-top: 0.3rem;
		background: rgba(10, 10, 10, 0.95);
		backdrop-filter: blur(8px);
		border: 1px solid #2dd4bf;
		border-radius: 14px;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.6);
	}
	.action-text {
		color: #ccc;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.note {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.9rem 1rem;
		border: 1px solid #2a2a2a;
		border-left: 4px solid #4ade80;
		border-radius: 12px;
		background: #080808;
		font-size: 0.85rem;
		line-height: 1.5;
	}
	.note strong {
		color: #4ade80;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
	}
	.note ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	.alarm {
		color: #f87171;
	}

	@media (max-width: 640px) {
		h1 {
			font-size: 1.6rem;
		}
		.search-form .btn-primary {
			padding: 0 1rem;
		}
		.columns {
			grid-template-columns: 1fr;
		}
		.row-main {
			grid-template-columns: auto 1fr;
		}
		.row-email,
		.row-name,
		.row-diff {
			grid-column: 2;
			text-align: left;
		}
		.row-extra {
			margin-left: 1.9rem;
		}
		.action-bar .btn-primary {
			flex: 1;
		}
	}
</style>
