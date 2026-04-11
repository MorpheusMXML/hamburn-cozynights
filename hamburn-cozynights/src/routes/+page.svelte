<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	export let form: { error?: string };

	let titleLetters: { char: string; color: string; delay: number; offset: number }[] = [];
	const fullTitle = 'HAMBURN COZYNIGHTS';
	const neonColors = ['#f472b6', '#2dd4bf', '#fb923c', '#a855f7', '#fff'];
	let isHovering = false;

	onMount(() => {
		titleLetters = fullTitle.split('').map((char, i) => ({
			char,
			color: neonColors[Math.floor(Math.random() * neonColors.length)],
			delay: Math.random() * 800,
			offset: (Math.random() - 0.5) * 40
		}));
	});
</script>

<section class="hero">
	<video class="background-video" autoplay muted loop playsinline poster="/background.jpg">
		<source src="/background.mp4" type="video/mp4" />
	</video>

	<div class="scan-overlay"></div>

	<div class="content-wrapper">
		<div class="logo-area" in:fade={{ delay: 1500 }}>
			<img src="/logo.png" alt="Logo" class="club-logo" />
		</div>

		<div class="title-container">
			<div class="laser-scanner"></div>
			<h1 class="burning-laser-title">
				{#each titleLetters as { char, color, delay, offset }, i}
					<span class="letter" style="--color: {color}; --delay: {delay}ms; --offset: {offset}px">
						{char === ' ' ? '\u00A0' : char}
					</span>
				{/each}
			</h1>
		</div>

		<div class="login-module" in:fly={{ y: 30, delay: 2000, duration: 1000 }}>
			<form method="POST" action="?/login" use:enhance class="input-group">
				<input
					type="text"
					name="bookingCode"
					placeholder="ACCESS CODE"
					required
					autocomplete="off"
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
						on:mouseenter={() => (isHovering = true)}
						on:mouseleave={() => (isHovering = false)}
					>
						ENTER THE DUST 🌵
					</button>
				</div>
			</form>

			{#if form?.error}
				<p class="error-msg" in:fade>{form.error}</p>
			{/if}
		</div>
	</div>

	<button class="admin-btn" on:click={() => goto('/admin/login')}>
		<span class="icon">🔒</span>
	</button>
</section>

<style>
	.hero {
		position: relative;
		min-height: 100vh;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
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
		display: flex;
		flex-direction: column;
		align-items: center;
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

	.title-container {
		position: relative;
		margin-bottom: 5rem;
		padding: 2rem;
	}

	.burning-laser-title {
		font-size: 5rem;
		font-weight: 950;
		color: #fff;
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: -4px;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
	}

	.letter {
		display: inline-block;
		opacity: 0;
		transform: translateY(var(--offset)) scale(1.5);
		filter: blur(10px);
		animation: letter-ignite 0.6s cubic-bezier(0.215, 0.61, 0.355, 1) forwards;
		animation-delay: var(--delay);
		color: var(--color);
		text-shadow: 0 0 20px var(--color);
	}

	@keyframes letter-ignite {
		0% {
			opacity: 0;
			transform: translateY(var(--offset)) scale(2);
			filter: blur(20px);
		}
		70% {
			opacity: 1;
			transform: translateY(-5px) scale(0.9);
			filter: blur(0);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
			filter: blur(0);
			color: #fff;
			text-shadow:
				0 0 10px rgba(255, 255, 255, 0.8),
				0 0 30px var(--color);
		}
	}

	.laser-scanner {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-top: 2px solid #2dd4bf;
		border-bottom: 2px solid #f472b6;
		background: rgba(45, 212, 191, 0.05);
		opacity: 0;
		animation: scan-pulse 2s ease-in-out forwards;
		animation-delay: 1.2s;
		z-index: -1;
		transform: scaleX(0);
	}

	@keyframes scan-pulse {
		0% {
			transform: scaleX(0);
			opacity: 0;
		}
		20% {
			transform: scaleX(1);
			opacity: 1;
		}
		80% {
			transform: scaleX(1);
			opacity: 0.5;
		}
		100% {
			transform: scaleX(1.1);
			opacity: 0;
		}
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

	input {
		flex: 1;
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
		color: #222;
	}
	input:focus {
		outline: none;
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

	.admin-btn {
		position: absolute;
		bottom: 30px;
		right: 30px;
		width: 45px;
		height: 45px;
		background: rgba(0, 0, 0, 0.6);
		color: #333;
		border: 1px solid #222;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.admin-btn:hover {
		color: #fff;
		border-color: #444;
	}

	.error-msg {
		color: #f87171;
		font-weight: 900;
		margin-top: 2rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 2px;
		text-shadow: 0 0 10px rgba(248, 113, 113, 0.3);
	}

	@media (max-width: 600px) {
		.burning-laser-title {
			font-size: 2.8rem;
			letter-spacing: -2px;
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
