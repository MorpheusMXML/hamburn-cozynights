<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import CountdownDigits from '$lib/components/CountdownDigits.svelte';
	import { actionErrorMessage, submitAction } from '$lib/admin-actions';
	import { alertDialog, chooseWithOption, confirmDialog, toast } from '$lib/dialogs';
	import { berlinLocalToIso, isoToBerlinLocal } from '$lib/time';
	import {
		PHASE_ICONS,
		PHASE_LABELS,
		checkWindowEdit,
		effectivePhase,
		formatBerlin,
		formatDuration,
		nextTransition,
		quietReleaseByDefault,
		resyncDelay,
		saveTimesEdit,
		switchPhase,
		toMs,
		type BookingPhase,
		type BookingWindow
	} from '$lib/booking-phase';

	/**
	 * The Control Center's booking window: phase, opening and closing time, the
	 * timer switch, and the superuser's override — one panel that unfolds.
	 * The rules live in $lib/booking-phase; the server checks them again.
	 */
	export let phase: BookingPhase;
	export let bookingWindow: BookingWindow;
	export let isSuperuser = false;
	/** Booked spots right now: a superuser switching to Staging may clear them. */
	export let occupiedBeds = 0;
	/** Of those, spots the crew booked for special-needs requests: they stay. */
	export let crewBookedSpots = 0;
	/** Booked spots whose guest the crew checked in at arrival: the guests are on site. */
	export let checkedInBeds = 0;
	$: guestBooked = Math.max(0, occupiedBeds - crewBookedSpots);
	$: arrivedNote =
		checkedInBeds > 0
			? ` Careful: ${checkedInBeds} spot${checkedInBeds === 1 ? ' is' : 's are'} checked in, those guests are on site. A released booking loses its check-in.`
			: '';

	let now = Date.now();
	let ticker: ReturnType<typeof setInterval> | undefined;
	let reduceMotion = false;
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		ticker = setInterval(() => (now = Date.now()), 1000);
	});
	onDestroy(() => clearInterval(ticker));
	const motion = (duration: number) => (reduceMotion ? 0 : duration);

	/** Burner names a release could not clear — the spots are free regardless. */
	function namesNote(namesLeft: number | null | undefined): string {
		if (namesLeft === null) return ' Whether burner names were left behind is unknown.';
		if (!namesLeft || namesLeft <= 0) return '';
		return ` ${namesLeft} burner name${namesLeft === 1 ? '' : 's'} could not be cleared; those spots are free but still show a name.`;
	}

	let expanded = false;
	let editing = false;
	let overrideOpen = false;
	let busy = false;

	// --- what the window says right now -----------------------------------------

	$: opensMs = toMs(bookingWindow.opensAt);
	$: closesMs = toMs(bookingWindow.closesAt);
	$: hasTimes = opensMs !== null || closesMs !== null;
	$: timerState = !hasTimes ? 'none' : bookingWindow.paused ? 'paused' : 'armed';
	// The page's phase comes from the server at load time; the clock moves on.
	$: current = effectivePhase(bookingWindow, now);
	$: next = nextTransition(bookingWindow, now);
	$: remaining = next ? (toMs(next.at) ?? now) - now : 0;

	// When the timer switches while the page is open, fetch the new state
	// (layout lock, map, counts) from the server; again after a while if the
	// server hasn't switched yet (this clock runs ahead).
	let syncTarget = '';
	let syncAttempts = 0;
	let lastSync = 0;
	$: if (browser && current !== phase) {
		if (syncTarget !== current) {
			syncTarget = current;
			syncAttempts = 0;
			lastSync = 0;
		}
		if (now - lastSync >= resyncDelay(syncAttempts)) {
			lastSync = now;
			syncAttempts += 1;
			invalidateAll();
		}
	}

	// Position of "now" on the track: 0–1 before opening, 1–2 live, 2–3 closed.
	$: nowPosition = trackPosition(current, opensMs, closesMs, now, next?.to === 'live');
	function trackPosition(
		at: BookingPhase,
		opens: number | null,
		closes: number | null,
		time: number,
		waitingToOpen: boolean
	): number {
		if (at === 'live') {
			if (opens !== null && closes !== null && closes > opens) {
				return 1 + Math.min(1, Math.max(0, (time - opens) / (closes - opens)));
			}
			return closes === null ? 1.5 : 1.35;
		}
		if (at === 'closed' && !waitingToOpen) return 2.5;
		return waitingToOpen ? 0.8 : 0.5;
	}
	$: beforeLabel = current !== 'live' && next?.to === 'live' ? PHASE_LABELS[current] : 'Staging';
	$: closesRel =
		(closesMs !== null ? relative(closesMs, 'in', 'closed') : 'not set') +
		(opensMs !== null && closesMs !== null && closesMs > opensMs
			? ` · open ${formatDuration(closesMs - opensMs)}`
			: '');

	function relative(ms: number | null, future: string, past: string): string {
		if (ms === null) return 'not set';
		const diff = ms - now;
		return diff > 0 ? `${future} ${formatDuration(diff)}` : `${past} ${formatDuration(-diff)} ago`;
	}

	$: summary = summaryText(current, timerState, next?.to, closesMs);
	function summaryText(
		at: BookingPhase,
		timer: string,
		upcoming: string | undefined,
		closes: number | null
	): string {
		if (upcoming === 'live') return 'Opens in';
		if (upcoming === 'closed') return 'Closes in';
		if (at === 'live')
			return closes === null ? 'Open, no closing time set' : 'Open · timer not armed';
		if (at === 'closed') return 'Booking is over · bookings are frozen';
		if (timer === 'paused') return 'Timer not armed · booking stays closed';
		return 'No booking window planned yet';
	}

	// --- editing the window ------------------------------------------------------

	let opensInput = '';
	let closesInput = '';
	let serverError = '';
	let opensField: HTMLInputElement;

	async function openEditor() {
		opensInput = bookingWindow.opensAt ? isoToBerlinLocal(bookingWindow.opensAt) : '';
		closesInput = bookingWindow.closesAt ? isoToBerlinLocal(bookingWindow.closesAt) : '';
		serverError = '';
		editing = true;
		expanded = true;
		await tick();
		if (!opensLocked) opensField?.focus();
	}

	$: opensLocked = current === 'live' && !isSuperuser;
	$: draft = saveTimesEdit(
		bookingWindow,
		opensInput ? berlinLocalToIso(opensInput) : '',
		closesInput ? berlinLocalToIso(closesInput) : ''
	);
	$: incomplete = (!!opensInput && !draft.opensAt) || (!!closesInput && !draft.closesAt);
	$: check = checkWindowEdit(bookingWindow, draft, { isSuperuser, now });
	// An unarmed window can be saved as it is; tell early if it couldn't be armed.
	$: armCheck = draft.paused
		? checkWindowEdit(bookingWindow, { ...draft, paused: false }, { isSuperuser, now })
		: check;
	$: draftError = incomplete ? 'Enter a complete date and time (YYYY-MM-DD HH:MM).' : check.error;
	$: draftOpens = toMs(draft.opensAt);
	$: draftCloses = toMs(draft.closesAt);
	$: unchanged =
		toMs(bookingWindow.opensAt) === draftOpens && toMs(bookingWindow.closesAt) === draftCloses;
	$: closesHint =
		relative(draftCloses, 'in', 'passed') +
		(draftOpens !== null && draftCloses !== null && draftCloses > draftOpens
			? ` · open ${formatDuration(draftCloses - draftOpens)}`
			: '');

	async function saveWindow() {
		if (draftError || busy) return;
		if (check.phaseAfter !== check.phaseBefore) {
			const ok = await confirmDialog(
				`Saving these times switches to ${PHASE_LABELS[check.phaseAfter]} right now, not on a timer. Guests see it immediately.`,
				{
					title: `${PHASE_ICONS[check.phaseAfter]} Switch to ${PHASE_LABELS[check.phaseAfter]} now?`,
					tone: 'danger',
					confirmLabel: 'Save and switch',
					cancelLabel: 'Back to editing'
				}
			);
			if (!ok) return;
		}
		const form = new FormData();
		form.set('opensAt', opensInput);
		form.set('closesAt', closesInput);
		busy = true;
		const result = await submitAction('?/saveWindow', form);
		busy = false;
		if (result.type === 'success') {
			editing = false;
			toast(
				!draft.opensAt && !draft.closesAt
					? '🧹 Booking window cleared. Nothing is planned.'
					: draft.paused
						? '💾 Booking window saved. Arm the timer to let it run.'
						: '⏱ Booking window saved. The armed timer follows the new times.',
				'success'
			);
			await invalidateAll();
		} else {
			serverError = `${actionErrorMessage(result) || 'The server could not be reached.'}`;
		}
	}

	// --- the timer switch ----------------------------------------------------------

	async function toggleTimer() {
		if (busy || timerState === 'none') return;
		const arming = timerState === 'paused';
		if (arming) {
			const armed = checkWindowEdit(
				bookingWindow,
				{ ...bookingWindow, paused: false },
				{ isSuperuser, now }
			);
			if (armed.error) {
				await alertDialog(`${armed.error} Edit the window first.`, {
					title: 'Timer not armed',
					tone: 'warning'
				});
				return;
			}
			const parts = [];
			if (opensMs !== null && opensMs > now)
				parts.push(`opens ${formatBerlin(bookingWindow.opensAt)}`);
			if (closesMs !== null && closesMs > now)
				parts.push(`closes ${formatBerlin(bookingWindow.closesAt)}`);
			const switchesNow = armed.phaseAfter !== armed.phaseBefore;
			const ok = await confirmDialog(
				(switchesNow ? `Arming switches to ${PHASE_LABELS[armed.phaseAfter]} right now. ` : '') +
					(parts.length
						? `Booking ${parts.join(' and ')} (Berlin time), all by itself. Guests see the countdown on every page.`
						: 'The timer has nothing left to switch.'),
				{
					title: '⏱ Arm the booking timer?',
					tone: switchesNow ? 'danger' : 'info',
					confirmLabel: 'Arm timer',
					cancelLabel: 'Not yet'
				}
			);
			if (!ok) return;
		} else {
			const ok = await confirmDialog(
				current === 'live'
					? 'The timer stops, so booking will NOT close by itself: it stays open until the timer is armed again or a superuser closes it. The times stay saved.'
					: 'The timer stops, so booking will NOT open by itself. The times stay saved; arm the timer again when you are ready.',
				{
					title: '⏸ Pause the booking timer?',
					tone: 'warning',
					confirmLabel: 'Pause timer',
					cancelLabel: 'Keep it running'
				}
			);
			if (!ok) return;
		}

		busy = true;
		const result = await submitAction(arming ? '?/armTimer' : '?/pauseTimer', new FormData());
		busy = false;
		if (result.type === 'success') {
			toast(
				arming
					? '⏱ Timer armed. The countdown is running.'
					: '⏸ Timer paused. Nothing switches by itself.',
				'success'
			);
		} else {
			await alertDialog(
				`${actionErrorMessage(result) || 'The server could not be reached.'} The timer was not changed.`,
				{ title: arming ? 'Timer not armed' : 'Timer not paused', tone: 'danger' }
			);
		}
		await invalidateAll();
	}

	// --- the superuser's override ----------------------------------------------------

	const PHASE_EFFECTS: Record<BookingPhase, string> = {
		staging: 'Booking off, the layout can be edited.',
		live: 'Guests book now, the layout is locked.',
		closed: 'Bookings frozen, the layout stays locked.'
	};
	const PHASES: BookingPhase[] = ['staging', 'live', 'closed'];

	async function overridePhase(to: BookingPhase) {
		if (busy || !isSuperuser) return;
		if (to === current) {
			toast(`${PHASE_ICONS[to]} ${PHASE_LABELS[to]} is already on.`, 'info');
			return;
		}
		const after = switchPhase(bookingWindow, to, now);
		const notes: string[] = [];
		if (to === 'live') {
			notes.push('Guests can book, change and release spots right away; the camp layout locks.');
			const upcoming = nextTransition(after, now);
			notes.push(
				upcoming?.to === 'closed'
					? `Booking closes by itself ${formatBerlin(upcoming.at)}.`
					: 'No closing time is armed: booking stays open until someone closes it.'
			);
			if (bookingWindow.opensAt && !after.opensAt)
				notes.push('The planned opening time is dropped.');
		} else {
			notes.push(
				to === 'closed'
					? 'Guests can no longer book, change or release a spot. The layout stays locked.'
					: `Guests can no longer book, change or release a spot; the layout can be edited again.${guestBooked > 0 ? ` ${guestBooked} guest booking${guestBooked === 1 ? ' is' : 's are'} in the camp right now.` : ''}${arrivedNote} Choose below whether they are released (ticket codes stay valid: every guest signs in again on their device and books once booking opens — this cannot be undone) or stay as they are.${crewBookedSpots > 0 ? ` The ${crewBookedSpots} spot${crewBookedSpots === 1 ? '' : 's'} the crew booked for special-needs requests stay either way.` : ' Spots the crew booked for special-needs requests stay either way.'}`
			);
			if (to === 'closed' && bookingWindow.closesAt && !after.closesAt) {
				notes.push('The planned closing time is dropped.');
			}
			if (after.paused && !bookingWindow.paused) {
				notes.push('The timer is paused, so nothing switches by itself; its times stay saved.');
			} else if (nextTransition(after, now)?.to === 'live') {
				notes.push(`Careful: the armed timer still opens booking ${formatBerlin(after.opensAt)}.`);
			}
		}
		// Going back to Staging asks what happens to the bookings; releasing them
		// (and with them every check-in) is a superuser's call, so the server
		// only does it when this dialog says so.
		const asksAboutBookings = to === 'staging' && guestBooked > 0;
		let clearBookings = false;
		let quietRelease = false;
		if (asksAboutBookings) {
			// Ticked once booking is over: after the event, "your spot was
			// released" only confuses people. Before that they need to hear it.
			const { choice, checked } = await chooseWithOption(notes.join(' '), {
				title: `${PHASE_ICONS[to]} Switch to ${PHASE_LABELS[to]} right now?`,
				tone: 'danger',
				confirmLabel: `Switch & release ${guestBooked} booking${guestBooked === 1 ? '' : 's'}`,
				altLabel: 'Switch & keep the bookings',
				cancelLabel: 'Cancel',
				checkbox: {
					label: "Don't notify the guests",
					checked: quietReleaseByDefault(bookingWindow, now),
					hint: 'Only when releasing: nobody gets a “your spot was released” message. The crew alert goes out either way.'
				}
			});
			if (choice === 'cancel') return;
			clearBookings = choice === 'confirm';
			quietRelease = clearBookings && checked;
		} else {
			const ok = await confirmDialog(notes.join(' '), {
				title: `${PHASE_ICONS[to]} Switch to ${PHASE_LABELS[to]} right now?`,
				tone: to === 'live' ? 'warning' : 'danger',
				confirmLabel: `Switch to ${PHASE_LABELS[to]}`,
				cancelLabel: 'Cancel'
			});
			if (!ok) return;
		}

		const form = new FormData();
		form.set('phase', to);
		if (clearBookings) form.set('clearBookings', '1');
		if (quietRelease) form.set('quietRelease', '1');
		busy = true;
		const result = await submitAction('?/setPhase', form);
		busy = false;
		if (result.type === 'success') {
			const data = result.data as
				| {
						phaseBefore?: BookingPhase;
						released?: number;
						kept?: number;
						namesLeft?: number | null;
				  }
				| undefined;
			const releasedNote =
				to !== 'staging'
					? ''
					: clearBookings
						? ` ${data?.released ?? 0} booking${data?.released === 1 ? '' : 's'} released${data?.kept ? `, ${data.kept} special-needs spot${data.kept === 1 ? '' : 's'} kept` : ''}${quietRelease ? ', guests not notified' : ''}.${namesNote(data?.namesLeft)}`
						: guestBooked > 0
							? ` The ${guestBooked} guest booking${guestBooked === 1 ? '' : 's'} stay${guestBooked === 1 ? 's' : ''}: clear them with 🧨 Clear all bookings when the camp should be empty.`
							: '';
			if (data?.phaseBefore && data.phaseBefore !== current) {
				await alertDialog(
					`The phase had already changed to ${PHASE_LABELS[data.phaseBefore]} before your click (the timer, or another superuser). It is ${PHASE_LABELS[to]} now.${releasedNote}`,
					{ title: 'Check the booking phase', tone: 'warning' }
				);
			} else {
				toast(
					`${PHASE_ICONS[to]} ${PHASE_LABELS[to]} is on. ${PHASE_EFFECTS[to]}${releasedNote}`,
					'success'
				);
			}
		} else {
			await alertDialog(
				`${actionErrorMessage(result) || 'The server could not be reached.'} Reload the page and check the phase and the bookings.`,
				{ title: 'Check the booking phase', tone: 'danger' }
			);
		}
		await invalidateAll();
	}

	/** Superusers, Staging Mode only: releases what going back to Staging left (crew-booked spots stay). */
	async function clearAllBookings() {
		if (busy || !isSuperuser || current !== 'staging') return;
		const ok = await confirmDialog(
			`${guestBooked} booked spot${guestBooked === 1 ? '' : 's'} become${guestBooked === 1 ? 's' : ''} free and lose${guestBooked === 1 ? 's' : ''} the burner name.${arrivedNote}${crewBookedSpots > 0 ? ` The ${crewBookedSpots} spot${crewBookedSpots === 1 ? '' : 's'} the crew booked for special-needs requests stay as long as those requests exist.` : ''} Ticket codes keep working: every guest signs in again on their device. This cannot be undone.`,
			{
				title: '🧨 Clear all bookings?',
				tone: 'danger',
				confirmLabel: 'Clear all bookings',
				cancelLabel: 'Cancel'
			}
		);
		if (!ok) return;
		busy = true;
		const result = await submitAction('?/clearAllBookings', new FormData());
		busy = false;
		if (result.type === 'success') {
			const data = result.data as
				{ released?: number; kept?: number; namesLeft?: number | null } | undefined;
			const left = namesNote(data?.namesLeft);
			toast(
				`✨ ${data?.released ?? 0} booking${data?.released === 1 ? '' : 's'} released${data?.kept ? `, ${data.kept} special-needs spot${data.kept === 1 ? '' : 's'} kept` : ''}.${left}`,
				left ? 'warning' : 'success'
			);
		} else {
			await alertDialog(
				`${actionErrorMessage(result) || 'The server could not be reached.'} Check the spots before you try again.`,
				{ title: 'Bookings were not cleared', tone: 'danger' }
			);
		}
		await invalidateAll();
	}
