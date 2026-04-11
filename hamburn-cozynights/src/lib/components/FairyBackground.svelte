<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	type SpriteType = 'pixel' | 'glow' | 'unicorn' | 'wizard' | 'wine' | 'mermaid';

	interface Creature {
		id: number;
		y: number;
		size: number;
		speed: number;
		color: string;
		opacity: number;
		delay: number;
		type: SpriteType;
	}

	let creatures: Creature[] = [];
	const colors = ['#2dd4bf', '#f472b6', '#fb923c', '#4ade80', '#e879f9'];

	function createCreature(id: number): Creature {
		const types: SpriteType[] = ['pixel', 'glow', 'unicorn', 'wizard', 'wine', 'mermaid'];
		return {
			id,
			y: Math.random() * 90 + 5,
			size: 20 + Math.random() * 20,
			speed: 15 + Math.random() * 35,
			color: colors[Math.floor(Math.random() * colors.length)],
			opacity: 0.15 + Math.random() * 0.4,
			delay: Math.random() * 25,
			type: types[Math.floor(Math.random() * types.length)]
		};
	}

	onMount(() => {
		for (let i = 0; i < 18; i++) {
			creatures = [...creatures, createCreature(i)];
		}
	});
</script>

<div class="fairy-container">
	<div class="background-grid"></div>
	<div class="laser-scan"></div>

	{#each creatures as c (c.id)}
		<div
			class="creature {c.type}"
			style="
                --y: {c.y}%;
                --size: {c.size}px;
                --color: {c.color};
                --speed: {c.speed}s;
                --opacity: {c.opacity};
                --delay: -{c.delay}s;
            "
		>
			{#if c.type === 'pixel'}
				<svg viewBox="0 0 8 8" width="100%" height="100%">
					<rect x="3" y="3" width="2" height="2" fill="white" />
					<rect x="1" y="2" width="2" height="2" fill="currentColor" opacity="0.8" />
					<rect x="5" y="2" width="2" height="2" fill="currentColor" opacity="0.8" />
					<rect x="2" y="4" width="1" height="1" fill="currentColor" opacity="0.6" />
					<rect x="5" y="4" width="1" height="1" fill="currentColor" opacity="0.6" />
				</svg>
			{:else if c.type === 'unicorn'}
				<span class="emoji-sprite">🦄</span>
			{:else if c.type === 'wizard'}
				<span class="emoji-sprite">🧙‍♂️</span>
			{:else if c.type === 'wine'}
				<span class="emoji-sprite">🍾</span>
			{:else if c.type === 'mermaid'}
				<span class="emoji-sprite">🧜‍♀️</span>
			{:else}
				<div class="glow-core"></div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.fairy-container {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 0;
		overflow: hidden;
		background: #050505;
	}

	.background-grid {
		position: absolute;
		width: 200%;
		height: 200%;
		top: -50%;
		left: -50%;
		background-image:
			linear-gradient(rgba(45, 212, 191, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(45, 212, 191, 0.03) 1px, transparent 1px);
		background-size: 60px 60px;
		transform: perspective(500px) rotateX(60deg);
		animation: grid-move 20s linear infinite;
	}

	.laser-scan {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 2px;
		background: linear-gradient(90deg, transparent, #2dd4bf, transparent);
		opacity: 0.1;
		animation: scan 8s ease-in-out infinite;
	}

	@keyframes scan {
		0%,
		100% {
			top: 0;
		}
		50% {
			top: 100%;
		}
	}

	@keyframes grid-move {
		from {
			transform: perspective(500px) rotateX(60deg) translateY(0);
		}
		to {
			transform: perspective(500px) rotateX(60deg) translateY(60px);
		}
	}

	.creature {
		position: absolute;
		top: var(--y);
		width: var(--size);
		height: var(--size);
		color: var(--color);
		opacity: var(--opacity);
		animation: float-horizontal var(--speed) linear infinite var(--delay);
		filter: drop-shadow(0 0 8px var(--color));
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.emoji-sprite {
		font-size: var(--size);
		filter: saturate(1.5) brightness(1.2);
		animation: sway 3s ease-in-out infinite alternate;
	}

	.glow-core {
		width: 40%;
		height: 40%;
		background: white;
		border-radius: 50%;
		box-shadow: 0 0 15px 5px var(--color);
		animation: pulse 1s ease-in-out infinite alternate;
	}

	@keyframes float-horizontal {
		0% {
			left: -15%;
			transform: rotate(0deg);
		}
		100% {
			left: 115%;
			transform: rotate(360deg);
		}
	}

	@keyframes sway {
		from {
			transform: translateY(-10px) rotate(-10deg);
		}
		to {
			transform: translateY(10px) rotate(10deg);
		}
	}

	@keyframes pulse {
		from {
			transform: scale(0.8);
			opacity: 0.5;
		}
		to {
			transform: scale(1.2);
			opacity: 1;
		}
	}
</style>
