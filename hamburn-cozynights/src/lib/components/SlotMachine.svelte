<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    const burnerNames = [
        "Dusty Nomad", "Neon Lizard", "Spark Plug", "Glow Worm", 
        "Cactus Jack", "Desert Rose", "Fire Starter", "Solar Flare",
        "Prism Pilot", "Laser Lynx", "Vortex Voyager", "Cosmic Coyote",
        "Quartz Queen", "Mirage Maker", "Zenith Zephyr", "Oasis Owl"
    ];

    let isSpinning = false;
    let currentName = "???";
    let iterations = 0;
    const maxIterations = 20;

    function spin() {
        if (isSpinning) return;
        isSpinning = true;
        iterations = 0;
        runSpin();
    }

    function runSpin() {
        currentName = burnerNames[Math.floor(Math.random() * burnerNames.length)];
        iterations++;

        if (iterations < maxIterations) {
            setTimeout(runSpin, 50 + iterations * 5); // Decelerate
        } else {
            isSpinning = false;
            const finalSuffix = Math.floor(100 + Math.random() * 900);
            const finalResult = `${currentName} #${finalSuffix}`;
            currentName = finalResult;
            dispatch('select', finalResult);
        }
    }
</script>

<div class="slot-machine">
    <div class="display" class:spinning={isSpinning}>
        <div class="name-box">
            {currentName}
        </div>
        <div class="laser-line"></div>
    </div>
    <button type="button" class="spin-btn" on:click={spin} disabled={isSpinning}>
        {isSpinning ? 'SHUFFLING...' : 'GET RANDOM NAME 🎲'}
    </button>
</div>

<style>
    .slot-machine {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        margin-bottom: 1.5rem;
    }

    .display {
        background: #050505;
        border: 2px solid #333;
        border-radius: 12px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        transition: all 0.3s;
    }
    .display.spinning {
        border-color: #f472b6;
        box-shadow: 0 0 20px rgba(244, 114, 182, 0.2);
    }

    .name-box {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 900;
        font-size: 1.2rem;
        color: #fff;
        z-index: 2;
    }
    .spinning .name-box {
        animation: blur-text 0.1s infinite;
    }

    .laser-line {
        position: absolute;
        top: 50%;
        left: 0;
        width: 100%;
        height: 1px;
        background: #f472b6;
        box-shadow: 0 0 10px #f472b6;
        opacity: 0.3;
    }

    .spin-btn {
        background: #1a1a1a;
        border: 1px solid #333;
        color: #888;
        padding: 0.6rem;
        border-radius: 8px;
        font-size: 0.7rem;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 1px;
    }
    .spin-btn:hover:not(:disabled) {
        background: #222;
        color: #f472b6;
        border-color: #f472b6;
    }
    .spin-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    @keyframes blur-text {
        0% { filter: blur(0); transform: translateY(0); }
        50% { filter: blur(2px); transform: translateY(-2px); }
        100% { filter: blur(0); transform: translateY(2px); }
    }
</style>