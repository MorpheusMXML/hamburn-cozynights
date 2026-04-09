<script lang="ts">
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';

    interface Fairy {
        id: number;
        y: number;
        size: number;
        speed: number;
        color: string;
        opacity: number;
        delay: number;
        type: 'pixel' | 'glow';
    }

    let fairies: Fairy[] = [];
    const colors = ['#2dd4bf', '#f472b6', '#fb923c', '#4ade80'];

    function createFairy(id: number): Fairy {
        return {
            id,
            y: Math.random() * 90 + 5,
            size: 15 + Math.random() * 15,
            speed: 20 + Math.random() * 30,
            color: colors[Math.floor(Math.random() * colors.length)],
            opacity: 0.2 + Math.random() * 0.4,
            delay: Math.random() * 20,
            type: Math.random() > 0.3 ? 'pixel' : 'glow'
        };
    }

    onMount(() => {
        for (let i = 0; i < 12; i++) {
            fairies = [...fairies, createFairy(i)];
        }
    });
</script>

<div class="fairy-container">
    <div class="background-grid"></div>
    {#each fairies as fairy (fairy.id)}
        <div 
            class="fairy {fairy.type}"
            style="
                --y: {fairy.y}%;
                --size: {fairy.size}px;
                --color: {fairy.color};
                --speed: {fairy.speed}s;
                --opacity: {fairy.opacity};
                --delay: -{fairy.delay}s;
            "
        >
            {#if fairy.type === 'pixel'}
                <svg viewBox="0 0 8 8" width="100%" height="100%">
                    <!-- Pixel Art Sprite -->
                    <rect x="3" y="3" width="2" height="2" fill="white" /> <!-- Core -->
                    <rect x="1" y="2" width="2" height="2" fill="currentColor" opacity="0.8" /> <!-- Wing L -->
                    <rect x="5" y="2" width="2" height="2" fill="currentColor" opacity="0.8" /> <!-- Wing R -->
                    <rect x="2" y="4" width="1" height="1" fill="currentColor" opacity="0.6" /> <!-- Tail L -->
                    <rect x="5" y="4" width="1" height="1" fill="currentColor" opacity="0.6" /> <!-- Tail R -->
                </svg>
            {:else}
                <div class="glow-core"></div>
            {/if}
        </div>
    {/each}
</div>

<style>
    .fairy-container {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none;
        z-index: 0;
        overflow: hidden;
        background: #050505;
    }

    .background-grid {
        position: absolute;
        width: 200%; height: 200%;
        top: -50%; left: -50%;
        background-image: 
            linear-gradient(rgba(45, 212, 191, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(45, 212, 191, 0.03) 1px, transparent 1px);
        background-size: 50px 50px;
        transform: perspective(500px) rotateX(60deg);
        animation: grid-move 20s linear infinite;
    }

    @keyframes grid-move {
        from { transform: perspective(500px) rotateX(60deg) translateY(0); }
        to { transform: perspective(500px) rotateX(60deg) translateY(50px); }
    }

    .fairy {
        position: absolute;
        top: var(--y);
        width: var(--size);
        height: var(--size);
        color: var(--color);
        opacity: var(--opacity);
        animation: float-horizontal var(--speed) linear infinite var(--delay);
        filter: drop-shadow(0 0 5px var(--color));
    }

    .glow-core {
        width: 40%; height: 40%;
        background: white;
        border-radius: 50%;
        box-shadow: 0 0 15px 5px var(--color);
        position: absolute;
        top: 30%; left: 30%;
        animation: pulse 1s ease-in-out infinite alternate;
    }

    @keyframes float-horizontal {
        0% { left: -10%; transform: translateY(0); }
        25% { transform: translateY(-30px); }
        50% { transform: translateY(0); }
        75% { transform: translateY(30px); }
        100% { left: 110%; transform: translateY(0); }
    }

    @keyframes pulse {
        from { transform: scale(0.8); opacity: 0.5; }
        to { transform: scale(1.2); opacity: 1; }
    }
</style>