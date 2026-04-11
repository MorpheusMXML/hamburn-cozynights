<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    const dispatch = createEventDispatcher();

    export let autoSpin = false;
    export let delay = 0;
    export let showButton = true;

    const burnerNames = [
        "Dusty Nomad", "Neon Lizard", "Spark Plug", "Glow Worm", 
        "Cactus Jack", "Desert Rose", "Fire Starter", "Solar Flare",
        "Prism Pilot", "Laser Lynx", "Vortex Voyager", "Cosmic Coyote",
        "Quartz Queen", "Mirage Maker", "Zenith Zephyr", "Oasis Owl",
        "Stardust Scout", "Thunder Thistle", "Midnight Muse", "Silver Streak",
        "Neon Nebula", "Plasma Puma", "Quantum Quokka", "Cyber Cipher"
    ];

    let isSpinning = false;
    let currentName = "???";
    let iterations = 0;
    const maxIterations = 20; // Halved for ~2s duration
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
            // Snappier deceleration for ~2 seconds total
            const progress = iterations / maxIterations;
            const nextDelay = 20 + Math.pow(progress, 2) * 250; 
            setTimeout(runSpin, nextDelay);
        } else {
            isSpinning = false;
            const finalSuffix = Math.floor(100 + Math.random() * 900);
            const finalResult = `${currentName} #${finalSuffix}`;
            currentName = finalResult;
            showConfetti = true;
            dispatch('select', finalResult);
            
            setTimeout(() => {
                showConfetti = false;
            }, 4000);
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
                {#each Array(35) as _, i}
                    <div class="confetti" style="--delay: {Math.random() * 2}s; --left: {Math.random() * 100}%; --color: {['#f472b6', '#2dd4bf', '#fb923c', '#a855f7'][Math.floor(Math.random() * 4)]}"></div>
                {/each}
            </div>
        {/if}
    </div>
    {#if !autoSpin && showButton}
        <button type="button" class="spin-btn" on:click={spin} disabled={isSpinning}>
            {isSpinning ? 'SHUFFLING...' : 'GET RANDOM NAME 🎲'}
        </button>
    {/if}
</div>

<style>
    .slot-machine {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        width: 100%;
        margin-bottom: 2rem;
        position: relative;
    }

    .display {
        background: #000;
        border: 2px solid #222;
        border-radius: 16px;
        height: 90px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .display.spinning {
        border-color: #f472b6;
        box-shadow: 0 0 40px rgba(244, 114, 182, 0.3), inset 0 0 20px rgba(244, 114, 182, 0.1);
    }
    .display.finished {
        border-color: #2dd4bf;
        box-shadow: 0 0 60px rgba(45, 212, 191, 0.4), inset 0 0 30px rgba(45, 212, 191, 0.1);
        transform: scale(1.02);
    }

    .name-box {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 900;
        font-size: 1.8rem;
        color: #fff;
        z-index: 2;
        text-shadow: 0 0 15px rgba(255,255,255,0.4);
        letter-spacing: -0.5px;
    }
    .spinning .name-box {
        animation: blur-text 0.12s infinite;
    }

    .laser-line {
        position: absolute;
        top: 50%;
        left: 0;
        width: 100%;
        height: 1px;
        background: rgba(244, 114, 182, 0.5);
        box-shadow: 0 0 20px #f472b6;
        z-index: 1;
    }
    .finished .laser-line {
        background: rgba(45, 212, 191, 0.5);
        box-shadow: 0 0 20px #2dd4bf;
    }

    .spin-btn {
        background: #0a0a0a;
        border: 2px solid #222;
        color: #555;
        padding: 1rem;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        text-transform: uppercase;
    }
    .spin-btn:hover:not(:disabled) {
        background: #111;
        color: #f472b6;
        border-color: #f472b6;
        box-shadow: 0 0 20px rgba(244, 114, 182, 0.2);
    }
    .spin-btn:disabled {
        opacity: 0.4;
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
        width: 6px;
        height: 6px;
        background: var(--color);
        border-radius: 1px;
        animation: fall 3s linear forwards;
        animation-delay: var(--delay);
        opacity: 0;
    }

    @keyframes fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(120px) rotate(720deg); opacity: 0; }
    }

    @keyframes blur-text {
        0% { filter: blur(0); transform: translateY(0); opacity: 1; }
        50% { filter: blur(6px); transform: translateY(-4px); opacity: 0.7; }
        100% { filter: blur(0); transform: translateY(4px); opacity: 1; }
    }
</style>