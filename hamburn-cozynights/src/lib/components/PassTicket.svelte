<!--
@component
A small ticket with the guest's own spot and pass code. Tapping it opens the
booking pass with the QR code (docs/admin/passes.md). House and room pages
show it where they tell guests that they already hold a spot, the map on its
Closed panel.
-->
<script lang="ts">
	import type { PassSummary } from '$lib/pass';

	let { pass }: { pass: PassSummary } = $props();
</script>

<a class="pass-ticket" href="/pass/{pass.code}">
	<span class="ticket">
		<span class="main">
			<span class="kicker"><span aria-hidden="true">🎫</span> Your booking pass</span>
			{#if pass.house}<span class="house">{pass.house}</span>{/if}
			<span class="fields">
				<span class="field"
					><span class="label">Room</span> <span class="value">{pass.room}</span></span
				>
				<span class="field"
					><span class="label">Spot</span> <span class="value">{pass.spot}</span></span
				>
				{#if pass.bed}
					<span class="field"
						><span class="label">Bed</span> <span class="value">{pass.bed}</span></span
					>
				{/if}
				{#if pass.burnerName}
					<span class="field"
						><span class="label">Burner</span> <span class="value">{pass.burnerName}</span></span
					>
				{/if}
			</span>
		</span>
		<span class="stub">
			<svg class="qr" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M2 2h8v8H2zm2 2v4h4V4zM14 2h8v8h-8zm2 2v4h4V4zM2 14h8v8H2zm2 2v4h4v-4z"
				/>
				<path
					d="M5 5h2v2H5zM17 5h2v2h-2zM5 17h2v2H5zM13 13h3v3h-3zM19 13h3v3h-3zM16 16h3v3h-3zM13 19h3v3h-3zM19 19h3v3h-3z"
				/>
			</svg>
			<span class="code">{pass.code}</span>
			<span class="open">Show pass <span aria-hidden="true">→</span></span>
		</span>
	</span>
</a>

<style>
	.pass-ticket {
		container: pass-ticket / inline-size;
		display: block;
		/* A size container ignores its content's width: give it one (banners shrink to their text). */
		width: 26rem;
		max-width: 100%;
		margin-top: 1rem;
		border-radius: 14px;
		color: #e5e5e5;
		text-decoration: none;
		transition:
			transform 0.2s ease,
			filter 0.2s ease;
	}
	/* The glow sits on the link: the ticket's mask would cut off its own shadow. */
	.pass-ticket:hover {
		transform: translateY(-2px);
		filter: drop-shadow(0 8px 18px rgba(244, 114, 182, 0.28));
	}
	.pass-ticket:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	/* Two notches where the stub tears off. The mask cuts them out, so the
	   banner behind shows through whatever its colour. */
	.ticket {
		--notch: 9px;
		--stub: 8.5rem;
		--tear: calc(100% - var(--stub));
		--notches:
			radial-gradient(circle var(--notch) at var(--tear) 0, #0000 98%, #000) top / 100% 51%
				no-repeat,
			radial-gradient(circle var(--notch) at var(--tear) 100%, #0000 98%, #000) bottom / 100% 51%
				no-repeat;
		display: flex;
		min-height: 6.5rem;
		border: 1px solid #333;
		border-radius: 14px;
		background:
			radial-gradient(130% 120% at 0% 0%, rgba(244, 114, 182, 0.14), transparent 60%),
			linear-gradient(135deg, #1c1c1c, #0f0f0f);
		-webkit-mask: var(--notches);
		mask: var(--notches);
		transition: border-color 0.2s ease;
	}
	.pass-ticket:hover .ticket {
		border-color: #f472b6;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.85rem 1rem 0.9rem 1.1rem;
	}
	.kicker {
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #f472b6;
	}
	.house {
		font-size: 1.1rem;
		font-weight: 900;
		line-height: 1.2;
		color: #fff;
		overflow-wrap: anywhere;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.25rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.label {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #8a8a8a;
	}
	.value {
		font-size: 0.9rem;
		font-weight: 800;
		line-height: 1.3;
		color: #e5e5e5;
		overflow-wrap: anywhere;
	}

	.stub {
		flex: 0 0 var(--stub);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.75rem 0.5rem;
		border-left: 2px dashed #3a3a3a;
		background: rgba(45, 212, 191, 0.06);
		text-align: center;
	}
	.qr {
		width: 30px;
		height: 30px;
		color: #2dd4bf;
	}
	.code {
		font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: #fff;
		white-space: nowrap;
	}
	.open {
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		color: #2dd4bf;
	}

	/* Narrow: the stub tears off at the bottom. */
	@container pass-ticket (max-width: 21rem) {
		.ticket {
			--stub: 3.25rem;
			--notches:
				radial-gradient(circle var(--notch) at 0 var(--tear), #0000 98%, #000) left / 51% 100%
					no-repeat,
				radial-gradient(circle var(--notch) at 100% var(--tear), #0000 98%, #000) right / 51% 100%
					no-repeat;
			flex-direction: column;
			min-height: 0;
		}
		.stub {
			flex-direction: row;
			justify-content: flex-start;
			gap: 0.75rem;
			padding: 0 1rem 0 1.1rem;
			border-left: 0;
			border-top: 2px dashed #3a3a3a;
		}
		.qr {
			width: 24px;
			height: 24px;
		}
		.open {
			margin-left: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pass-ticket,
		.ticket {
			transition: none;
		}
		.pass-ticket:hover {
			transform: none;
		}
	}
</style>
