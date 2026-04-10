<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    const dispatch = createEventDispatcher();

    export let autoSpin = false;
    export let delay = 0;

    const burnerNames = [
        "Dusty Nomad", "Neon Lizard", "Spark Plug", "Glow Worm", 
        "Cactus Jack", "Desert Rose", "Fire Starter", "Solar Flare",
        "Prism Pilot", "Laser Lynx", "Vortex Voyager", "Cosmic Coyote",
        "Quartz Queen", "Mirage Maker", "Zenith Zephyr", "Oasis Owl"
    ];

    let isSpinning = false;
    let currentName = "???";
    let iterations = 0;
    const maxIterations = 25;
    let showConfetti = false;

    export function spin() {
        if (isSpinning) return;
        isSpinning = true;
        iterations = 0;
        showConfetti = false;
        runSpin();
    }

    function runSpin() {
        currentName = burnerNames[Math.floor(Math.random() * burnerNames.length)];
        iterations++;

        if (iterations < maxIterations) {
            setTimeout(runSpin, 40 + iterations * 4); // Decelerate
        } else {
            isSpinning = false;
            const finalSuffix = Math.floor(100 + Math.random() * 900);
            const finalResult = `${currentName} #${finalSuffix}`;
            currentName = finalResult;
            showConfetti = true;
            dispatch('select', finalResult);
            
            setTimeout(() => {
                showConfetti = false;
            }, 3000);
        }
    }

    onMount(() => {
        if (autoSpin) {
            setTimeout(spin, delay);
        }
    });
</script>

<div class="slot-machine" class:has-confetti={showConfetti}>
    <div class="display" class:spinning={isSpinning} class:finished={showConfetti}>
        <div class="name-box">
            {currentName}
        </div>
        <div class="laser-line"></div>
        {#if showConfetti}
            <div class="confetti-container">
                {#each Array(20) as _, i}
                    <div class="confetti" style="--delay: {Math.random() * 2}s; --left: {Math.random() * 100}%; --color: {['#f472b6', '#2dd4bf', '#fb923c', '#a855f7'][Math.floor(Math.random() * 4)]}"></div>
                {/each}
            </div>
        {/if}
    </div>
    {#if !autoSpin}
        <button type="button" class="spin-btn" on:click={spin} disabled={isSpinning}>
            {isSpinning ? 'SHUFFLING...' : 'GET RANDOM NAME 🎲'}
        </button>
    {/if}
</div>

<style>
    .slot-machine {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        margin-bottom: 1.5rem;
        position: relative;
    }

    .display {
        background: #050505;
        border: 2px solid #333;
        border-radius: 12px;
        height: 70px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        transition: all 0.3s;
    }
    .display.spinning {
        border-color: #f472b6;
        box-shadow: 0 0 30px rgba(244, 114, 182, 0.4);
    }
    .display.finished {
        border-color: #2dd4bf;
        box-shadow: 0 0 40px rgba(45, 212, 191, 0.5);
        transform: scale(1.05);
    }

    .name-box {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 900;
        font-size: 1.4rem;
        color: #fff;
        z-index: 2;
        text-shadow: 0 0 10px rgba(255,255,255,0.5);
    }
    .spinning .name-box {
        animation: blur-text 0.08s infinite;
    }

    .laser-line {
        position: absolute;
        top: 50%;
        left: 0;
        width: 100%;
        height: 2px;
        background: #f472b6;
        box-shadow: 0 0 15px #f472b6;
        opacity: 0.5;
        z-index: 1;
    }

    .spin-btn {
        background: #111;
        border: 2px solid #333;
        color: #888;
        padding: 0.8rem;
        border-radius: 10px;
        font-size: 0.8rem;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        text-transform: uppercase;
    }
    .spin-btn:hover:not(:disabled) {
        background: #1a1a1a;
        color: #f472b6;
        border-color: #f472b6;
        box-shadow: 0 0 15px rgba(244, 114, 182, 0.3);
    }
    .spin-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Confetti */
    .confetti-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    }
    .confetti {
        position: absolute;
        top: -10px;
        left: var(--left);
        width: 8px;
        height: 8px;
        background: var(--color);
        border-radius: 2px;
        animation: fall 2s linear forwards;
        animation-delay: var(--delay);
        opacity: 0;
    }

    @keyframes fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100px) rotate(720deg); opacity: 0; }
    }

    @keyframes blur-text {
        0% { filter: blur(0); transform: translateY(0) scale(1); }
        50% { filter: blur(3px); transform: translateY(-3px) scale(1.1); }
        100% { filter: blur(0); transform: translateY(3px) scale(1); }
    }
</style>