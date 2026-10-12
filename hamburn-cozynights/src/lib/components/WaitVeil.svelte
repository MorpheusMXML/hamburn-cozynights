<!--
  The wait veil ($lib/waiting): when a guest's sign-in, booking, release or
  page change takes longer than a moment (the opening rush), a card over the
  page says that it's on its way and whether a reload would hurt. A little
  campfire burns inside a ring in the app's colours. Only transform and
  opacity move; with reduced motion the fire just sits there. The veil also
  keeps a second tap (and the keyboard: the page under it is inert) off the
  page while the first one is still on its way. A screen reader hears the
  text from a status line that is always there. Mounted once in the root
  layout.
-->
<script lang="ts">
	import { navigating } from '$app/state';
	import {
		HIDE_GRACE_MS,
		SHOW_AFTER_MS,
		STILL_AFTER_MS,
		STILL_TEXT,
		WAIT_TEXTS,
		followPageChange,
		waitKind,
		waits,
		type PageChange,
		type WaitKind
	} from '$lib/waiting';

	/**
	 * The page change on its way, until its `complete` settles. Not
	 * `navigating.to` alone: after an aborted navigation SvelteKit leaves it on
	 * the dead target for good (see followPageChange).
	 */
	let pageChange = $state<PageChange | null>(null);
	$effect(() => {
		const to = navigating.to;
		const complete = navigating.complete;
		if (!to || !complete) {
			pageChange = null;
			return;
		}
		pageChange = {
			from: navigating.from?.url ?? null,
			to: to.url,
			willUnload: navigating.willUnload ?? false
		};
		return followPageChange(complete, () => (pageChange = null));
	});

	let kind = $derived(waitKind($waits, pageChange));

	/** What the veil shows; set once a wait has lasted SHOW_AFTER_MS. */
	let shown = $state<WaitKind | null>(null);
	let still = $state(false);
	/** When the current run of waits began (0: none), so "still" counts all of it. */
	let since = 0;

	$effect(() => {
		const current = kind;
		if (!current) {
			// A short gap (sign-in → redirect to the map) keeps the veil up.
			const hide = setTimeout(() => {
				shown = null;
				still = false;
				since = 0;
			}, HIDE_GRACE_MS);
			return () => clearTimeout(hide);
		}
		if (!since) since = Date.now();
		const show = setTimeout(
			() => (shown = current),
			Math.max(0, since + SHOW_AFTER_MS - Date.now())
		);
		const later = setTimeout(
			() => (still = true),
			Math.max(0, since + STILL_AFTER_MS - Date.now())
		);
		return () => {
			clearTimeout(show);
			clearTimeout(later);
		};
	});

	let text = $derived(shown ? WAIT_TEXTS[shown] : null);
	let spoken = $derived(
		text
			? [`${text.title}.`, text.body, still ? STILL_TEXT : '', text.note].filter(Boolean).join(' ')
			: ''
	);

	// While the veil covers the page, the page is inert: no tabbing to a button
	// under it. It ends with the wait itself, not after the short grace, so a
	// form can put the cursor into a refused field right away; the focus goes
	// back where it was if nothing else took it.
	let covering = $derived(!!shown && !!kind);
	$effect(() => {
		if (!covering) return;
		const root = document.querySelector<HTMLElement>('.app-root');
		if (!root) return;
		const before = document.activeElement;
		root.inert = true;
		return () => {
			root.inert = false;
			const now = document.activeElement;
			if (before instanceof HTMLElement && before.isConnected && (!now || now === document.body)) {
				before.focus({ preventScroll: true });
			}
		};
	});
</script>

<!-- Always there, so a screen reader announces the text when it arrives. -->
<p class="sr-only" role="status" aria-live="polite" data-layout-ignore>{spoken}</p>

