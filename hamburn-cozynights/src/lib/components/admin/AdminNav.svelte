<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { ADMIN_NAV, badgeFor, isActive, type NavCounts } from '$lib/admin-nav';
	import type { BookingPhase, PhaseTransition } from '$lib/booking-phase';
	import AdminStatus from './AdminStatus.svelte';

	/**
	 * The admin menu ($lib/admin-nav.ts) and the status bar above the page.
	 * One <nav>, two shapes:
	 *  - from 1100 px: a sidebar next to the page, sticky, collapsible to its
	 *    icons (remembered per browser);
	 *  - below: a drawer that the ☰ in the bar slides in.
	 * The bar (AdminStatus) is the same at every width: phase, countdown,
	 * version, quick access and the account. From 1100 px the layout places
	 * it above the page next to the sidebar, and the ☰ goes.
	 */
	export let email: string;
	export let isSuperuser = false;
	export let counts: NavCounts;
	export let phase: BookingPhase = 'staging';
	export let next: PhaseTransition | null = null;

	const STORAGE_KEY = 'cozy-admin-nav';
	const WIDE = '(min-width: 1100px)';

	let open = false;
	let collapsed = false;
	let wide = true;
	let burger: HTMLButtonElement;
	let drawer: HTMLElement;

	onMount(() => {
		try {
			collapsed = localStorage.getItem(STORAGE_KEY) === 'collapsed';
		} catch {
			// Private window or blocked storage: the sidebar just starts open.
		}
		const query = window.matchMedia(WIDE);
		const update = () => {
			wide = query.matches;
			if (wide) open = false;
		};
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	// Following a link closes the drawer; the new page takes the focus.
	afterNavigate(() => {
		open = false;
	});

	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'open');
		} catch {
			// Remembering is a convenience; the sidebar works without it.
		}
	}

	async function openDrawer() {
		open = true;
		await tick();
		drawer?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();
	}

	function closeDrawer() {
		if (!open) return;
		open = false;
		burger?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') closeDrawer();
	}

	$: pathname = page.url.pathname;
	$: roleLabel = isSuperuser ? 'SUPERUSER ⚡️' : 'ADMIN';
</script>

<svelte:window on:keydown={onKeydown} />

<!-- The status bar above the page; the ☰ shows below 1100 px. -->
<header class="admin-topbar">
	<button
		bind:this={burger}
		type="button"
		class="burger"
		aria-expanded={open}
		aria-controls="admin-menu"
		aria-label={open ? 'Close the menu' : 'Open the menu'}
		on:click={() => (open ? closeDrawer() : openDrawer())}
	>
		<span class="burger-lines" aria-hidden="true"></span>
	</button>
	<AdminStatus {email} {isSuperuser} {counts} {phase} {next} />
</header>

