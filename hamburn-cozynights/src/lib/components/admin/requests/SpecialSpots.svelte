<script lang="ts">
	/**
	 * The ♿ panel of the requests page (docs/admin/special-needs.md): every spot
	 * marked ♿ SPECIAL on a room page and where it stands. Only the free ones
	 * are in the picker; for every other one the list says why and where to
	 * change that, so a ♿ spot never just goes missing.
	 *
	 * The holder is the ticket's name from the ticket list: admin-only, like the
	 * rest of this page (no-store), and nowhere else.
	 */
	import type { SpecialSpotState, SpecialSpotView } from '$lib/server/special-requests';

	let { spots }: { spots: SpecialSpotView[] } = $props();

	const count = (state: SpecialSpotState) => spots.filter((spot) => spot.state === state).length;

	/** "2 free · 1 booked through requests · 1 inactive": empty parts left out, except free. */
	const summary = $derived(
		[
			`${count('free')} free`,
			...(
				[
					['request', 'booked through requests'],
					['booked', 'booked otherwise'],
					['blocked', 'blocked with TAKEN'],
					['inactive', 'inactive']
				] as const
			)
				.map(([state, words]) => ({ n: count(state), words }))
				.filter(({ n }) => n > 0)
				.map(({ n, words }) => `${n} ${words}`)
		].join(' · ')
	);

	function stateText(spot: SpecialSpotView): string {
		const holder = spot.holder || 'a ticket without a name';
		switch (spot.state) {
			case 'free':
				return spot.locked ? 'free 🔒' : 'free';
			case 'request':
				return `booked for ${holder} through their request`;
			case 'booked':
				return `booked by ${holder}, not through a request — release it on the room page to offer it here`;
			case 'blocked':
				return 'blocked with TAKEN — free it on the room page to offer it here';
			case 'inactive':
				return 'inactive — activate it on the room page to offer it here';
		}
	}

	/** Not offered in the picker, and the crew can change that on the room page. */
	const held = (state: SpecialSpotState) =>
		state === 'booked' || state === 'blocked' || state === 'inactive';
</script>

<section class="special-spots">
	<h2>♿ Special-needs spots</h2>
	{#if spots.length === 0}
		<p class="hint">
			No spot is marked ♿ yet. Mark spots with ♿ SPECIAL on the room pages: no guest can book
			them, and they are offered first here.
		</p>
	{:else}
		<p class="summary">{summary}</p>
		<details>
			<summary>Show all {spots.length}</summary>
			<ul>
				{#each spots as spot (spot.bedId)}
					<li data-state={held(spot.state) ? 'filling' : undefined} class:held={held(spot.state)}>
						<a href="/admin/room/{spot.roomId}">{spot.label}</a>
						<span class="state">{stateText(spot)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.special-spots {
		padding: 0.85rem 1.1rem;
		border: 1px solid #3f3f46;
		border-left: 4px solid var(--state-special);
		border-radius: 14px;
		min-width: 0;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1rem;
	}
	.summary,
	.hint {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.summary {
		color: #e5e5e5;
		font-weight: 700;
	}
	.hint {
		color: #a1a1aa;
	}
	summary {
		cursor: pointer;
		color: #a3a3a3;
		font-weight: 700;
		padding: 0.7rem 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		padding: 0.35rem 0 0.35rem 0.75rem;
		border-left: 3px solid #3f3f46;
		font-size: 0.9rem;
	}
	li.held {
		border-left-color: var(--state);
	}
	a {
		color: #2dd4bf;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.state {
		color: #a3a3a3;
		overflow-wrap: anywhere;
	}
	li.held .state {
		color: var(--state);
	}
</style>
