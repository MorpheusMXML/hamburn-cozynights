<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

	$: when = data.check?.since
		? new Date(data.check.since.replace(' ', 'T')).toLocaleString('en-GB', {
				timeZone: 'Europe/Berlin',
				dateStyle: 'medium',
				timeStyle: 'short'
			})
		: '';
</script>

<svelte:head>
	<title>Booking pass {data.code} · CozyNights</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="pass-page">
	{#if data.check}
		<!-- The crew's view: what a scan with a signed-in phone shows. -->
		<section class="check {data.spot ? 'valid' : 'nospot'}" aria-live="polite">
			<p class="verdict">
				{#if data.spot}✅ VALID — this ticket holds a spot{:else}⚠️ NO SPOT — the ticket exists, but
					holds no spot right now{/if}
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
					{#if when}
						<dt>Booked</dt>
						<dd>{when}</dd>
					{/if}
				{/if}
			</dl>
			{#if data.spot && (!data.check.enabled || data.check.locked)}
				<p class="warn">
					{#if !data.check.enabled}This spot is deactivated.{:else}This spot is locked for guests.{/if}
					The booking still stands.
				</p>
			{/if}
			<p class="check-links">
				<a href="/admin/check">Check another pass</a>
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
	.check.valid {
		border-color: #2dd4bf;
	}
	.check.nospot {
		border-color: #fb923c;
	}
	.verdict {
		margin: 0 0 0.75rem;
		font-weight: 900;
		font-size: 1.1rem;
	}
	.check.valid .verdict {
		color: #2dd4bf;
	}
	.check.nospot .verdict {
		color: #fb923c;
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
		grid-template-columns: max-content 1fr;
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
