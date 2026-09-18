<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import EffigyTitle from '$lib/components/EffigyTitle.svelte';
	import LegalLinks from '$lib/components/LegalLinks.svelte';
	import type { ActionData, PageData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	const neonColors = ['#f472b6', '#2dd4bf', '#fb923c', '#a855f7', '#fff'];
	let isHovering = false;

	// The title's pause button stops the background video as well; visitors who
	// prefer reduced motion don't get it playing in the first place.
	let motionPaused = false;
	let reducedMotion = false;
	let video: HTMLVideoElement;

	onMount(() => {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	$: syncVideo(video, motionPaused || reducedMotion);

	function syncVideo(element: HTMLVideoElement | undefined, stop: boolean) {
		if (!element) return;
		if (stop) element.pause();
		else element.play().catch(() => {});
	}

	// Keep in sync with the server-side check in +page.server.ts.
	const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
	const SURROUNDING_BLANKS = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g;

	let codeInput: HTMLInputElement;
	let code = form?.code ?? '';
	let clientError = '';
	let isSubmitting = false;

	$: errorMessage = clientError || (isSubmitting ? '' : (form?.error ?? ''));

	// Guest pages send visitors here when the ticket-code cookie is missing or stale.
	$: loginHint =
		$page.url.searchParams.get('login') === 'expired'
			? 'Your ticket code is not valid on this device (anymore). Please enter it again.'
			: $page.url.searchParams.get('login') === 'required'
				? 'Please enter your ticket code first. After that you can open the map and pick your spot.'
				: '';

	function checkTicketCode(value: string): string {
		if (!value) return 'Please enter your ticket code.';
		if (!TICKET_CODE_PATTERN.test(value)) {
			return 'Ticket codes only contain letters, digits, - and _. Check for spaces or typos.';
		}
		return '';
	}

	async function showClientError(message: string) {
		clientError = message;
		await tick();
		codeInput?.focus();
	}
</script>

<svelte:head>
	<title>CozyNights – Hamburn</title>
	<meta
		name="description"
		content="CozyNights: pick your sleeping spot at Hamburn with your ticket code."
	/>
</svelte:head>

<section class="hero">
	<video
		bind:this={video}
		class="background-video"
		autoplay
		muted
		loop
		playsinline
		poster="/background.jpg"
		aria-hidden="true"
		tabindex="-1"
	>
		<source src="/background.mp4" type="video/mp4" />
	</video>

	<div class="scan-overlay"></div>

	<div class="content-wrapper">
		<div class="logo-area" in:fade={{ delay: 600 }}>
			<img src="/logo.png" alt="Mauersegler logo" class="club-logo" />
		</div>

		<div class="title-container">
			<EffigyTitle bind:paused={motionPaused} />
		</div>

		<div class="login-module" in:fly={{ y: 30, delay: 900, duration: 600 }}>
			{#if loginHint && !errorMessage}
				<p class="login-hint" role="status">{loginHint}</p>
			{/if}

			<!-- novalidate: the browser's own validation bubbles follow the browser
			     language; the app checks the field itself and answers in English. -->
			<form
				method="POST"
				action="?/login"
				novalidate
				class="input-group"
				class:has-error={!!errorMessage}
				use:enhance={({ formData, cancel }) => {
					const cleaned = code.replace(SURROUNDING_BLANKS, '');
					const problem = checkTicketCode(cleaned);
					if (problem) {
						cancel();
						showClientError(problem);
						return;
					}
					code = cleaned;
					formData.set('bookingCode', cleaned);
					clientError = '';
					isSubmitting = true;

					return async ({ result, update }) => {
						isSubmitting = false;
						if (result.type === 'error') {
							// Network hiccup or server crash: stay on the form instead of
							// swapping the whole page for an error screen.
							showClientError(
								'We could not reach the server. Check your internet connection and try again.'
							);
							return;
						}
						await update({ reset: false });
						if (result.type === 'failure') {
							await tick();
							codeInput?.focus();
						}
					};
				}}
			>
				<input
					type="text"
					name="bookingCode"
					id="ticket-code"
					bind:this={codeInput}
					bind:value={code}
					on:input={() => (clientError = '')}
					placeholder="TICKET CODE"
					aria-label="Ticket code"
					aria-invalid={errorMessage ? 'true' : undefined}
					aria-describedby={errorMessage ? 'ticket-code-error' : undefined}
					autocomplete="off"
					autocapitalize="characters"
					autocorrect="off"
					spellcheck="false"
					enterkeyhint="go"
					maxlength="80"
				/>
				<div class="button-container">
					{#if isHovering}
						<div class="party-zone">
							{#each Array(40) as _, i}
								<div
									class="particle"
									style="--angle: {Math.random() * 360}deg; --dist: {60 +
										Math.random() * 120}px; --color: {neonColors[
										i % neonColors.length
									]}; --delay: {Math.random() * 1.5}s; --size: {0.8 + Math.random() * 1.5}rem"
								>
									{['✨', '🔥', '🌵', '⚡️', '🌈', '💎', '🚀', '🎡'][i % 8]}
								</div>
							{/each}
						</div>
					{/if}
					<button
						type="submit"
						class:disco-mode={isHovering}
						disabled={isSubmitting}
						on:mouseenter={() => (isHovering = true)}
						on:mouseleave={() => (isHovering = false)}
					>
						{isSubmitting ? 'CHECKING…' : 'ENTER THE DUST 🌵'}
					</button>
				</div>
			</form>

			{#if errorMessage}
				<p class="error-msg" id="ticket-code-error" role="alert" in:fade={{ duration: 150 }}>
					{errorMessage}
				</p>
			{/if}

			{#if data.hasTicket}
				<a class="continue-link" href="/map"
					>Already signed in on this device? Continue to the map →</a
				>
			{/if}

			<p class="privacy-note">
				Signing in keeps your ticket code in a cookie on this device. No tracking.
				<a href="/privacy">Privacy policy</a>
			</p>
		</div>
	</div>

	<footer class="hero-footer">
		<a class="footer-link" href="/docs/guide/" target="_blank" rel="noopener">Help &amp; FAQ</a>
		<LegalLinks />
		<a class="footer-link crew" href="/admin/login" aria-label="Crew login">
			<span aria-hidden="true">🔒</span> Crew
		</a>
	</footer>
</section>

<style>
	.hero {
		position: relative;
		/* minus the booking countdown bar on top, if shown (+layout.svelte) */
		min-height: calc(100vh - var(--booking-bar-height, 0px));
		min-height: calc(100dvh - var(--booking-bar-height, 0px));
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: 'Inter', sans-serif;
		overflow: hidden;
		background: #000;
	}

	.background-video {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0.4;
		filter: saturate(1.5) contrast(1.2);
	}

	.scan-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background:
			linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%),
			linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
		background-size:
			100% 4px,
			3px 100%;
		pointer-events: none;
		z-index: 2;
	}

	.content-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		width: 100%;
		max-width: 900px;
		padding: 20px;
		z-index: 10;
	}

	.logo-area {
		margin-bottom: 1rem;
	}
	.club-logo {
		width: 100px;
		height: auto;
		filter: drop-shadow(0 0 15px rgba(244, 114, 182, 0.4));
		opacity: 0.8;
	}

	/* The effigy's flames and smoke rise above this box (the canvas reaches
	   beyond it); the space below holds the pause button. */
	.title-container {
		position: relative;
		width: 100%;
		margin: clamp(0.5rem, 4vw, 2.5rem) 0 clamp(3.75rem, 9vh, 5.5rem);
	}

	.login-module {
		width: 100%;
		max-width: 600px;
	}

	.input-group {
		display: flex;
		background: rgba(0, 0, 0, 0.8);
		padding: 10px;
		border-radius: 24px;
		backdrop-filter: blur(30px);
		border: 1px solid #333;
		box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
		transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		overflow: visible;
	}

	.input-group:focus-within {
		border-color: #2dd4bf;
		transform: scale(1.02);
		box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
	}

	.input-group.has-error {
		border-color: #f87171;
		box-shadow: 0 0 40px rgba(248, 113, 113, 0.25);
	}

	input {
		flex: 1;
		min-width: 0;
		background: transparent;
		padding: 1.2rem 2rem;
		font-size: 1rem;
		border: none;
		color: #fff;
		font-weight: 900;
		letter-spacing: 4px;
		font-family: 'JetBrains Mono', monospace;
		text-transform: uppercase;
	}

	input::placeholder {
		color: #8a8a8a;
		opacity: 1;
	}
	input:focus {
		outline: none;
		box-shadow: none;
	}

	.button-container {
		position: relative;
		display: flex;
	}

	button {
		padding: 0 2.5rem;
		font-size: 0.9rem;
		font-weight: 900;
		color: #000;
		background: #2dd4bf;
		border: none;
		border-radius: 16px;
		cursor: pointer;
		transition: all 0.3s;
		text-transform: uppercase;
		letter-spacing: 1px;
		white-space: nowrap;
		z-index: 5;
	}

	button:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	button:focus-visible,
	.footer-link:focus-visible,
	.continue-link:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	button.disco-mode {
		animation: disco-glow 0.5s infinite linear;
		background: linear-gradient(90deg, #f472b6, #2dd4bf, #fb923c, #a855f7, #f472b6);
		background-size: 400% 100%;
		color: #fff;
		transform: scale(1.05);
		box-shadow: 0 0 40px rgba(244, 114, 182, 0.6);
	}

	@keyframes disco-glow {
		0% {
			background-position: 0% 50%;
			filter: hue-rotate(0deg);
		}
		100% {
			background-position: 100% 50%;
			filter: hue-rotate(360deg);
		}
	}

	.party-zone {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 1;
	}

	.particle {
		position: absolute;
		font-size: var(--size);
		top: 0;
		left: 0;
		animation: shoot-out 1.2s ease-out infinite;
		animation-delay: var(--delay);
		opacity: 0;
		filter: drop-shadow(0 0 10px var(--color));
	}

	@keyframes shoot-out {
		0% {
			transform: translate(-50%, -50%) rotate(0deg) scale(0.2);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		100% {
			transform: translate(
					calc(cos(var(--angle)) * var(--dist)),
					calc(sin(var(--angle)) * var(--dist))
				)
				rotate(720deg) scale(2);
			opacity: 0;
		}
	}

	/* In the normal flow below the content, so it can never sit on top of (or
	   under) the form, whatever the screen height. */
	.hero-footer {
		position: relative;
		z-index: 10;
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0 20px max(16px, env(safe-area-inset-bottom));
	}

	/* Phones: help and crew on one row, the legal links centered below. */
	@media (max-width: 520px) {
		.hero-footer {
			flex-wrap: wrap;
			row-gap: 0.25rem;
		}
		.hero-footer :global(.legal-links) {
			order: 3;
			width: 100%;
			justify-content: center;
		}
	}

	.footer-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 999px;
		border: 1px solid #333;
		background: rgba(0, 0, 0, 0.6);
		color: #b5b5b5;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-decoration: none;
	}

	.footer-link:hover {
		color: #fff;
		border-color: #2dd4bf;
	}

	.login-hint,
	.error-msg {
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.8);
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.login-hint {
		margin: 0 0 1rem;
		border: 1px solid #2dd4bf;
		color: #d1faf5;
	}

	.error-msg {
		border: 1px solid #f87171;
		color: #fecaca;
		text-shadow: 0 0 10px rgba(248, 113, 113, 0.3);
	}

	.continue-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		margin-top: 0.75rem;
		color: #2dd4bf;
		font-size: 0.9rem;
		font-weight: 700;
		text-decoration: none;
	}

	.continue-link:hover {
		color: #fff;
	}

	.privacy-note {
		margin: 0.9rem auto 0;
		max-width: 30rem;
		color: #8a8a8a;
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.privacy-note a {
		color: #b5b5b5;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.privacy-note a:hover {
		color: #fff;
	}

	@media (max-width: 600px) {
		.club-logo {
			width: 84px;
		}
		.input-group {
			flex-direction: column;
			border-radius: 32px;
			padding: 15px;
			gap: 15px;
		}
		button {
			padding: 1.2rem;
			width: 100%;
		}
		input {
			padding: 1rem;
			text-align: center;
		}
		.party-zone {
			display: none;
		}
	}
</style>
