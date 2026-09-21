<!--
@component
One line at the top of a layout page (house, room, new house) that says
whether the camp layout can be changed right now. In Staging Mode it is
quiet and says when the lock will come (an armed opening time); during Live
Booking and after booking closed it says what is locked, what still works and
who can lift the lock. When the phase switches while the page is open — the
timer opens booking, a superuser switches — the padlock swings shut or open
and the colours follow.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import LockGlyph from '$lib/components/LockGlyph.svelte';
	import {
		formatBerlin,
		lockedDuring,
		type BookingPhase,
		type PhaseTransition
	} from '$lib/booking-phase';

	export let locked: boolean;
	export let phase: BookingPhase;
	export let isSuperuser = false;
	/** What the lock stops on this page: "Rooms can't be added or deleted." */
	export let blocks: string;
	/** What still works while it is locked, if anything. */
	export let still = '';
	/** The timer's next switch (root layout data), for "it locks …". */
	export let next: PhaseTransition | null | undefined = null;

	$: locksAt = next?.to === 'live' ? formatBerlin(next.at) : '';
</script>

<div class="lock-notice" class:locked data-state={locked ? 'warning' : 'staging'} role="status">
	<span class="glyph"><LockGlyph {locked} size={locked ? 18 : 15} /></span>
	{#key locked}
		<p in:fade={{ duration: 260 }}>
			{#if locked}
				<strong>Layout locked {lockedDuring(phase)}.</strong>
				{blocks}
				{still}
				{isSuperuser
					? 'To change it, switch back to Staging Mode in the'
					: 'A superuser can switch back to Staging Mode in the'}
				<a href="/admin">Control Center</a>.
			{:else}
				<strong>Staging Mode:</strong> the layout can be changed.
				{locksAt
					? `It locks when Live Booking starts, ${locksAt}.`
					: 'It locks when Live Booking starts.'}
			{/if}
		</p>
	{/key}
</div>

<style>
	.lock-notice {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 2rem;
		padding: 0.55rem 1rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--state) 28%, transparent);
		background: var(--state-soft);
		color: color-mix(in srgb, var(--state) 85%, #fff);
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.5;
		transition:
			color 0.5s ease,
			background-color 0.5s ease,
			border-color 0.5s ease,
			padding 0.3s ease;
	}
	.lock-notice.locked {
		padding: 1rem 1.5rem;
		border-color: color-mix(in srgb, var(--state) 40%, transparent);
		color: var(--state);
		font-size: 0.85rem;
	}
	.glyph {
		display: flex;
		padding-top: 0.1rem;
		--lock-glyph-hole: #1a120b;
	}
	p {
		margin: 0;
		min-width: 0;
		overflow-wrap: break-word;
	}
	a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	a:hover {
		color: #fff;
	}

	@media (max-width: 640px) {
		.lock-notice.locked {
			padding: 0.85rem 1rem;
		}
	}
</style>
