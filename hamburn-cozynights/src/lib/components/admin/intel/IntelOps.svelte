<script lang="ts">
	import type { Count, OpsStats } from '$lib/live-stats';
	import { formatCount } from '$lib/intel';

	export let ops: OpsStats | null;
	export let ticketsWithSpot: number;
	export let ticketsWithoutSpot: number;

	interface Line {
		label: string;
		value: string;
		/** Colours the value when it asks for attention (danger / warning). */
		state?: string;
	}
	interface Card {
		key: string;
		icon: string;
		title: string;
		lines: Line[];
		href?: string;
		linkLabel?: string;
	}

	const count = (value: Count | undefined) => formatCount(value ?? null);
	const flag = (value: Count | undefined, state: string) =>
		typeof value === 'number' && value > 0 ? state : undefined;
	const onOff = (on: boolean | undefined) => (on ? 'on' : 'off');

	$: cards = ((): Card[] => {
		const tickets = ops?.tickets;
		const messages = ops?.messages;
		const requests = ops?.requests;
		const crew = ops?.crew;
		return [
			{
				key: 'tickets',
				icon: '🎟',
				title: 'Tickets',
				lines: [
					{ label: 'Loaded', value: count(tickets?.total) },
					{ label: 'With a spot', value: count(ticketsWithSpot) },
					{
						label: 'Without a spot',
						value: typeof tickets?.total === 'number' ? count(ticketsWithoutSpot) : '—'
					},
					{ label: 'With an e-mail address', value: count(tickets?.withEmail) },
					{ label: 'Telegram linked', value: count(tickets?.telegram) }
				],
				href: '/admin/tickets',
				linkLabel: 'Tickets'
			},
			{
				key: 'messages',
				icon: '✉️',
				title: 'Guest messages',
				lines: [
					{ label: 'E-mail to guests', value: ops ? onOff(messages?.mailOn) : '—' },
					{ label: 'Telegram bot', value: ops ? onOff(messages?.telegramOn) : '—' },
					{ label: 'Guests e-mailed', value: count(tickets?.mailed) },
					{ label: 'Waiting to go out', value: count(messages?.queued) },
					{
						label: 'Being retried',
						value: count(messages?.retrying),
						state: flag(messages?.retrying, 'warning')
					},
					{
						label: 'Failed for good',
						value: count(messages?.failed),
						state: flag(messages?.failed, 'danger')
					}
				],
				href: '/admin/messages',
				linkLabel: 'Message texts'
			},
			{
				key: 'requests',
				icon: '♿',
				title: 'Special-needs requests',
				lines: [
					{
						label: 'Waiting for a decision',
						value: count(requests?.pending),
						state: flag(requests?.pending, 'warning')
					},
					{ label: 'Approved', value: count(requests?.approved) },
					{ label: 'Declined', value: count(requests?.declined) }
				],
				href: '/admin/requests',
				linkLabel: 'Requests'
			},
			{
				key: 'crew',
				icon: '👥',
				title: 'Crew',
				lines: [
					{ label: 'Admins', value: count(crew?.admins) },
					{
						label: 'Sign-ins waiting for approval',
						value: count(crew?.accessRequests),
						state: flag(crew?.accessRequests, 'warning')
					},
					{ label: 'Crew alerts waiting', value: count(crew?.alertsQueued) },
					{
						label: 'Crew alerts failed',
						value: count(crew?.alertsFailed),
						// Red only while none got through since; older failures are history.
						state: flag(crew?.alertsFailing, 'danger')
					}
				]
			}
		];
	})();
</script>

<section class="intel-block" aria-labelledby="intel-ops-title">
	<header class="intel-block-head">
		<h4 id="intel-ops-title">TICKETS, MESSAGES & CREW</h4>
		<span class="intel-scope">Whole camp{ops ? '' : ' · could not be read right now'}</span>
	</header>
	<div class="ops-cards">
		{#each cards as card (card.key)}
			<article class="ops-card">
				<h5><span aria-hidden="true">{card.icon}</span> {card.title}</h5>
				<dl>
					{#each card.lines as line (line.label)}
						<div class="ops-line">
							<dt>{line.label}</dt>
							<dd data-state={line.state}>{line.value}</dd>
						</div>
					{/each}
				</dl>
				{#if card.href}
					<a class="ops-link" href={card.href}>{card.linkLabel} →</a>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.ops-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
		gap: 0.75rem;
	}
	.ops-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		background: #0f0f0f;
		border: 1px solid #1f1f1f;
		border-radius: 12px;
		min-width: 0;
	}
	.ops-card h5 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #d4d4d4;
	}
	.ops-card dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.ops-line {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid #161616;
	}
	.ops-line dt {
		min-width: 0;
		font-size: 0.7rem;
		font-weight: 700;
		color: #a3a3a3;
	}
	.ops-line dd {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 900;
		color: #fff;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.ops-line dd[data-state] {
		color: var(--state);
	}
	.ops-link {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		margin-top: auto;
		color: #2dd4bf;
		font-size: 0.7rem;
		font-weight: 800;
		text-decoration: none;
	}
	.ops-link:hover {
		text-decoration: underline;
	}
</style>
