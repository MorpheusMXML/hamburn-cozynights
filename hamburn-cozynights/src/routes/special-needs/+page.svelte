<!--
Special-needs request of the signed-in ticket (docs/guide/special-needs.md).
What the guest writes may be health data: it only goes to the server, never
into the URL or the browser's storage, and the page asks what is needed, not why.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { confirmDialog, toast } from '$lib/dialogs';
	import {
		BURNER_NAME_MAX,
		REQUEST_TEXT_MAX,
		SPECIAL_NEEDS,
		STATUS_LABELS,
		needLabel,
		type RequestFormErrors
	} from '$lib/special-needs';

	export let data: PageData;
	export let form: ActionData;

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';

	type Values = { needs: string[]; text: string; burnerName: string };
	const formValues = (source: unknown): Values | null => {
		const v = (source as { values?: Values } | null)?.values;
		return v ? { needs: [...v.needs], text: v.text, burnerName: v.burnerName } : null;
	};

	// Without JavaScript a failed send comes back as `form`; keep what was typed.
	const returned = formValues(form);
	let editing = !data.request || !!returned;
	let needs: string[] = returned?.needs ?? [...(data.request?.needs ?? [])];
	let text = returned?.text ?? data.request?.text ?? '';
	let burnerName = returned?.burnerName ?? data.request?.burnerName ?? '';
	let consent = false;
	let errors: RequestFormErrors = (form as { errors?: RequestFormErrors } | null)?.errors ?? {};
	let formError = (form as { error?: string } | null)?.error ?? '';
	let isSaving = false;

	$: request = data.request;
	$: canEdit = data.requestsOpen && (!request || request.status === 'pending');
	$: textLeft = REQUEST_TEXT_MAX - text.length;

	function startEditing() {
		needs = [...(request?.needs ?? [])];
		text = request?.text ?? '';
		burnerName = request?.burnerName ?? '';
		consent = false;
		errors = {};
		formError = '';
		editing = true;
	}

	/** A corrected field loses its error right away. */
	function fixed(field: keyof RequestFormErrors) {
		if (errors[field]) errors = { ...errors, [field]: undefined };
	}

	function failureText(result: { data?: Record<string, unknown> }, fallback: string) {
		return typeof result.data?.error === 'string' ? result.data.error : fallback;
	}

	function formatDate(value: string) {
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
</script>

<svelte:head>
	<title>Special-needs spot · CozyNights</title>
</svelte:head>

<div class="container">
	<header>
		<a href="/map" class="back-link">← Back to the map</a>
		<h1>Special-needs spot</h1>
		<p class="intro">
			Some spots are kept for guests who need something special: a lower bunk, step-free access, a
			quiet room, a socket for a medical device. Tell the crew what you need, and they will try to
			find a fitting spot for you, even before booking opens.
		</p>
	</header>

	{#if request}
		<section class="card status-{request.status}" aria-labelledby="status-title">
			<h2 id="status-title">
				{#if request.status === 'pending'}⏳{:else if request.status === 'approved'}✅{:else}✋{/if}
				Your request: {STATUS_LABELS[request.status]}
			</h2>

			{#if request.status === 'pending'}
				<p>
					The crew will look at it{data.isBookingActive ? '' : ' before booking opens'}. You get a
					message when they have decided.
				</p>
			{:else if request.status === 'approved' && data.spot}
				<p>The crew picked this spot for you:</p>
				<p class="spot"><strong>{data.spot.label}</strong></p>
				<p class="actions-row">
					<a class="btn-primary" href="/room/{data.spot.roomId}">Open my room</a>
					{#if data.passCode}
						<a class="btn-secondary" href="/pass/{data.passCode}">🎫 Booking pass</a>
					{/if}
				</p>
				<p class="hint">To change the spot, please contact the crew.</p>
			{:else if request.status === 'approved'}
				<p>
					The crew is picking a fitting spot for you. You get a message with the details as soon as
					it is booked.
				</p>
			{:else}
				<p>
					The crew could not offer you a special-needs spot. You can book a spot like everyone else
					when booking opens. If you have questions, please contact the crew.
				</p>
			{/if}

			{#if !editing}
				<div class="sent">
					<h3>What you sent{request.sentAt ? ` · ${formatDate(request.sentAt)}` : ''}</h3>
					<ul class="needs-list">
						{#each request.needs as need}
							<li>{needLabel(need)}</li>
						{/each}
					</ul>
					{#if request.text}
						<p class="sent-text">{request.text}</p>
					{/if}
					{#if request.burnerName}
						<p class="hint">Burner name for your spot: <strong>{request.burnerName}</strong></p>
					{/if}
				</div>

				<div class="actions-row">
					{#if canEdit}
						<button type="button" class="btn-secondary" on:click={startEditing}
							>Change request</button
						>
					{/if}
					<form
						method="POST"
						action="?/withdraw"
						use:enhance={async ({ cancel }) => {
							const confirmed = await confirmDialog(
								data.spot && request?.status === 'approved'
									? 'Your request and everything you wrote are deleted right away. Your spot stays yours, but the crew no longer knows why you have it.'
									: 'Your request and everything you wrote are deleted right away. You can send a new one while requests are open.',
								{
									title: 'Withdraw your request?',
									tone: 'warning',
									confirmLabel: 'Withdraw request',
									cancelLabel: 'Keep it'
								}
							);
							if (!confirmed) {
								cancel();
								return;
							}
							isSaving = true;
							return async ({ result, update }) => {
								isSaving = false;
								if (result.type === 'failure') {
									toast(failureText(result, 'Your request could not be withdrawn.'), 'danger');
									return;
								}
								if (result.type === 'error') {
									toast(NO_CONNECTION, 'danger');
									return;
								}
								toast('Your request was withdrawn and deleted.', 'success');
								needs = [];
								text = '';
								burnerName = '';
								editing = true;
								await update();
							};
						}}
					>
						<button type="submit" class="btn-link" disabled={isSaving}>Withdraw request</button>
					</form>
				</div>
			{/if}
		</section>
	{/if}

	{#if editing && canEdit}
		<section class="card form-card" aria-labelledby="form-title">
			<h2 id="form-title">{request ? 'Change your request' : 'Ask for a special-needs spot'}</h2>

			{#if formError}
				<p class="form-error" role="alert">{formError}</p>
			{/if}

			<form
				method="POST"
				action="?/save"
				novalidate
				use:enhance={() => {
					isSaving = true;
					errors = {};
					formError = '';
					return async ({ result, update }) => {
						isSaving = false;
						if (result.type === 'failure') {
							const failed = (result.data ?? {}) as { errors?: RequestFormErrors; error?: string };
							errors = failed.errors ?? {};
							formError =
								failed.error ??
								(failed.errors ? 'Please check the marked fields.' : 'Nothing was sent.');
							return;
						}
						if (result.type === 'error') {
							formError = NO_CONNECTION;
							return;
						}
						toast(
							request ? 'Your changes are saved.' : 'Your request is sent to the crew.',
							'success'
						);
						editing = false;
						consent = false;
						await update({ reset: false });
					};
				}}
			>
				<fieldset aria-describedby={errors.needs ? 'needs-error' : undefined}>
					<legend>What do you need?</legend>
					{#each SPECIAL_NEEDS as need}
						<label class="check">
							<input
								type="checkbox"
								name="needs"
								value={need.value}
								bind:group={needs}
								on:change={() => fixed('needs')}
							/>
							<span>{need.label}</span>
						</label>
					{/each}
					{#if errors.needs}
						<p class="field-error" id="needs-error">{errors.needs}</p>
					{/if}
				</fieldset>

				<div class="field">
					<label for="request-text">In a few words: what should the crew know?</label>
					<textarea
						id="request-text"
						name="text"
						rows="5"
						maxlength={REQUEST_TEXT_MAX}
						bind:value={text}
						on:input={() => fixed('text')}
						aria-describedby="request-text-hint{errors.text ? ' request-text-error' : ''}"
						aria-invalid={!!errors.text}
					></textarea>
					<small id="request-text-hint" class="hint">
						Describe what you need, not why. Please no diagnoses or medical details: the crew
						doesn't need them. {textLeft} characters left.
					</small>
					{#if errors.text}
						<p class="field-error" id="request-text-error">{errors.text}</p>
					{/if}
				</div>

				<div class="field">
					<label for="request-burner">Burner name for your spot (optional)</label>
					<input
						id="request-burner"
						name="burnerName"
						type="text"
						maxlength={BURNER_NAME_MAX}
						autocomplete="off"
						autocapitalize="words"
						bind:value={burnerName}
						on:input={() => fixed('burnerName')}
						aria-describedby="request-burner-hint{errors.burnerName ? ' request-burner-error' : ''}"
					/>
					<small id="request-burner-hint" class="hint">
						Others in your room see it next to your spot. Leave it empty and you get a random one.
					</small>
					{#if errors.burnerName}
						<p class="field-error" id="request-burner-error">{errors.burnerName}</p>
					{/if}
				</div>

				<label class="check consent">
					<input
						type="checkbox"
						name="consent"
						value="yes"
						bind:checked={consent}
						on:change={() => fixed('consent')}
						aria-describedby={errors.consent ? 'consent-error' : undefined}
					/>
					<span>
						I agree that the CozyNights crew uses what I write here to find a fitting spot for me.
						It may include information about my health. Only the crew's admins can read it; it is
						stored encrypted and deleted after the event at the latest. I can withdraw my request on
						this page at any time. Details: <a
							href="/privacy#special-needs"
							target="_blank"
							rel="noopener">privacy policy</a
						>.
					</span>
				</label>
				{#if errors.consent}
					<p class="field-error" id="consent-error">{errors.consent}</p>
				{/if}

				<div class="actions-row">
					<button type="submit" class="btn-primary" disabled={isSaving}>
						{isSaving ? 'Sending…' : request ? 'Save changes' : 'Send request'}
					</button>
					{#if request}
						<button
							type="button"
							class="btn-secondary"
							on:click={() => (editing = false)}
							disabled={isSaving}>Cancel</button
						>
					{/if}
				</div>
			</form>
		</section>
	{:else if !request && !data.requestsOpen}
		<section class="card">
			<h2>Requests are closed right now</h2>
			<p>
				The crew isn't taking special-needs requests at the moment. If you need a special spot,
				please contact the crew.
			</p>
		</section>
	{/if}

	{#if request && data.notify && (data.notify.email || data.notify.telegram)}
		<section class="card notify" aria-label="Where messages go">
			{#if data.notify.email}
				<p>
					<span aria-hidden="true">📧</span> Messages about your request go to
					<strong>{data.notify.email}</strong>, the address of your ticket.
				</p>
			{/if}
			{#if data.notify.telegram?.connected}
				<form
					method="POST"
					action="?/disconnectTelegram"
					use:enhance={() => {
						isSaving = true;
						return async ({ result, update }) => {
							isSaving = false;
							if (result.type === 'failure' || result.type === 'error') {
								toast('Telegram updates could not be turned off. Please try again.', 'danger');
								return;
							}
							toast('Telegram updates are off.', 'success');
							await update();
						};
					}}
				>
					<span aria-hidden="true">✈️</span> Updates on Telegram are on.
					<button type="submit" class="btn-link" disabled={isSaving}>Turn off</button>
				</form>
			{:else if data.notify.telegram}
				<!-- A plain post into a new tab: the answer is a redirect to t.me. -->
				<form method="POST" action="?/connectTelegram" target="_blank" rel="noopener">
					<button type="submit" class="btn-telegram">
						<span aria-hidden="true">✈️</span> Get updates on Telegram
					</button>
					<small class="hint">
						Optional. Opens Telegram — tap <strong>START</strong> there. Reload this page afterwards.
					</small>
				</form>
			{/if}
		</section>
	{/if}
</div>

<style>
	.container {
		max-width: 720px;
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		color: #fff;
	}
	header {
		margin-bottom: clamp(1.25rem, 5vw, 2rem);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	h1 {
		margin: 0.5rem 0;
		font-size: clamp(1.75rem, 7vw, 2.5rem);
		font-weight: 900;
		color: #f472b6;
	}
	.intro {
		color: #b5b5b5;
		line-height: 1.5;
		margin: 0;
	}

	.card {
		background: #111;
		border: 1px solid #222;
		border-left: 4px solid #2dd4bf;
		border-radius: 20px;
		padding: clamp(1rem, 5vw, 1.75rem);
		margin-bottom: clamp(1rem, 4vw, 1.5rem);
	}
	.card h2 {
		margin: 0 0 0.75rem;
		font-size: 1.2rem;
		font-weight: 900;
	}
	.card p {
		color: #c8c8c8;
		line-height: 1.5;
		margin: 0 0 0.75rem;
		overflow-wrap: anywhere;
	}
	.status-pending {
		border-left-color: #fb923c;
	}
	.status-declined {
		border-left-color: #737373;
	}
	.form-card {
		border-left-color: #f472b6;
	}
	.spot strong {
		color: #fff;
		font-size: 1.1rem;
	}

	.sent {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid #222;
	}
	.sent h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #a3a3a3;
	}
	.needs-list {
		margin: 0 0 0.75rem;
		padding-left: 1.2rem;
		color: #e5e5e5;
		line-height: 1.6;
	}
	.sent-text {
		white-space: pre-line;
		background: #0a0a0a;
		border-radius: 10px;
		padding: 0.75rem 1rem;
	}

	fieldset {
		border: none;
		margin: 0 0 1.25rem;
		padding: 0;
	}
	legend,
	.field label {
		display: block;
		font-weight: 800;
		margin-bottom: 0.5rem;
		color: #fff;
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		min-height: 44px;
		padding: 0.35rem 0;
		color: #e5e5e5;
		line-height: 1.45;
		cursor: pointer;
	}
	.check input {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.15rem;
		flex: none;
		accent-color: #2dd4bf;
	}
	.consent span {
		font-size: 0.9rem;
		color: #c8c8c8;
	}
	.consent a {
		color: #2dd4bf;
	}
	.field {
		margin-bottom: 1.25rem;
	}
	textarea,
	input[type='text'] {
		width: 100%;
		box-sizing: border-box;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 10px;
		color: #fff;
		font: inherit;
		font-size: 1rem;
		padding: 0.75rem 1rem;
	}
	textarea {
		resize: vertical;
		min-height: 7rem;
	}
	textarea:focus,
	input[type='text']:focus {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.hint {
		display: block;
		color: #a3a3a3;
		font-size: 0.85rem;
		line-height: 1.4;
		margin-top: 0.35rem;
	}
	.field-error,
	.form-error {
		color: #fecaca;
		font-weight: 700;
		margin: 0.4rem 0 0;
	}
	.form-error {
		margin-bottom: 1rem;
	}

	.actions-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0 0;
	}
	.btn-primary,
	.btn-secondary,
	.btn-telegram {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 1.25rem;
		border-radius: 10px;
		font: inherit;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
	}
	.btn-primary {
		background: #2dd4bf;
		border: none;
		color: #000;
	}
	.btn-secondary {
		background: transparent;
		border: 1px solid #2dd4bf;
		color: #2dd4bf;
	}
	.btn-telegram {
		background: #229ed9;
		border: none;
		color: #fff;
		margin-bottom: 0.25rem;
	}
	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.btn-link {
		background: none;
		border: none;
		padding: 0.5rem 0.25rem;
		min-height: 44px;
		color: #2dd4bf;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		cursor: pointer;
	}
	.notify p,
	.notify form {
		margin: 0 0 0.5rem;
		color: #b5b5b5;
		font-size: 0.9rem;
	}
</style>