{#if open}
	<!-- Closes the drawer; the Escape key and the ☰ do the same. -->
	<div class="drawer-backdrop" aria-hidden="true" on:click={closeDrawer}></div>
{/if}

<nav
	id="admin-menu"
	bind:this={drawer}
	class="admin-sidebar"
	class:collapsed={collapsed && wide}
	class:open
	aria-label="Admin pages"
	data-layout-overlay={open ? '' : undefined}
>
	<div class="sidebar-head">
		<a href="/admin" class="logo-link" title="Control Center">
			<span class="logo-text">{collapsed && wide ? 'HB' : 'Hamburn'}</span>
			{#if !(collapsed && wide)}<span class="logo-badge">Admin</span>{/if}
		</a>
		{#if !(collapsed && wide)}
			<span class="badge-role" class:super={isSuperuser}>{roleLabel}</span>
		{/if}
		<button type="button" class="drawer-close" aria-label="Close the menu" on:click={closeDrawer}
			>✕</button
		>
	</div>

	<div class="groups">
		{#each ADMIN_NAV as group (group.key)}
			<section class="group" aria-labelledby="nav-group-{group.key}">
				<h2 id="nav-group-{group.key}" class="group-label">{group.label}</h2>
				<ul>
					{#each group.items as item (item.href)}
						{@const active = isActive(item, pathname)}
						{@const badge = badgeFor(item.badge, counts, phase)}
						<li>
							<a
								href={item.href}
								class="nav-item"
								class:active
								aria-current={active ? 'page' : undefined}
								title={badge ? `${item.title} — ${badge.title}` : item.title}
								target={item.external ? '_blank' : undefined}
								rel={item.external ? 'noopener' : undefined}
							>
								<span class="nav-icon" aria-hidden="true">{item.icon}</span>
								<span class="nav-label">{item.label}</span>
								{#if item.external}<span class="nav-external" aria-hidden="true">↗</span>{/if}
								{#if badge}
									<span class="nav-badge" data-tone={badge.tone} data-badge={item.badge}>
										<span class="sr-only">(</span>{badge.value}<span class="sr-only">)</span>
									</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>

	<!-- The account and Eject are in the bar; here only the sidebar's own switch. -->
	<div class="sidebar-foot">
		<button
			type="button"
			class="collapse-btn"
			aria-pressed={collapsed}
			title={collapsed ? 'Show the menu with its names' : 'Shrink the menu to its icons'}
			on:click={toggleCollapsed}
		>
			<span aria-hidden="true">{collapsed ? '»' : '«'}</span>
			<span class="nav-label">Shrink menu</span>
		</button>
	</div>
</nav>

<style>
	/* ---- shared ---------------------------------------------------------- */
	.logo-link {
		min-height: 40px;
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.logo-text {
		font-weight: 900;
		font-size: 1.35rem;
		letter-spacing: -1px;
		background: linear-gradient(to right, #2dd4bf, #f472b6);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		text-transform: uppercase;
	}
	.logo-badge {
		background: #222;
		color: #888;
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid #333;
		text-transform: uppercase;
		font-weight: bold;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* ---- the status bar ---------------------------------------------------- */
	/* Two rows at most on a phone: ☰ with the phase and countdown, then the
	   icons (AdminStatus pushes them right and lets them wrap as one). */
	.admin-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.6rem;
		padding: 0.5rem 0.75rem;
		background: rgba(15, 15, 15, 0.92);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid #222;
		position: sticky;
		/* The admin layout sets this to 0: the bar carries the countdown itself. */
		top: var(--booking-bar-height, 0px);
		z-index: 100;
	}
	.burger {
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border-radius: 10px;
		border: 1px solid #2dd4bf;
		background: transparent;
		color: #2dd4bf;
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.burger-lines,
	.burger-lines::before,
	.burger-lines::after {
		display: block;
		width: 18px;
		height: 2px;
		border-radius: 1px;
		background: currentColor;
		position: relative;
	}
	.burger-lines::before,
	.burger-lines::after {
		content: '';
		position: absolute;
		left: 0;
	}
	.burger-lines::before {
		top: -6px;
	}
	.burger-lines::after {
		top: 6px;
	}
	.burger[aria-expanded='true'] .burger-lines {
		background: transparent;
	}
	.burger[aria-expanded='true'] .burger-lines::before {
		top: 0;
		transform: rotate(45deg);
	}
	.burger[aria-expanded='true'] .burger-lines::after {
		top: 0;
		transform: rotate(-45deg);
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: 190;
		background: rgba(0, 0, 0, 0.6);
	}

	/* ---- the menu: a drawer below 1100 px ------------------------------------ */
	.admin-sidebar {
		position: fixed;
		top: var(--booking-bar-height, 0px);
		bottom: 0;
		left: 0;
		z-index: 200;
		width: min(19rem, 86vw);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 0.75rem;
		background: #0b0b0b;
		border-right: 1px solid #222;
		box-shadow: 10px 0 40px rgba(0, 0, 0, 0.6);
		overflow-y: auto;
		overscroll-behavior: contain;
		transform: translateX(-105%);
		visibility: hidden;
		transition:
			transform 0.25s ease,
			visibility 0s linear 0.25s;
	}
	.admin-sidebar.open {
		transform: none;
		visibility: visible;
		transition: transform 0.25s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.admin-sidebar,
		.admin-sidebar.open {
			transition: none;
		}
	}

	.sidebar-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		padding: 0 0.5rem 0.75rem;
		border-bottom: 1px solid #1c1c1c;
	}
	.drawer-close {
		margin-left: auto;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		border: 1px solid #333;
		background: transparent;
		color: #aaa;
		font-size: 1rem;
		cursor: pointer;
	}
	.drawer-close:hover {
		color: #fff;
		border-color: #666;
	}
	.badge-role {
		background: rgba(163, 163, 163, 0.08);
		color: #a3a3a3;
		padding: 3px 10px;
		border-radius: 20px;
		font-size: 0.65rem;
		font-weight: 900;
		border: 1px solid #333;
		white-space: nowrap;
	}
	.badge-role.super {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		border-color: #2dd4bf;
	}

	.groups {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex: 1 0 auto;
	}
	.group-label {
		margin: 0 0 0.35rem;
		padding: 0 0.6rem;
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: #5c5c5c;
	}
	.group ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 42px;
		padding: 0 0.6rem;
		border-radius: 10px;
		border: 1px solid transparent;
		color: #d4d4d4;
		font-weight: 700;
		font-size: 0.9rem;
		text-decoration: none;
	}
	.nav-item:hover {
		background: rgba(45, 212, 191, 0.08);
		color: #fff;
	}
	.nav-item:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.nav-item.active {
		background: rgba(45, 212, 191, 0.12);
		border-color: rgba(45, 212, 191, 0.45);
		color: #2dd4bf;
	}
	.nav-icon {
		width: 1.5rem;
		text-align: center;
		flex-shrink: 0;
	}
	.nav-label {
		flex: 1 1 auto;
		min-width: 0;
	}
	.nav-external {
		color: #666;
		font-size: 0.8rem;
	}
	.nav-badge {
		flex-shrink: 0;
		min-width: 1.4rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 900;
		text-align: center;
		line-height: 1.35rem;
		background: #262626;
		color: #a3a3a3;
	}
	/* An accent badge asks for a hand: pink only for the ♿ requests, red for
	   the booked guests still to arrive (booked = red, never pink). */
	.nav-badge[data-tone='accent'] {
		background: var(--state-full);
		color: #111;
	}
	.nav-badge[data-tone='accent'][data-badge='requests'] {
		background: var(--state-special);
	}

	/* The foot only holds the sidebar's shrink switch, which a drawer has no use for. */
	.sidebar-foot {
		display: none;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.5rem 0;
		border-top: 1px solid #1c1c1c;
	}
	.collapse-btn {
		display: none;
	}

	/* ---- the menu: a sidebar from 1100 px ------------------------------------- */
	@media (min-width: 1100px) {
		.burger,
		.drawer-backdrop,
		.drawer-close {
			display: none;
		}
		.admin-topbar {
			padding: 0.5rem 1.25rem;
		}
		.sidebar-foot {
			display: flex;
		}
		.admin-sidebar {
			position: sticky;
			top: 0;
			height: 100vh;
			height: 100dvh;
			width: 15.5rem;
			flex-shrink: 0;
			transform: none;
			visibility: visible;
			transition: none;
			box-shadow: none;
			background: rgba(12, 12, 12, 0.9);
		}
		.collapse-btn {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			min-height: 36px;
			padding: 0 0.6rem;
			border-radius: 8px;
			border: 1px solid #222;
			background: transparent;
			color: #777;
			font-size: 0.75rem;
			font-weight: 700;
			cursor: pointer;
		}
		.collapse-btn:hover {
			color: #2dd4bf;
			border-color: #2dd4bf;
		}

		/* Icons only: labels stay for screen readers, the title for the pointer. */
		.admin-sidebar.collapsed {
			width: 4.5rem;
			padding-left: 0.5rem;
			padding-right: 0.5rem;
		}
		.collapsed .sidebar-head {
			justify-content: center;
			padding-left: 0;
			padding-right: 0;
		}
		.collapsed .group-label,
		.collapsed .nav-label,
		.collapsed .nav-external {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.collapsed .nav-item {
			justify-content: center;
			position: relative;
			padding: 0;
		}
		.collapsed .nav-badge {
			position: absolute;
			top: 2px;
			right: 0;
			min-width: 1.1rem;
			padding: 0 0.2rem;
			font-size: 0.6rem;
			line-height: 1.1rem;
		}
		.collapsed .collapse-btn {
			justify-content: center;
			padding: 0;
		}
		.collapsed .sidebar-foot {
			padding-left: 0;
			padding-right: 0;
		}
	}
</style>
