<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';
	import type { PassCheckResult } from '$lib/pass';
	import { formatBerlin } from '$lib/booking-phase';
	import { confirmDialog, toast } from '$lib/dialogs';

	export let data: PageData;

	let busy = false;
	let checkError = '';

	$: booked = formatBerlin(data.check?.bookedAt ?? '', { year: false });
	$: checkIn = data.spot ? (data.check?.checkIn ?? null) : null;

	const DONE: Partial<Record<PassCheckResult['status'], string>> = {
		checkedin: '✅ Checked in. Welcome!',
		already: 'This pass was checked in already.',
		undone: '↩️ Check-in undone: the spot stays booked.',
		nospot: 'The ticket holds no spot anymore: nothing to check in.'
	};

	/**
	 * The crew's buttons post to the admin check page (only admins get there),
	 * then this pass reloads with the new state.
	 */
	function crewStep(kind: 'checkin' | 'undo'): SubmitFunction {
		return async ({ cancel }) => {
			if (kind === 'undo') {
				const ok = await confirmDialog(
					'The guest shows as booked again, not as arrived. Their booking stays. Use this for a mistake at the desk.',
					{
						title: 'Undo this check-in?',
						tone: 'warning',
						confirmLabel: 'Undo check-in',
						cancelLabel: 'Keep it'
					}
				);
				if (!ok) {
					cancel();
					return;
				}
			}
			busy = true;
			checkError = '';
			return async ({ result }) => {
				busy = false;
				if (result.type === 'success') {
					const status = (result.data?.result as PassCheckResult | undefined)?.status;
					const message = status ? DONE[status] : '';
					if (message) toast(message, status === 'checkedin' ? 'success' : 'info');
					await invalidateAll();
				} else if (result.type === 'failure') {
					checkError =
						typeof result.data?.error === 'string' ? result.data.error : 'That did not work.';
				} else {
					checkError =
						'That did not work: the server could not be reached, or your admin session has ended. Reload the page and try again.';
				}
			};
		};
	}
</script>

