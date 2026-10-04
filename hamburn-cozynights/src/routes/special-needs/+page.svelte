<!--
Special-needs request of the signed-in ticket (docs/guide/special-needs.md):
something a guest needs to sleep well, or a room or spots close together for
an art project, a workshop, a theme camp or a crew — on their own or as a
request group. What the guest writes may be health data: it only goes to the
server, never into the URL or the browser's storage, and the page asks what is
needed, not why. Members of a group see its name and the burner names in it,
never what anyone ticked or wrote, nor what the crew decided.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import type { ActionData, PageData } from './$types';
	import { confirmDialog, toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';
	import {
		ACCESS_NEEDS,
		BURNER_NAME_MAX,
		GROUP_NAME_MAX,
		OTHER_NEED,
		PROJECT_NEEDS,
		REQUEST_TEXT_MAX,
		STATUS_LABELS,
		needLabel,
		type RequestFormErrors
	} from '$lib/special-needs';

	export let data: PageData;
	export let form: ActionData;

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';

	/** The two parts of the list, then "Something else". */
	const NEED_SECTIONS: { title: string; needs: readonly { value: string; label: string }[] }[] = [
		{ title: 'Something I need to sleep well', needs: ACCESS_NEEDS },
		{ title: 'An art project, a workshop, a theme camp or a crew', needs: PROJECT_NEEDS },
		{ title: '', needs: [OTHER_NEED] }
	];

	// What the page says about an invite link it can't follow.
	const INVITE_DECIDED =
		"You opened a group invite, but the crew has already decided on your request, so it can't join a group anymore. If you'd like to sleep close to that group, please contact the crew.";
	const INVITE_OTHER_GROUP =
		'You opened an invite to another group. Leave your group first, then open the invite again.';
	const INVITE_CLOSED =
		'You opened a group invite, but requests are closed right now, so nobody can join a group. If you need help, please contact the crew.';

	type GroupMode = 'none' | 'start' | 'join';
	type Values = {
		needs: string[];
		text: string;
		burnerName: string;
		groupMode?: string;
		groupName?: string;
		groupCode?: string;
	};
	const formValues = (source: unknown): Values | null => {
		const v = (source as { values?: Values } | null)?.values;
		return v ? { ...v, needs: [...v.needs] } : null;
	};
	const asGroupMode = (value: unknown): GroupMode | null =>
		value === 'none' || value === 'start' || value === 'join' ? value : null;

	/** A new request, or one that waits and is in no group, can join a group. */
	const joinable = (d: PageData) =>
		d.requestsOpen && (!d.request || (d.request.status === 'pending' && !d.group));

	// Without JavaScript a failed send comes back as `form`; keep what was typed.
	// "Change request" is a link to ?edit, so it works without JavaScript too.
	// An invite link (?group=CODE) opens the form with the group to join filled in.
	const returned = formValues(form);
	const invited = !!data.invite && joinable(data);
	let editing = !data.request || !!returned || $page.url.searchParams.has('edit') || invited;
	let needs: string[] = returned?.needs ?? [...(data.request?.needs ?? [])];
	let text = returned?.text ?? data.request?.text ?? '';
	let burnerName = returned?.burnerName ?? data.request?.burnerName ?? '';
	let groupMode: GroupMode = asGroupMode(returned?.groupMode) ?? (invited ? 'join' : 'none');
	let groupName = returned?.groupName ?? '';
	let groupCode = returned?.groupCode ?? data.invite ?? '';
	let consent = false;
	let errors: RequestFormErrors = (form as { errors?: RequestFormErrors } | null)?.errors ?? {};
	let formError = (form as { error?: string } | null)?.error ?? '';
	let isSaving = false;
	// Copying needs JavaScript: without it the link is there to copy by hand.
	let canCopy = false;
	onMount(() => (canCopy = true));

	$: request = data.request;
	$: group = data.group;
	$: canEdit = data.requestsOpen && (!request || request.status === 'pending');
	// Never an empty card: a decided request or closed requests show the request instead.
	$: showForm = editing && canEdit;
	$: canJoin = joinable(data);
	// In a group or joining one, the own needs and text are optional.
	$: grouped = !!group || groupMode === 'join';
	$: textLeft = REQUEST_TEXT_MAX - text.length;
	$: groupError = !!(errors.groupName || errors.groupCode);
	$: sameInvite = !!data.invite && !!group && data.invite === group.code;
	$: inviteNotice =
		!data.invite || sameInvite
			? ''
			: request && request.status !== 'pending'
				? INVITE_DECIDED
				: !data.requestsOpen
					? INVITE_CLOSED
					: group
						? INVITE_OTHER_GROUP
						: '';

	function startEditing() {
		needs = [...(request?.needs ?? [])];
		text = request?.text ?? '';
		burnerName = request?.burnerName ?? '';
		groupMode = data.invite && canJoin ? 'join' : 'none';
		groupName = '';
		groupCode = data.invite ?? '';
		consent = false;
		errors = {};
		formError = '';
		editing = true;
	}

	/** A corrected field loses its error right away. */
	function fixed(field: keyof RequestFormErrors) {
		if (errors[field]) errors = { ...errors, [field]: undefined };
	}

	// Ticked by hand rather than bind:group, which can split the boxes of
	// nested {#each} blocks into separate groups.
	function toggleNeed(value: string, on: boolean) {
		const others = needs.filter((need) => need !== value);
		needs = on ? [...others, value] : others;
		fixed('needs');
	}

	function pickGroupMode(mode: GroupMode) {
		groupMode = mode;
		// "Just for me" drops a typed group name, so the server doesn't refuse it.
		if (mode === 'none') groupName = '';
		fixed('groupName');
		fixed('groupCode');
	}

	function failureText(result: { data?: Record<string, unknown> }, fallback: string) {
		return typeof result.data?.error === 'string' ? result.data.error : fallback;
	}

	/** The toast after a save, by what happened to the request and its group. */
	function savedText(saved: unknown, joined: unknown): string {
		if (joined === 'already') return 'You are in this group already.';
		const created = saved === 'created';
		if (joined === 'started') {
			return created
				? 'Your request is sent, and your group is ready. Share the link below.'
				: 'Your changes are saved, and your group is ready. Share the link below.';
		}
		if (joined === 'joined') {
			return created
				? 'Your request is sent, and you are in the group.'
				: 'Your changes are saved, and you are in the group.';
		}
		return created ? 'Your request is sent to the crew.' : 'Your changes are saved.';
	}

	/** What leaving does to this request, for the confirm dialog. */
	function leaveMessage(): string {
		const last =
			group?.members.length === 1 ? ' You are the last one in it: the group is deleted.' : '';
		if (request && request.needs.length === 0) {
			const keeps =
				request.status === 'approved' && data.spot
					? ' You keep your spot, but it becomes an ordinary booking.'
					: '';
			return `Your request was only about this group, so it is deleted when you leave.${keeps}${last}`;
		}
		return `Your own request stays with the crew, without the group. The others no longer see your burner name.${last}`;
	}

	async function copyLink(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			toast('The link is copied.', 'success');
		} catch {
			// No clipboard (an old browser, a page not on https): select it for copying by hand.
			const input = document.getElementById('group-link') as HTMLInputElement | null;
			input?.focus();
			input?.select();
			toast("Copying didn't work. Tap the link and copy it by hand.", 'warning');
		}
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
			Some spots are kept back for the crew to hand out: for guests who need something special — a
			lower bunk, step-free access, a quiet room — and for art projects, workshops, theme camps and
			crews who want a room or spots close together. Tell the crew what you need, on your own or as
			a group, and they will try to find a fitting spot for you, even before booking opens.
		</p>
	</header>

	{#if inviteNotice}
		<p class="notice" role="status">{inviteNotice}</p>
	{/if}

	{#if request}
		<section class="card status-{request.status}" aria-labelledby="status-title">
			<h2 id="status-title">
				{#if request.status === 'pending'}⏳{:else if request.status === 'approved'}✅{:else}✋{/if}
				Your request: {STATUS_LABELS[request.status]}
			</h2>

			{#if request.status === 'pending'}
				<p>
					The crew will look at it{data.guestPhase === 'staging' ? ' before booking opens' : ''}.
					You get a message when they have decided.
				</p>
			{:else if request.status === 'approved' && data.spot}
				{#if data.spot.fixed}
					<p>The crew picked this spot for you:</p>
				{:else}
					<p>
						You keep your current spot until the crew books a more fitting one for you; you get a
						message when they do. Your spot:
					</p>
				{/if}
				<p class="spot"><strong>{data.spot.label}</strong></p>
				<p class="actions-row">
					<a class="btn-primary" href="/room/{data.spot.roomId}">Open my room</a>
					{#if data.passCode}
						<a class="btn-secondary" href="/pass/{data.passCode}">🎫 Booking pass</a>
					{/if}
				</p>
				{#if data.spot.fixed}
					<p class="hint">To change the spot, please contact the crew.</p>
				{/if}
			{:else if request.status === 'approved'}
				<p>
					The crew is picking a fitting spot for you. You get a message with the details as soon as
					it is booked.
				</p>
			{:else if data.spot}
				<p>
					The crew could not offer you a special-needs spot. You keep your current spot,
					<strong>{data.spot.label}</strong>. If you have questions, please contact the crew.
				</p>
			{:else}
				<p>
					The crew could not offer you a special-needs spot.
					{data.guestPhase === 'closed'
						? 'Booking has closed, so no spot can be booked anymore. If you need one, please contact the crew.'
						: 'You can book a spot like everyone else when booking opens. If you have questions, please contact the crew.'}
				</p>
			{/if}

			{#if !showForm}
				<div class="sent">
					<h3>What you sent{request.sentAt ? ` · ${formatDate(request.sentAt)}` : ''}</h3>
					{#if request.needs.length > 0}
						<ul class="needs-list">
							{#each request.needs as need}
								<li>{needLabel(need)}</li>
							{/each}
						</ul>
					{:else if group}
						<p>Nothing ticked: you asked as part of your group.</p>
					{:else}
						<p>
							Nothing ticked, and you are not in a group anymore. {canEdit
								? 'Change your request to tick what you need, or withdraw it.'
								: 'If you still need something, please contact the crew, or withdraw the request.'}
						</p>
					{/if}
					{#if request.text}
						<p class="sent-text">{request.text}</p>
					{/if}
					{#if request.burnerName}
						<p class="hint">Burner name for your spot: <strong>{request.burnerName}</strong></p>
					{/if}
				</div>

				{#if canEdit && !group}
					<p class="hint ask-together">
						Asking together with others? <a
							href="?edit"
							on:click|preventDefault={startEditing}
							data-sveltekit-noscroll>Change your request</a
						> to start or join a group.
					</p>
				{/if}

				<div class="actions-row">
					{#if canEdit}
						<a
							class="btn-secondary"
							href="?edit"
							on:click|preventDefault={startEditing}
							data-sveltekit-noscroll>Change request</a
						>
					{/if}
					<form
						method="POST"
						action="?/withdraw"
						use:enhance={async ({ cancel }) => {
							const confirmed = await confirmDialog(
								(data.spot && request?.status === 'approved'
									? 'Your request and everything you wrote are deleted right away. Your spot stays yours, but the crew no longer knows why you have it.'
									: 'Your request and everything you wrote are deleted right away. You can send a new one while requests are open.') +
									(group ? ' You also leave your group.' : ''),
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
								groupMode = 'none';
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

	{#if showForm}
		<section class="card form-card" aria-labelledby="form-title">
			<h2 id="form-title">{request ? 'Change your request' : 'Ask for a special-needs spot'}</h2>

			{#if formError}
				<p class="form-error" role="alert">{formError}</p>
			{/if}

			<form
				method="POST"
				action="?/save"
				novalidate
				use:enhance={({ formElement }) => {
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
							if (failed.errors) {
								const first = await revealInvalid(formElement);
								// A refused group name or code: the cursor goes into that field,
								// not onto the first choice of the group box.
								const field = errors.groupName
									? 'group-name'
									: errors.groupCode
										? 'group-code'
										: '';
								if (field && first?.closest('.group-choice')) {
									document.getElementById(field)?.focus({ preventScroll: true });
								}
							} else if (result.status === 409) {
								// Refused because the crew decided meanwhile: show the decision.
								await invalidateAll();
							}
							return;
						}
						if (result.type === 'error') {
							formError = NO_CONNECTION;
							return;
						}
						const saved = result.type === 'success' ? result.data : undefined;
						toast(savedText(saved?.saved, saved?.group), 'success');
						editing = false;
						consent = false;
						groupName = '';
						await update({ reset: false });
					};
				}}
			>
				<fieldset
					class="field-box"
					class:state-ring={!!errors.needs}
					class:state-ring-alert={!!errors.needs}
					data-state={errors.needs ? 'danger' : undefined}
					aria-describedby="needs-hint{errors.needs ? ' needs-error' : ''}"
				>
					<legend>What is your request about?</legend>
					<small id="needs-hint" class="hint needs-hint">
						{grouped
							? 'In a group this is optional: tick only what you need yourself.'
							: 'Tick everything that fits.'}
					</small>
					{#each NEED_SECTIONS as section (section.title)}
						{#if section.title}
							<p class="need-head">{section.title}</p>
						{/if}
						{#each section.needs as need (need.value)}
							<label class="check">
								<input
									type="checkbox"
									name="needs"
									value={need.value}
									checked={needs.includes(need.value)}
									on:change={(event) => toggleNeed(need.value, event.currentTarget.checked)}
								/>
								<span>{need.label}</span>
							</label>
						{/each}
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
						For a project: what it is, how many of you there are, and a room or house you have in
						mind. For something you need: what, not why — please no diagnoses or medical details.
						{textLeft} characters left.{grouped
							? ' In a group, one of you explaining the project is enough.'
							: ''}
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
						aria-invalid={!!errors.burnerName}
					/>
					<small id="request-burner-hint" class="hint">
						Others in your room see it next to your spot, and so does your group if you are in one.
						Leave it empty and you get a random one.
					</small>
					{#if errors.burnerName}
						<p class="field-error" id="request-burner-error">{errors.burnerName}</p>
					{/if}
				</div>

				{#if group}
					<p class="in-group">
						You are in the group “{group.name}”. To leave it, use “Leave the group” below.
					</p>
				{:else}
					<!-- Real radios and every field visible: this works without JavaScript too. -->
					<fieldset
						class="field-box group-choice"
						class:state-ring={groupError}
						class:state-ring-alert={groupError}
						data-state={groupError ? 'danger' : undefined}
					>
						<legend>Asking together with others?</legend>
						<label class="check">
							<input
								type="radio"
								name="groupMode"
								value="none"
								bind:group={groupMode}
								on:change={() => pickGroupMode('none')}
							/>
							<span>Just for me</span>
						</label>

						<label class="check">
							<input
								type="radio"
								name="groupMode"
								value="start"
								bind:group={groupMode}
								on:change={() => pickGroupMode('start')}
								aria-describedby="group-start-hint"
							/>
							<span>Start a group</span>
						</label>
						<div class="choice-detail">
							<small id="group-start-hint" class="hint">
								For an art project, a workshop, a theme camp or friends who want to sleep close
								together. You get a link to share; everyone joins with their own ticket code.
							</small>
							<div class="field">
								<label for="group-name">Name of the group</label>
								<input
									id="group-name"
									name="groupName"
									type="text"
									maxlength={GROUP_NAME_MAX}
									autocomplete="off"
									bind:value={groupName}
									on:input={() => pickGroupMode('start')}
									aria-describedby="group-name-hint{errors.groupName ? ' group-name-error' : ''}"
									aria-invalid={!!errors.groupName}
								/>
								<small id="group-name-hint" class="hint">
									For example your project's name. Only your group and the crew see it.
								</small>
								{#if errors.groupName}
									<p class="field-error" id="group-name-error">{errors.groupName}</p>
								{/if}
							</div>
						</div>

						<label class="check">
							<input
								type="radio"
								name="groupMode"
								value="join"
								bind:group={groupMode}
								on:change={() => pickGroupMode('join')}
							/>
							<span>Join a group</span>
						</label>
						<div class="choice-detail">
							<div class="field">
								<label for="group-code">Group code</label>
								<input
									id="group-code"
									name="groupCode"
									type="text"
									placeholder="ABCD-EF23"
									autocapitalize="characters"
									autocomplete="off"
									spellcheck="false"
									bind:value={groupCode}
									on:input={() => pickGroupMode('join')}
									aria-describedby="group-code-hint{errors.groupCode ? ' group-code-error' : ''}"
									aria-invalid={!!errors.groupCode}
								/>
								<small id="group-code-hint" class="hint">
									From the group's link, or ask someone in the group.
								</small>
								{#if errors.groupCode}
									<p class="field-error" id="group-code-error">{errors.groupCode}</p>
								{/if}
							</div>
						</div>

						<p class="hint group-note">
							Everyone in a group sees the group's name and the burner names in it — never what
							anyone ticked or wrote, or what the crew decided. The crew looks at the group together
							and tries to put you close to each other.
						</p>
					</fieldset>
				{/if}

				<label
					class="check consent field-box"
					class:state-ring={!!errors.consent}
					class:state-ring-alert={!!errors.consent}
					data-state={errors.consent ? 'danger' : undefined}
				>
					<input
						type="checkbox"
						name="consent"
						value="yes"
						bind:checked={consent}
						on:change={() => fixed('consent')}
						aria-invalid={!!errors.consent}
						aria-describedby={errors.consent ? 'consent-error' : undefined}
					/>
					<span>
						I agree that the CozyNights crew uses what I write here to find a fitting spot for me.
						It may include information about my health. Only the crew's admins can read it; it is
						stored encrypted and deleted after the event at the latest. If I start or join a group,
						everyone in it sees the group's name and my burner name, never what I ticked or wrote. I
						can leave the group and withdraw my request on this page at any time. Details: <a
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
						<a
							class="btn-secondary"
							href="/special-needs"
							on:click|preventDefault={() => (editing = false)}
							data-sveltekit-noscroll>Cancel</a
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

	{#if request && group}
		<!-- Turquoise like any card: pink is for ♿ alone, and a group is not about needs. -->
		<section class="card group-card" aria-labelledby="group-title">
			<h2 id="group-title"><span aria-hidden="true">👥</span> Your group: {group.name}</h2>
			{#if sameInvite}
				<p class="joined">✅ You are in this group.</p>
			{/if}

			<p class="member-count">{group.members.length} of {group.max} people:</p>
			<ul class="members">
				{#each group.members as member, index (index)}
					<li>{member.name}{member.you ? ' (you)' : ''}</li>
				{/each}
			</ul>

			{#if data.requestsOpen && !group.full}
				<h3>Invite the others</h3>
				<div class="field">
					<label for="group-link">Link to share</label>
					<div class="link-row">
						<input
							id="group-link"
							type="text"
							readonly
							value={group.link}
							on:focus={(event) => event.currentTarget.select()}
						/>
						{#if canCopy}
							<button
								type="button"
								class="btn-secondary"
								on:click={() => group && copyLink(group.link)}>📋 Copy link</button
							>
						{/if}
					</div>
					<small class="hint">
						Group code: <strong class="code">{group.code}</strong>. Anyone with this link or code
						can join and see the burner names in it, so share it only with your people. Each of them
						signs in with their own ticket code.
					</small>
				</div>
			{:else if group.full}
				<p>Your group is full: a group can have at most {group.max} people.</p>
			{:else}
				<p>Requests are closed right now, so nobody can join.</p>
			{/if}

			<p class="hint">
				The crew looks at everyone in the group together and tries to put you close to each other.
				Each of you gets your own message about your own request.
			</p>

			<!-- Without JavaScript a plain post with no confirmation, like Withdraw. -->
			<form
				method="POST"
				action="?/leaveGroup"
				use:enhance={async ({ cancel }) => {
					const confirmed = await confirmDialog(leaveMessage(), {
						title: 'Leave the group?',
						tone: 'warning',
						confirmLabel: 'Leave the group',
						cancelLabel: 'Stay'
					});
					if (!confirmed) {
						cancel();
						return;
					}
					isSaving = true;
					return async ({ result, update }) => {
						isSaving = false;
						if (result.type === 'failure') {
							toast(
								failureText(result, 'You could not leave the group. Please try again.'),
								'danger'
							);
							// Not in a group (anymore): show how things are.
							if (result.status === 404) await invalidateAll();
							return;
						}
						if (result.type === 'error') {
							toast(NO_CONNECTION, 'danger');
							return;
						}
						const deleted = result.type === 'success' && result.data?.left === 'withdrawn';
						toast(
							deleted ? 'You left the group, and your request is deleted.' : 'You left the group.',
							'success'
						);
						groupMode = 'none';
						if (deleted) {
							needs = [];
							text = '';
							burnerName = '';
							editing = true;
						}
						await update();
					};
				}}
			>
				<button type="submit" class="btn-link" disabled={isSaving}>Leave the group</button>
			</form>
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

	/* An invite link the page can't follow: why, right at the top. */
	.notice {
		margin: 0 0 clamp(1rem, 4vw, 1.5rem);
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid rgba(250, 204, 21, 0.45);
		background: rgba(250, 204, 21, 0.08);
		color: #fef3c7;
		line-height: 1.5;
		overflow-wrap: break-word;
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
		overflow-wrap: break-word;
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
	/* `.card p` sets colour and margins of every paragraph in a card. */
	.card .ask-together {
		margin: 1rem 0 0;
	}
	.ask-together a {
		color: #2dd4bf;
		font-weight: 700;
	}

	fieldset {
		border: none;
		margin: 0 0 1.25rem;
		padding: 0;
		min-width: 0;
	}
	/* A refused group of checkboxes: the state ring sits just outside it, so
	   marking the group never moves the layout. */
	.field-box.state-ring::after {
		inset: -0.4rem -0.6rem;
		border-radius: 12px;
	}
	legend,
	.field label {
		display: block;
		font-weight: 800;
		margin-bottom: 0.5rem;
		color: #fff;
	}
	.needs-hint {
		margin: -0.25rem 0 0.25rem;
	}
	/* The parts of the list: something I need, a project. */
	.card .need-head {
		margin: 0.75rem 0 0;
		color: #a3a3a3;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		line-height: 1.4;
		overflow-wrap: break-word;
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
	.check span {
		min-width: 0;
		overflow-wrap: break-word;
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
	/* The name or code of a group, under its choice. */
	.choice-detail {
		margin: 0 0 0.5rem 1.85rem;
		min-width: 0;
	}
	.choice-detail > .hint {
		margin: 0 0 0.75rem;
	}
	.choice-detail .field {
		margin-bottom: 0.75rem;
	}
	.card .group-note {
		margin: 0.5rem 0 0;
	}
	.card .in-group {
		margin: 0 0 1.25rem;
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

	/* The group: who is in it, and the link to share. */
	.joined {
		font-weight: 700;
	}
	.card .member-count {
		margin-bottom: 0.4rem;
	}
	/* Bullets and a gap: long burner names wrap, and each must read as one. */
	.members {
		margin: 0 0 1rem;
		padding-left: 1.2rem;
		list-style: disc;
		color: #e5e5e5;
		line-height: 1.5;
		overflow-wrap: break-word;
	}
	.members li + li {
		margin-top: 0.35rem;
	}
	.group-card h3 {
		margin: 1.25rem 0 0.75rem;
		font-size: 1rem;
		font-weight: 900;
	}
	.link-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.link-row input {
		flex: 1 1 14rem;
		min-width: 0;
		font-size: 0.9rem;
	}
	.code {
		color: #fff;
		letter-spacing: 1px;
		overflow-wrap: anywhere;
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