{#if text}
	<!-- data-layout-overlay: the layout test counts the page under it as covered on purpose.
	     aria-hidden: the status line above says the same. -->
	<div class="wait-veil" data-layout-overlay aria-hidden="true">
		<div class="wait-card">
			<svg class="wait-fire" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
				<defs>
					<linearGradient id="wait-ring" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stop-color="#fb923c" />
						<stop offset="0.5" stop-color="#f472b6" />
						<stop offset="1" stop-color="#2dd4bf" />
					</linearGradient>
					<linearGradient id="wait-flame" x1="0" y1="1" x2="0" y2="0">
						<stop offset="0" stop-color="#f97316" />
						<stop offset="1" stop-color="#facc15" />
					</linearGradient>
				</defs>
				<circle
					cx="32"
					cy="32"
					r="28"
					fill="none"
					stroke="rgba(255,255,255,0.08)"
					stroke-width="2"
				/>
				<g class="ring">
					<circle
						cx="32"
						cy="32"
						r="28"
						fill="none"
						stroke="url(#wait-ring)"
						stroke-width="6"
						stroke-linecap="round"
						stroke-dasharray="48 128"
						opacity="0.18"
					/>
					<circle
						cx="32"
						cy="32"
						r="28"
						fill="none"
						stroke="url(#wait-ring)"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-dasharray="48 128"
					/>
				</g>
				<rect
					class="log"
					x="22"
					y="44.5"
					width="20"
					height="3.5"
					rx="1.75"
					transform="rotate(12 32 46)"
				/>
				<rect
					class="log"
					x="22"
					y="44.5"
					width="20"
					height="3.5"
					rx="1.75"
					transform="rotate(-12 32 46)"
				/>
				<path
					class="flame outer"
					d="M32 17 C34 24 41 28 41 36 a9 9 0 0 1 -18 0 C23 31 27 28 28 24 C30 27 31 26 32 17 Z"
					fill="url(#wait-flame)"
				/>
				<path
					class="flame inner"
					d="M32 29 C33 33 36 35 36 39 a4 4 0 0 1 -8 0 C28 36 31 34 32 29 Z"
					fill="#fef3c7"
				/>
				<circle class="spark s1" cx="30" cy="20" r="1.1" />
				<circle class="spark s2" cx="35" cy="22" r="0.9" />
				<circle class="spark s3" cx="32" cy="18" r="1" />
			</svg>
			<p class="wait-title">{text.title}</p>
			<p class="wait-body">{text.body}</p>
			{#if still}
				<p class="wait-still">{STILL_TEXT}</p>
			{/if}
			<p class="wait-note" class:stay={text.stay}>
				<span aria-hidden="true">{text.stay ? '✋' : '☕'}</span>
				{text.note}
			</p>
		</div>
	</div>
{/if}

<style>
	.wait-veil {
		position: fixed;
		inset: 0;
		/* over the page and the guest top bar, under the dialogs */
		z-index: 9000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.55);
		animation: wait-in 0.3s ease-out;
	}

	.wait-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		box-sizing: border-box;
		width: min(22rem, 100%);
		min-width: 0;
		padding: 1.5rem 1.25rem 1.25rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 18px;
		background: rgba(10, 4, 20, 0.92);
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.6),
			0 0 40px rgba(244, 114, 182, 0.12);
		text-align: center;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.wait-fire {
		display: block;
		overflow: visible;
	}

	.wait-title {
		margin: 0.25rem 0 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-wrap: balance;
		color: #fafafa;
	}

	.wait-body,
	.wait-still {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: #d4d4d4;
		text-wrap: pretty;
	}

	.wait-still {
		color: #a3a3a3;
	}

	.wait-note {
		margin: 0.35rem 0 0;
		padding: 0.55rem 0.75rem;
		border-radius: 10px;
		font-size: 0.85rem;
		line-height: 1.45;
		color: #a3a3a3;
		background: rgba(255, 255, 255, 0.04);
	}

	/* A reload doesn't stop what was sent: this one asks the guest to stay. */
	.wait-note.stay {
		color: #fde68a;
		background: rgba(250, 204, 21, 0.1);
		border: 1px solid rgba(250, 204, 21, 0.25);
	}

	.log {
		fill: #78716c;
	}

	.spark {
		fill: #fde68a;
		opacity: 0;
	}

	.ring,
	.flame,
	.spark {
		transform-box: fill-box;
	}

	@media (prefers-reduced-motion: no-preference) {
		.ring {
			/* the ring's own box, so it turns around the middle */
			transform-box: view-box;
			transform-origin: 32px 32px;
			animation: wait-turn 1.6s linear infinite;
		}
		.flame {
			transform-origin: 50% 100%;
			animation: wait-flicker 1.3s ease-in-out infinite alternate;
		}
		.flame.inner {
			animation-duration: 0.9s;
			animation-delay: -0.4s;
		}
		.spark {
			animation: wait-spark 2.4s ease-out infinite;
		}
		.s2 {
			animation-delay: 0.8s;
		}
		.s3 {
			animation-delay: 1.6s;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wait-veil {
			animation: none;
		}
		.spark.s3 {
			opacity: 0.8;
		}
	}

	@keyframes wait-in {
		from {
			opacity: 0;
		}
	}

	@keyframes wait-turn {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes wait-flicker {
		0% {
			transform: scale(1, 1);
		}
		35% {
			transform: scale(0.94, 1.07) skewX(-2deg);
		}
		70% {
			transform: scale(1.04, 0.95) skewX(2deg);
		}
		100% {
			transform: scale(0.97, 1.04);
		}
	}

	@keyframes wait-spark {
		0% {
			opacity: 0;
			transform: translate(0, 0);
		}
		15% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx, 2px), -14px);
		}
	}
	.s1 {
		--dx: -3px;
	}
	.s2 {
		--dx: 4px;
	}
</style>