<svelte:head>
	<title>Booking pass {data.code} · CozyNights</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="pass-page">
	{#if data.check}
		<!-- The crew's view: what a scan with a signed-in phone shows. -->
		<section
			class="check {!data.spot ? 'nospot' : checkIn ? 'checkedin' : 'booked'}"
			aria-live="polite"
		>
			<p class="verdict">
				{#if !data.spot}⚠️ NO SPOT — the ticket exists, but holds no spot right now
				{:else if checkIn}✅ CHECKED IN — this guest has arrived
				{:else}🛏️ BOOKED — not checked in yet{/if}
			</p>
			<dl>
				<dt>Ticket</dt>
				<dd>{data.check.ticketName || '—'}</dd>
				{#if data.check.email}
					<dt>E-mail</dt>
					<dd>{data.check.email}</dd>
				{/if}
				{#if data.spot}
					<dt>Spot</dt>
					<dd><strong>{data.spot.spot}</strong> · {data.spot.room} · {data.spot.house}</dd>
					{#if data.burnerName}
						<dt>Burner name</dt>
						<dd>{data.burnerName}</dd>
					{/if}
					{#if booked}
						<dt>Booked</dt>
						<dd>{booked}</dd>
					{/if}
					{#if checkIn}
						<dt>Checked in</dt>
						<dd>
							{formatBerlin(checkIn.at, { year: false })}{checkIn.by ? ` · ${checkIn.by}` : ''}
						</dd>
					{/if}
				{/if}
			</dl>
			{#if data.spot && (!data.check.enabled || data.check.locked)}
				<p class="warn">
					{#if !data.check.enabled}This spot is deactivated.{:else}This spot is locked for guests.{/if}
					The booking still stands.
				</p>
			{/if}
			{#if data.spot}
				{#if checkIn}
					<form method="POST" action="/admin/check?/undo" use:enhance={crewStep('undo')}>
						<input type="hidden" name="code" value={data.code} />
						<button type="submit" class="btn-undo" disabled={busy}>↩️ Undo check-in</button>
					</form>
				{:else}
					<form method="POST" action="/admin/check?/checkin" use:enhance={crewStep('checkin')}>
						<input type="hidden" name="code" value={data.code} />
						<button type="submit" class="btn-checkin" disabled={busy}>
							{busy ? 'Checking in…' : '✅ Check in'}
						</button>
					</form>
				{/if}
			{/if}
			{#if checkError}<p class="warn" role="alert">{checkError}</p>{/if}
			<p class="check-links">
				<a href="/admin/check">Check in another pass</a>
				{#if data.check.roomId}<a href="/admin/room/{data.check.roomId}">Open the room</a>{/if}
			</p>
		</section>
	{/if}

	<article class="pass" aria-label="CozyNights booking pass">
		<header>
			<p class="kicker">Hamburn · CozyNights</p>
			<h1>Booking pass</h1>
		</header>

		{#if data.spot}
			<dl class="spot">
				<dt>House</dt>
				<dd>{data.spot.house}</dd>
				<dt>Room</dt>
				<dd>{data.spot.room}</dd>
				<dt>Spot</dt>
				<dd>{data.spot.spot}</dd>
				{#if data.burnerName}
					<dt>Burner</dt>
					<dd>{data.burnerName}</dd>
				{/if}
			</dl>
		{:else}
			<p class="no-spot">
				This ticket holds no spot right now. Pick one on the map while booking is open.
			</p>
		{/if}

		<div class="qr" role="img" aria-label="QR code of booking pass {data.code}">
			<!-- generated on the server from this pass's own link -->
			{@html data.qrSvg}
		</div>
		<p class="code">{data.code}</p>

		<p class="hint">
			Show this pass when you arrive if the crew asks for it. A screenshot works too — or save the
			QR code:
		</p>
		<p class="actions">
			<a class="btn" href="/pass/{data.code}/qr.gif" download>Save QR code</a>
			<a class="btn secondary" href="/map">Camp map</a>
		</p>
	</article>
</main>

<style>
	.pass-page {
		min-height: 100vh;
		min-height: 100dvh;
		padding: clamp(1rem, 5vw, 3rem) 1rem;
		background: #0a0a0a;
		color: #e5e5e5;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		box-sizing: border-box;
	}

	.check,
	.pass {
		width: 100%;
		max-width: 420px;
		box-sizing: border-box;
		border-radius: 20px;
		padding: 1.25rem 1.5rem;
	}

	.check {
		background: #111;
		border: 2px solid #333;
	}
	.check.checkedin {
		border-color: #2dd4bf;
	}
	.check.booked {
		border-color: #a3a3a3;
	}
	.check.nospot {
		border-color: #fb923c;
	}
	.verdict {
		margin: 0 0 0.75rem;
		font-weight: 900;
		font-size: 1.1rem;
	}
	.check.checkedin .verdict {
		color: #2dd4bf;
	}
	.check.nospot .verdict {
		color: #fb923c;
	}
	.check form {
		margin: 1rem 0 0;
	}
	.btn-checkin,
	.btn-undo {
		min-height: 48px;
		padding: 0 1.25rem;
		border-radius: 10px;
		font-weight: 900;
		cursor: pointer;
	}
	.btn-checkin {
		width: 100%;
		border: none;
		background: #2dd4bf;
		color: #000;
		font-size: 1.05rem;
	}
	.btn-undo {
		border: 1px solid #525252;
		background: transparent;
		color: #e5e5e5;
	}
	.btn-checkin:disabled,
	.btn-undo:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.warn {
		color: #fecaca;
		font-weight: 700;
	}
	.check-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 1rem 0 0;
	}
	.check-links a {
		color: #2dd4bf;
		font-weight: 700;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
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
	/* Small phones: label above value, next to it a long name got a word per line. */
	@media (max-width: 25rem) {
		dl {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 0;
		}
		dd + dt {
			margin-top: 0.5rem;
		}
	}

	.pass {
		background: linear-gradient(160deg, #161616, #0f0f0f);
		border: 1px solid #262626;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
		text-align: center;
	}
	.pass header h1 {
		margin: 0.25rem 0 1rem;
		font-size: 1.8rem;
		font-weight: 900;
	}
	.kicker {
		margin: 0;
		color: #f472b6;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-size: 0.8rem;
	}
	.pass .spot {
		text-align: left;
		margin: 0 auto 1.25rem;
		max-width: 300px;
		font-size: 1.05rem;
	}
	.pass .spot dd {
		font-weight: 800;
		color: #fff;
	}
	.no-spot {
		color: #fb923c;
		font-weight: 700;
	}

	/* Scanners need dark modules on a light background and a quiet zone. */
	.qr {
		background: #fff;
		border-radius: 12px;
		padding: 12px;
		width: min(100%, 280px);
		margin: 0 auto;
		box-sizing: border-box;
		line-height: 0;
	}
	.qr :global(svg) {
		width: 100%;
		height: auto;
		display: block;
	}

	.code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		margin: 1rem 0 0.5rem;
		color: #fff;
	}
	.hint {
		color: #a3a3a3;
		font-size: 0.9rem;
		line-height: 1.45;
		margin: 0.5rem 0 1rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
		margin: 0;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 1.25rem;
		border-radius: 10px;
		background: #2dd4bf;
		color: #000;
		font-weight: 800;
		text-decoration: none;
	}
	.btn.secondary {
		background: transparent;
		color: #2dd4bf;
		border: 1px solid #2dd4bf;
	}

	@media print {
		.pass-page {
			background: #fff;
			color: #000;
		}
		.check,
		.actions {
			display: none;
		}
		.pass {
			box-shadow: none;
			border: 1px solid #000;
			background: #fff;
		}
		.pass .spot dd,
		.code {
			color: #000;
		}
	}
</style>
