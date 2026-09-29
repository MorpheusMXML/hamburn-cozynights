<!--
@component
The admin status line: what the top bar (AdminNav) holds at every width.
Left, the booking phase pill and the countdown ("opens in 1d 23:59:57",
"closes in …"), one button that opens the exact Berlin time. Right, the
version badge, the quick access (🎟 scan a pass, 💬 messages, ♿ requests
with the count the sidebar shows) and the account with its Eject.

Renders with `display: contents`, so the two halves are flex children of
the bar itself and wrap under the ☰ on a phone: pill + countdown on one row,
the icons on the next, never a third.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CountdownDigits from '../CountdownDigits.svelte';
	import VersionBadge from '../VersionBadge.svelte';
	import { badgeFor, isActive, type NavCounts } from '$lib/admin-nav';
	import {
		countdownKind,
		formatBerlin,
		formatDuration,
		PHASE_ICONS,
		PHASE_LABELS,
		resyncDelay,
		toMs,
		type BookingPhase,
		type PhaseTransition
	} from '$lib/booking-phase';

	let {
		email,
		isSuperuser = false,
		counts,
		phase = 'staging',
		next = null
	}: {
		email: string;
		isSuperuser?: boolean;
		counts: NavCounts;
		phase?: BookingPhase;
		next?: PhaseTransition | null;
	} = $props();

	/** The pages a hand reaches for between two others. */
	const QUICK = [
		{ href: '/admin/check', icon: '🎟', label: 'Scan a booking pass', badge: undefined },
		{ href: '/admin/messages', icon: '💬', label: 'Message texts', badge: undefined },
		{ href: '/admin/requests', icon: '♿', label: 'Special-needs requests', badge: 'requests' }
	] as const;

	const URGENT_MS = 60 * 60 * 1000;

	let now = $state(Date.now());
	let ticker: ReturnType<typeof setInterval> | undefined;
	let reduceMotion = $state(false);
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		ticker = setInterval(() => (now = Date.now()), 1000);
	});
	onDestroy(() => clearInterval(ticker));

	let kind = $derived(countdownKind(phase, next));
	let target = $derived(toMs(next?.at));
	let remaining = $derived(target === null ? 0 : target - now);
	let urgent = $derived(kind === 'closes' && remaining < URGENT_MS);
	let phaseName = $derived(PHASE_LABELS[phase].replace('Live Booking', 'Live').toUpperCase());
	let countdownLabel = $derived(
		remaining <= 0
			? kind === 'closes'
				? 'closing…'
				: 'opening…'
			: kind === 'closes'
				? 'closes in'
				: 'opens in'
	);
	let spoken = $derived(
		`Booking phase: ${PHASE_LABELS[phase]}.` +
			(kind && next
				? ` Booking ${countdownLabel}${remaining > 0 ? ` ${formatDuration(remaining)}` : ''}`
				: ' No timer armed.')
	);

	// Once the time has come, ask the server for the phase it has switched to
	// (the pages then lock or open by themselves). This clock may run ahead of
	// the server's: while the phase hasn't changed yet, ask again, more slowly.
	let waitingFor = '';
	let attempts = 0;
	let lastReload = 0;
	$effect(() => {
		if (!browser || !kind || !next || remaining > 0) return;
		if (waitingFor !== next.at) {
			waitingFor = next.at;
			attempts = 0;
			lastReload = 0;
		}
		if (now - lastReload >= resyncDelay(attempts)) {
			lastReload = now;
			attempts += 1;
			invalidateAll();
		}
	});

	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	function closeOnOutside(event: MouseEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}

	let pathname = $derived(page.url.pathname);
	// The shortened account: the part before the @ always, the domain when there is room.
	let at = $derived(email.indexOf('@'));
	let accountLocal = $derived(at > 0 ? email.slice(0, at) : email);
	let accountDomain = $derived(at > 0 ? email.slice(at) : '');
</script>

<svelte:window onclick={closeOnOutside} onkeydown={closeOnEscape} />