</script>

<section class="booking-panel phase-{current}" class:expanded aria-labelledby="booking-panel-title">
	<button
		type="button"
		class="summary"
		aria-expanded={expanded}
		aria-controls="booking-panel-body"
		aria-label="Booking window: {PHASE_LABELS[current]}. {next
			? `${next.to === 'live' ? 'Opens' : 'Closes'} ${formatBerlin(next.at)}.`
			: summary}"
		on:click={() => (expanded = !expanded)}
	>
		<span class="summary-title" id="booking-panel-title">
			<span class="ticket" aria-hidden="true">🎟</span>
			BOOKING WINDOW
		</span>

		{#key current}
			<span class="phase-chip {current}" in:fly={{ y: 6, duration: motion(300) }}>
				<span class="chip-dot" aria-hidden="true"></span>
				{PHASE_ICONS[current]}
				{PHASE_LABELS[current].toUpperCase()}
			</span>
		{/key}

		<span class="summary-status">
			<span class="status-text">{summary}</span>
			{#if next}
				<span class="status-time {next.to}"><CountdownDigits ms={remaining} /></span>
				<span class="status-at">{formatBerlin(next.at, { year: false })}</span>
			{/if}
		</span>

		<span class="timer-chip {timerState}">
			{timerState === 'armed' ? '⏱ ARMED' : timerState === 'paused' ? '⏸ NOT ARMED' : 'NO TIMER'}
		</span>

		<span class="chevron" class:open={expanded} aria-hidden="true">
			<svg viewBox="0 0 12 12" width="12" height="12"
				><path
					d="M2.5 4.5 6 8l3.5-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			>
		</span>
	</button>

	{#if expanded}
		<div
			class="body"
			id="booking-panel-body"
			transition:slide={{ duration: motion(380), easing: cubicOut }}
		>
			<!-- the timeline: before opening → live → closed -->
			<div class="timeline" in:fade={{ duration: motion(400), delay: motion(120) }}>
				<div class="track" style="--now: {nowPosition / 3}">
					<span class="segment before" class:current={nowPosition < 1}></span>
					<span class="segment live" class:current={nowPosition >= 1 && nowPosition < 2}>
						<span
							class="live-fill"
							style="transform: scaleX({Math.min(1, Math.max(0, nowPosition - 1))})"
						></span>
					</span>
					<span class="segment after" class:current={nowPosition >= 2}></span>
					<span class="marker opens" class:done={opensMs !== null && opensMs <= now}></span>
					<span class="marker closes" class:done={closesMs !== null && closesMs <= now}></span>
					<span class="now-dot" title="Now"></span>
				</div>
				<div class="stops">
					<div class="stop">
						<span class="stop-label">{beforeLabel}</span>
					</div>
					<div class="stop milestone">
						<span class="stop-label">Opens</span>
						<span class="stop-time"
							>{opensMs !== null ? formatBerlin(bookingWindow.opensAt, { year: false }) : '—'}</span
						>
						<span class="stop-rel"
							>{opensMs !== null
								? relative(opensMs, 'in', 'opened')
								: current === 'live'
									? 'opened by hand'
									: 'not set'}</span
						>
					</div>
					<div class="stop milestone">
						<span class="stop-label">Closes</span>
						<span class="stop-time"
							>{closesMs !== null
								? formatBerlin(bookingWindow.closesAt, { year: false })
								: '—'}</span
						>
						<span class="stop-rel">{closesRel}</span>
					</div>
					<div class="stop end">
						<span class="stop-label">Closed</span>
					</div>
				</div>
			</div>

			<!-- the timer: armed or paused, and the editor -->
			<div class="timer-row">
				<button
					type="button"
					class="switch"
					class:on={timerState === 'armed'}
					role="switch"
					aria-checked={timerState === 'armed'}
					aria-label="Booking timer"
					disabled={busy || timerState === 'none'}
					on:click={toggleTimer}
				>
					<span class="switch-track"><span class="switch-knob"></span></span>
					<span class="switch-label">
						{#if timerState === 'armed'}
							<strong>Timer armed</strong>
							<small>Booking opens and closes by itself.</small>
						{:else if timerState === 'paused'}
							<strong>Timer not armed</strong>
							<small>The times are saved; nothing switches until you arm it.</small>
						{:else}
							<strong>No timer</strong>
							<small>Plan the booking window first.</small>
						{/if}
					</span>
				</button>

				<button
					type="button"
					class="btn-edit"
					class:active={editing}
					aria-expanded={editing}
					aria-controls="booking-window-editor"
					on:click={() => (editing ? (editing = false) : openEditor())}
				>
					{editing ? 'Close editor' : hasTimes ? '✎ Edit window' : '＋ Plan window'}
				</button>
			</div>

			{#if editing}
				<form
					class="editor"
					id="booking-window-editor"
					novalidate
					on:submit|preventDefault={saveWindow}
					transition:slide={{ duration: motion(320), easing: cubicOut }}
				>
					<div class="fields">
						<label class="field" class:locked={opensLocked}>
							<span class="field-label">🎪 Booking opens</span>
							<input
								type="datetime-local"
								name="opensAt"
								bind:this={opensField}
								bind:value={opensInput}
								disabled={opensLocked || busy}
								on:input={() => (serverError = '')}
							/>
							{#if opensLocked}
								<small class="field-hint">Booking is already open.</small>
							{:else if draftOpens !== null}
								<!-- The field shows the browser's own date format (dd.mm.yyyy, am/pm…):
								     repeat the parsed time in English so nobody has to guess. -->
								<small class="field-hint"
									>{formatBerlin(draft.opensAt)} Berlin time · {relative(
										draftOpens,
										'in',
										'passed'
									)}</small
								>
							{/if}
						</label>

						<span class="field-arrow" aria-hidden="true">→</span>

						<label class="field">
							<span class="field-label">🔒 Booking closes</span>
							<input
								type="datetime-local"
								name="closesAt"
								bind:value={closesInput}
								disabled={busy}
								on:input={() => (serverError = '')}
							/>
							{#if draftCloses !== null}
								<small class="field-hint"
									>{formatBerlin(draft.closesAt)} Berlin time · {closesHint}</small
								>
							{/if}
						</label>
					</div>

					<p class="rules">
						Times are Berlin time (CET/CEST), 24-hour clock; the line under a field repeats what you
						typed.
						{#if isSuperuser}
							⚡ As a superuser you have no minimum times; a save that switches the phase right now
							asks first.
						{:else}
							Admins open booking at least <strong>one day ahead</strong> and keep it open for at
							least
							<strong>one day</strong>. Anything sooner is a superuser's call.
						{/if}
					</p>

					{#if draftError || serverError}
						<p class="editor-error form-error" role="alert">
							{serverError || draftError}
						</p>
					{:else if draft.paused && armCheck.error}
						<p class="editor-note" transition:slide={{ duration: motion(200) }}>
							You can save this, but the timer can't be armed with it yet: {armCheck.error}
						</p>
					{/if}

					<div class="editor-actions">
						<button
							type="button"
							class="btn-ghost"
							disabled={busy || (!opensInput && !closesInput) || opensLocked}
							on:click={() => {
								opensInput = '';
								closesInput = '';
							}}>Clear times</button
						>
						<span class="spacer"></span>
						<button type="button" class="btn-ghost" on:click={() => (editing = false)}
							>Cancel</button
						>
						<button type="submit" class="btn-save" disabled={busy || !!draftError || unchanged}>
							{busy ? 'Saving…' : 'Save window ✨'}
						</button>
					</div>
				</form>
			{/if}

			<!-- the override: switch right now -->
			{#if isSuperuser}
				<div class="override" class:open={overrideOpen}>
					<button
						type="button"
						class="override-toggle"
						aria-expanded={overrideOpen}
						aria-controls="booking-override"
						on:click={() => (overrideOpen = !overrideOpen)}
					>
						<span class="override-title">⚡ Switch right now</span>
						<span class="override-sub">Superuser override · skips the timer</span>
						<span class="chevron small" class:open={overrideOpen} aria-hidden="true">
							<svg viewBox="0 0 12 12" width="10" height="10"
								><path
									d="M2.5 4.5 6 8l3.5-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</span>
					</button>
					{#if overrideOpen}
						<div
							class="override-body"
							id="booking-override"
							transition:slide={{ duration: motion(300), easing: cubicOut }}
						>
							<div
								class="segmented"
								role="radiogroup"
								aria-label="Booking phase"
								style="--index: {PHASES.indexOf(current)}"
							>
								<span class="segmented-glider {current}" aria-hidden="true"></span>
								{#each PHASES as option}
									<button
										type="button"
										role="radio"
										aria-checked={current === option}
										class="segment-option {option}"
										class:active={current === option}
										disabled={busy}
										on:click={() => overridePhase(option)}
									>
										<span class="option-name">{PHASE_ICONS[option]} {PHASE_LABELS[option]}</span>
										<small>{PHASE_EFFECTS[option]}</small>
									</button>
								{/each}
							</div>
							{#if current === 'staging'}
								<div class="purge">
									<span class="purge-text">
										{occupiedBeds > 0
											? `${occupiedBeds} spot${occupiedBeds === 1 ? ' is' : 's are'} still booked${crewBookedSpots > 0 ? `, ${crewBookedSpots} of them crew-booked for special-needs requests (those stay)` : ' (marked as taken, or booked in Staging)'}.`
											: 'No spot is booked. Staging Mode starts without guest bookings.'}
									</span>
									<button
										type="button"
										class="btn-purge"
										disabled={busy || guestBooked === 0}
										on:click={clearAllBookings}
									>
										🧨 Clear all bookings
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<p class="override-locked">
					🔒 Switching the phase <em>right now</em> is up to superusers. Plan it with the window and arm
					the timer instead.
				</p>
			{/if}
		</div>
	{/if}
</section>

<style>
	.booking-panel {
		--accent: #2dd4bf;
		--accent-rgb: 45, 212, 191;
		position: relative;
		border-radius: 16px;
		border: 1px solid rgba(var(--accent-rgb), 0.22);
		background:
			radial-gradient(120% 140% at 0% 0%, rgba(var(--accent-rgb), 0.08), transparent 55%),
			rgba(10, 10, 10, 0.92);
		box-shadow:
			0 18px 40px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
		transition:
			border-color 0.5s,
			box-shadow 0.5s;
		overflow: hidden;
	}
	.booking-panel.phase-live {
		--accent: #f472b6;
		--accent-rgb: 244, 114, 182;
	}
	.booking-panel.phase-closed {
		--accent: #e5e5e5;
		--accent-rgb: 229, 229, 229;
	}
	.booking-panel.expanded {
		border-color: rgba(var(--accent-rgb), 0.38);
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.55),
			0 0 40px -18px rgba(var(--accent-rgb), 0.6);
	}

	/* --- summary row ------------------------------------------------------------ */

	.summary {
		width: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.9rem 1.25rem;
		min-height: 56px;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -4px;
		border-radius: 16px;
	}
	.summary-title {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 2.5px;
		color: #8a8a8a;
		white-space: nowrap;
	}
	.ticket {
		font-size: 1rem;
		letter-spacing: 0;
	}

	.phase-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		font-size: 0.66rem;
		font-weight: 900;
		letter-spacing: 1.2px;
		white-space: nowrap;
		color: var(--accent);
		background: rgba(var(--accent-rgb), 0.1);
		border: 1px solid rgba(var(--accent-rgb), 0.35);
	}
	.chip-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 10px currentColor;
	}
	.phase-chip.live .chip-dot {
		animation: pulse 1.8s ease-in-out infinite;
	}

	.summary-status {
		flex: 1 1 16rem;
		min-width: 0;
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: #9a9a9a;
	}
	.status-time {
		font-size: 1rem;
		font-weight: 900;
		color: #fb923c;
		text-shadow: 0 0 14px rgba(251, 146, 60, 0.45);
	}
	.status-time.closed {
		color: #f472b6;
		text-shadow: 0 0 14px rgba(244, 114, 182, 0.45);
	}
	.status-at {
		font-size: 0.72rem;
		color: #666;
		white-space: nowrap;
	}

	.timer-chip {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.2px;
		padding: 0.25rem 0.55rem;
		border-radius: 6px;
		border: 1px solid #2a2a2a;
		color: #666;
		white-space: nowrap;
	}
	.timer-chip.armed {
		color: #fb923c;
		border-color: rgba(251, 146, 60, 0.4);
		background: rgba(251, 146, 60, 0.08);
	}
	.timer-chip.paused {
		color: #a3a3a3;
		border-style: dashed;
	}

	.chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid #262626;
		color: #8a8a8a;
		transition:
			transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
			color 0.2s,
			border-color 0.2s;
	}
	.chevron.small {
		width: 22px;
		height: 22px;
	}
	.chevron.open {
		transform: rotate(180deg);
		color: var(--accent);
		border-color: rgba(var(--accent-rgb), 0.4);
	}
	.summary:hover .chevron {
		color: #fff;
	}

	/* --- body ---------------------------------------------------------------- */

	.body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 0.25rem 1.25rem 1.25rem;
		border-top: 1px solid #1a1a1a;
	}

	/* timeline */
	.timeline {
		padding-top: 1.1rem;
	}
	.track {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 4px;
		height: 8px;
		margin: 0 4px;
	}
	.segment {
		position: relative;
		border-radius: 999px;
		background: #1c1c1c;
		overflow: hidden;
		transition:
			background 0.4s,
			box-shadow 0.4s;
	}
	.segment.before.current {
		background: rgba(45, 212, 191, 0.35);
		box-shadow: 0 0 14px rgba(45, 212, 191, 0.35);
	}
	.phase-closed .segment.before.current {
		background: rgba(229, 229, 229, 0.25);
		box-shadow: none;
	}
	.segment.live {
		background: rgba(244, 114, 182, 0.14);
	}
	.live-fill {
		position: absolute;
		inset: 0;
		transform-origin: left center;
		background: linear-gradient(90deg, #f472b6, #fb923c);
		transition: transform 1s linear;
	}
	.segment.live.current {
		box-shadow: 0 0 16px rgba(244, 114, 182, 0.4);
	}
	.segment.after.current {
		background: rgba(229, 229, 229, 0.3);
	}
	.marker {
		position: absolute;
		top: 50%;
		width: 14px;
		height: 14px;
		margin: -7px 0 0 -7px;
		border-radius: 50%;
		background: #0a0a0a;
		border: 2px solid #3a3a3a;
		transition:
			border-color 0.4s,
			background 0.4s;
	}
	.marker.opens {
		left: calc(100% / 3);
	}
	.marker.closes {
		left: calc(200% / 3);
	}
	.marker.done {
		background: #3a3a3a;
	}
	.marker.opens:not(.done) {
		border-color: #fb923c;
	}
	.marker.closes:not(.done) {
		border-color: #f472b6;
	}
	.now-dot {
		position: absolute;
		top: 50%;
		left: calc(var(--now) * 100%);
		width: 10px;
		height: 10px;
		margin: -5px 0 0 -5px;
		border-radius: 50%;
		background: #fff;
		box-shadow:
			0 0 0 3px rgba(var(--accent-rgb), 0.35),
			0 0 16px rgba(var(--accent-rgb), 0.9);
		transition: left 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
		animation: glow 2.4s ease-in-out infinite;
	}

	.stops {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr 1fr;
		margin-top: 0.9rem;
	}
	.stop {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.stop:first-child {
		grid-column: 1;
	}
	.stop.milestone {
		align-items: center;
		text-align: center;
	}
	.stop.milestone:nth-child(2) {
		grid-column: 2;
		transform: translateX(-16.66%);
	}
	.stop.milestone:nth-child(3) {
		grid-column: 3;
		transform: translateX(16.66%);
	}
	.stop.end {
		align-items: flex-end;
	}
	.stop-label {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #6b6b6b;
	}
	.stop-time {
		font-size: 0.8rem;
		font-weight: 800;
		color: #e5e5e5;
		white-space: nowrap;
	}
	.stop-rel {
		font-size: 0.7rem;
		color: #777;
	}

	/* timer row */
	.timer-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		padding: 0.85rem 1rem;
		border-radius: 12px;
		background: #0d0d0d;
		border: 1px solid #1c1c1c;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.85rem;
		min-height: 44px;
		padding: 0;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.switch:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.switch:focus-visible .switch-track {
		outline: 2px solid #fb923c;
		outline-offset: 3px;
	}
	.switch-track {
		position: relative;
		flex-shrink: 0;
		width: 52px;
		height: 30px;
		border-radius: 999px;
		background: #1f1f1f;
		border: 1px solid #333;
		transition:
			background 0.35s,
			border-color 0.35s,
			box-shadow 0.35s;
	}
	.switch-knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #777;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
		transition:
			transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1),
			background 0.35s;
	}
	.switch.on .switch-track {
		background: rgba(251, 146, 60, 0.25);
		border-color: #fb923c;
		box-shadow: 0 0 18px rgba(251, 146, 60, 0.35);
	}
	.switch.on .switch-knob {
		transform: translateX(22px);
		background: #fb923c;
	}
	.switch-label {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.switch-label strong {
		font-size: 0.85rem;
		font-weight: 900;
		color: #fff;
	}
	.switch-label small {
		font-size: 0.72rem;
		color: #8a8a8a;
	}

	.btn-edit {
		min-height: 44px;
		padding: 0.5rem 1.1rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #141414;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-edit:hover,
	.btn-edit.active {
		border-color: #fb923c;
		color: #fb923c;
		background: rgba(251, 146, 60, 0.08);
	}

	/* editor */
	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.1rem 1rem 1rem;
		border-radius: 12px;
		border: 1px solid rgba(251, 146, 60, 0.25);
		background: linear-gradient(180deg, rgba(251, 146, 60, 0.06), transparent 60%), #0b0b0b;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: start;
		gap: 0.75rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	.field-label {
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #9a9a9a;
	}
	.field input {
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		border: 1px solid #333;
		background: #050505;
		color: #fff;
		color-scheme: dark;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		font-family: inherit;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.field input:focus {
		outline: none;
		border-color: #fb923c;
		box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.2);
	}
	.field.locked input {
		opacity: 0.45;
	}
	.field-hint {
		font-size: 0.72rem;
		color: #777;
	}
	.field-arrow {
		align-self: center;
		margin-top: 1.1rem;
		color: #555;
		font-size: 1.1rem;
	}
	.rules {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: #8a8a8a;
	}
	.rules strong {
		color: #d4d4d4;
	}
	.editor-error,
	.editor-note {
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.editor-error {
		color: #fca5a5;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}
	.editor-note {
		color: #fcd34d;
		background: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.25);
	}
	.editor-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.spacer {
		flex: 1;
	}
	.btn-ghost,
	.btn-save {
		min-height: 44px;
		padding: 0.5rem 1.1rem;
		border-radius: 10px;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid #333;
		color: #9a9a9a;
	}
	.btn-ghost:hover:not(:disabled) {
		color: #fff;
		border-color: #555;
	}
	.btn-save {
		background: #fb923c;
		border: 1px solid #fb923c;
		color: #000;
	}
	.btn-save:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 8px 24px rgba(251, 146, 60, 0.35);
	}
	.btn-ghost:disabled,
	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* override */
	.override {
		border-radius: 12px;
		border: 1px solid #1f1f1f;
		background: #0b0b0b;
		transition: border-color 0.3s;
	}
	.override.open {
		border-color: rgba(250, 204, 21, 0.3);
	}
	.override-toggle {
		width: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.8rem;
		min-height: 48px;
		padding: 0.6rem 1rem;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.override-title {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		color: #facc15;
	}
	.override-sub {
		flex: 1;
		font-size: 0.72rem;
		color: #6b6b6b;
	}
	.override-body {
		padding: 0 1rem 1rem;
	}
	.segmented {
		--index: 0;
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 4px;
		border-radius: 12px;
		background: #050505;
		border: 1px solid #222;
	}
	.segmented-glider {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc((100% - 8px) / 3);
		border-radius: 9px;
		transform: translateX(calc(var(--index) * 100%));
		transition:
			transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
			background 0.4s,
			box-shadow 0.4s;
		background: rgba(45, 212, 191, 0.14);
		box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.5);
	}
	.segmented-glider.live {
		background: rgba(244, 114, 182, 0.14);
		box-shadow: inset 0 0 0 1px rgba(244, 114, 182, 0.55);
	}
	.segmented-glider.closed {
		background: rgba(229, 229, 229, 0.08);
		box-shadow: inset 0 0 0 1px rgba(229, 229, 229, 0.4);
	}
	.segment-option {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		min-height: 56px;
		padding: 0.55rem 0.4rem;
		border: none;
		border-radius: 9px;
		background: none;
		color: #8a8a8a;
		font: inherit;
		text-align: center;
		cursor: pointer;
		transition: color 0.25s;
	}
	.segment-option:hover:not(:disabled) {
		color: #fff;
	}
	.segment-option:focus-visible {
		outline: 2px solid #facc15;
		outline-offset: -2px;
	}
	.segment-option:disabled {
		cursor: progress;
	}
	.option-name {
		font-size: 0.78rem;
		font-weight: 900;
		letter-spacing: 0.5px;
	}
	.segment-option small {
		font-size: 0.66rem;
		line-height: 1.3;
		color: #666;
	}
	.segment-option.active.staging {
		color: #2dd4bf;
	}
	.segment-option.active.live {
		color: #f472b6;
	}
	.segment-option.active.closed {
		color: #f5f5f5;
	}
	.purge {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.6rem 1rem;
		margin-top: 0.9rem;
		padding-top: 0.9rem;
		border-top: 1px dashed rgba(255, 255, 255, 0.12);
		font-size: 0.78rem;
		color: #9a9a9a;
	}
	.purge-text {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.btn-purge {
		min-height: 44px;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid #ef4444;
		background: transparent;
		color: #f87171;
		font-weight: 900;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-purge:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.12);
	}
	.btn-purge:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.override-locked {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: #777;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@keyframes glow {
		0%,
		100% {
			box-shadow:
				0 0 0 3px rgba(var(--accent-rgb), 0.35),
				0 0 16px rgba(var(--accent-rgb), 0.9);
		}
		50% {
			box-shadow:
				0 0 0 5px rgba(var(--accent-rgb), 0.15),
				0 0 24px rgba(var(--accent-rgb), 0.6);
		}
	}

	@media (max-width: 640px) {
		.summary {
			padding: 0.85rem 1rem;
		}
		.summary-status {
			order: 5;
			flex-basis: 100%;
		}
		.body {
			padding: 0.25rem 1rem 1rem;
		}
		.fields {
			grid-template-columns: 1fr;
		}
		.field-arrow {
			display: none;
		}
		.stops {
			grid-template-columns: 1fr 1fr;
			row-gap: 0.75rem;
		}
		.stop:first-child,
		.stop.end {
			display: none;
		}
		.stop.milestone:nth-child(2),
		.stop.milestone:nth-child(3) {
			grid-column: auto;
			transform: none;
		}
		.stop-time {
			white-space: normal;
		}
		.override-sub {
			flex-basis: 100%;
			order: 3;
		}
		.segmented {
			grid-template-columns: 1fr;
		}
		.segmented-glider {
			width: auto;
			right: 4px;
			height: calc((100% - 8px) / 3);
			bottom: auto;
			transform: translateY(calc(var(--index) * 100%));
		}
		.editor-actions .spacer {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.booking-panel,
		.chevron,
		.switch-track,
		.switch-knob,
		.segmented-glider,
		.now-dot,
		.live-fill,
		.segment {
			transition: none;
		}
		.now-dot,
		.phase-chip.live .chip-dot {
			animation: none;
		}
	}
</style>