<div class="admin-status">
	<div class="status-phase" bind:this={root}>
		{#if kind && next}
			<button
				type="button"
				class="phase-btn"
				aria-expanded={open}
				aria-controls="admin-phase-details"
				aria-label={spoken}
				title="Tap for the exact time"
				onclick={() => (open = !open)}
			>
				<span class="phase-pill state-chip" data-state={phase}>
					<span class="state-dot" aria-hidden="true"></span>
					<span class="phase-icon" aria-hidden="true">{PHASE_ICONS[phase]}</span>
					<span class="phase-name">{phaseName}</span>
				</span>
				<span class="countdown {kind}" class:urgent>
					<span class="countdown-label">{countdownLabel}</span>
					{#if remaining > 0}
						<span class="countdown-time"><CountdownDigits ms={remaining} /></span>
					{/if}
				</span>
				<span class="chevron" class:open aria-hidden="true">
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
		{:else}
			<!-- No timer armed: the pill alone, a way to the booking window. -->
			<a
				href="/admin"
				class="phase-pill state-chip phase-link"
				data-state={phase}
				aria-label="{spoken} Booking window in the Control Center."
				title="No timer armed — the booking window is in the Control Center"
			>
				<span class="state-dot" aria-hidden="true"></span>
				<span class="phase-icon" aria-hidden="true">{PHASE_ICONS[phase]}</span>
				<span class="phase-name">{phaseName}</span>
			</a>
		{/if}

		{#if open && kind && next}
			<div
				id="admin-phase-details"
				class="details {kind}"
				role="status"
				transition:fly={{ y: -8, duration: reduceMotion ? 0 : 220, easing: cubicOut }}
			>
				{#if kind === 'closes'}
					<strong>Live Booking ends {formatBerlin(next.at)}</strong>
					<span
						>Berlin time. Guests can book, change or release until then; after that, the bookings
						are final and the arrival list counts.</span
					>
				{:else}
					<strong>Booking opens {formatBerlin(next.at)}</strong>
					<span>Berlin time. The map unlocks by itself; the camp layout locks then.</span>
				{/if}
			</div>
		{/if}
	</div>

	<div class="status-quick">
		<VersionBadge size="nav" />
		{#each QUICK as link (link.href)}
			{@const active = isActive(link, pathname)}
			{@const badge = badgeFor(link.badge, counts, phase)}
			<a
				href={link.href}
				class="quick-link"
				class:active
				aria-current={active ? 'page' : undefined}
				aria-label={badge ? `${link.label} (${badge.value})` : link.label}
				title={badge ? `${link.label} — ${badge.title}` : link.label}
			>
				<span aria-hidden="true">{link.icon}</span>
				{#if badge}
					<span class="quick-badge" aria-hidden="true">{badge.value}</span>
				{/if}
			</a>
		{/each}
		<span class="account" title={isSuperuser ? `${email} — superuser` : email}>
			{#if isSuperuser}<span class="role-dot" aria-hidden="true">⚡️</span>{/if}
			<span class="account-local">{accountLocal}</span><span class="account-domain"
				>{accountDomain}</span
			>
		</span>
		<form action="/admin/logout" method="POST" class="logout-form">
			<button type="submit" class="logout-btn" title="Sign out {email}">
				<span class="logout-text">Eject</span><span aria-hidden="true">🚀</span>
			</button>
		</form>
	</div>
</div>

<style>
	/* The bar (AdminNav) lays the halves out; see the component note. */
	.admin-status {
		display: contents;
	}

	/* ---- phase and countdown ---------------------------------------------- */
	.status-phase {
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 0 1 auto;
	}
	.phase-btn {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.55rem;
		max-width: 100%;
		min-height: 40px;
		padding: 0.2rem 0.55rem 0.2rem 0.25rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: #d4d4d4;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.25s;
	}
	.phase-btn:hover,
	.phase-btn:focus-visible {
		border-color: #333;
	}
	.phase-btn:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
	}
	.phase-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 28px;
		padding: 0 0.6rem;
		border-radius: 999px;
		font-size: 0.66rem;
		letter-spacing: 1.2px;
		box-sizing: border-box;
	}
	.phase-link {
		text-decoration: none;
		min-height: 40px;
		padding: 0 0.7rem;
	}
	.phase-link:focus-visible {
		outline: 2px solid var(--state, #2dd4bf);
		outline-offset: 2px;
	}
	.phase-pill .state-dot {
		width: 7px;
		height: 7px;
	}
	.phase-icon {
		font-size: 0.85rem;
	}

	.countdown {
		--accent: var(--state-filling);
		--accent-soft: var(--state-filling-soft);
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
		white-space: nowrap;
	}
	.countdown.closes {
		--accent: var(--state-live);
		--accent-soft: var(--state-live-soft);
	}
	.countdown.urgent {
		--accent: var(--state-full);
		--accent-soft: var(--state-full-soft);
	}
	.countdown-label {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 1.2px;
		text-transform: uppercase;
		color: #9a9a9a;
	}
	.countdown-time {
		font-size: 0.86rem;
		font-weight: 800;
		color: var(--accent);
		text-shadow: 0 0 12px var(--accent-soft);
	}
	.chevron {
		display: inline-flex;
		color: #777;
		transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.chevron.open {
		transform: rotate(180deg);
	}

	/* Anchored to the sticky bar (AdminNav), so it never runs past the screen edge. */
	.details {
		--accent: var(--state-filling);
		position: absolute;
		top: calc(100% - 2px);
		left: 12px;
		right: 12px;
		max-width: 360px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.8rem 1rem;
		border-radius: 14px;
		border: 1px solid #262626;
		border-top: 2px solid var(--accent);
		background: rgba(10, 10, 10, 0.94);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
		font-size: 0.8rem;
		line-height: 1.45;
		color: #b5b5b5;
		z-index: 1;
	}
	.details.closes {
		--accent: var(--state-live);
	}
	.details strong {
		color: #fff;
		font-size: 0.85rem;
	}

	/* ---- version, quick access, account ----------------------------------- */
	.status-quick {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		margin-left: auto;
	}
	.quick-link {
		position: relative;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 10px;
		border: 1px solid #262626;
		background: #0f0f0f;
		color: #d4d4d4;
		font-size: 1.05rem;
		text-decoration: none;
	}
	.quick-link:hover {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.08);
	}
	.quick-link:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.quick-link.active {
		border-color: rgba(45, 212, 191, 0.45);
		background: rgba(45, 212, 191, 0.12);
	}
	/* Pink is the special-needs colour, and this count is nothing else. */
	.quick-badge {
		position: absolute;
		top: -6px;
		right: -6px;
		min-width: 1.1rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: var(--state-special);
		color: #111;
		font-size: 0.6rem;
		font-weight: 900;
		line-height: 1.1rem;
		text-align: center;
		box-sizing: border-box;
	}
	.account {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		max-width: 14rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: #2dd4bf;
		white-space: nowrap;
	}
	.account-local {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.account-domain {
		flex-shrink: 0;
		color: #6b7f7c;
	}
	.role-dot {
		flex-shrink: 0;
		margin-right: 0.25rem;
	}
	.logout-form {
		display: flex;
		flex-shrink: 0;
	}
	.logout-btn {
		background: transparent;
		border: 1px solid var(--state-full);
		min-height: 40px;
		min-width: 40px;
		white-space: nowrap;
		padding: 0.4rem 0.8rem;
		border-radius: 10px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		color: var(--state-full);
		font-size: 0.85rem;
		font-weight: bold;
	}
	.logout-btn:hover {
		background: var(--state-full-soft);
	}
	.logout-btn:focus-visible {
		outline: 2px solid var(--state-full);
		outline-offset: 1px;
	}

	/* ---- narrow screens ----------------------------------------------------- */
	/* Tablets and below: the domain goes, the name stays. */
	@media (max-width: 900px) {
		.account-domain {
			display: none;
		}
		.account {
			max-width: 8rem;
		}
	}
	/* Phones: the icons keep to one row, so Eject is its rocket and the account
	   its tooltip on Eject; the pill is its icon (the name stays for readers). */
	@media (max-width: 480px) {
		.account {
			display: none;
		}
		.status-quick {
			gap: 0.4rem;
		}
	}
	@media (max-width: 420px) {
		.logout-btn {
			padding: 0.4rem 0.55rem;
		}
		.logout-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.phase-btn .phase-name {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.phase-btn .phase-pill {
			padding: 0 0.5rem;
		}
		.countdown-label {
			letter-spacing: 0.8px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.phase-btn,
		.chevron {
			transition: none;
		}
	}
</style>
