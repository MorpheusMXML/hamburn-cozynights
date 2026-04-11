<script lang="ts">
    import { enhance } from '$app/forms';
    import SlotMachine from '$lib/components/SlotMachine.svelte';
    import type { PageData } from './$types';
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    export let data: PageData;
    $: ({ freeBeds, isBookingActive } = data);

    let isSpinning = false;
    let nameSelected = false;
    let selectedBed: any = null;
    let currentBedLabel = "???";
    let finalName = "";
    let showBookingSuccess = false;
    let slotMachineRef: SlotMachine;

    let bedIterations = 0;
    const maxBedIterations = 20; // Halved for snappier reveal
    let hasBedBeenSelected = false;

    function spinBed() {
        if (isSpinning || freeBeds.length === 0) return;
        isSpinning = true;
        nameSelected = false;
        hasBedBeenSelected = false;
        bedIterations = 0;
        showBookingSuccess = false;
        runBedSpin();
    }

    function runBedSpin() {
        const randomIndex = Math.floor(Math.random() * freeBeds.length);
        selectedBed = freeBeds[randomIndex];
        currentBedLabel = selectedBed.label;
        bedIterations++;

        if (bedIterations < maxBedIterations) {
            setTimeout(runBedSpin, 40 + bedIterations * 4);
        } else {
            // Bed selected, show name section and roll for name
            hasBedBeenSelected = true;
            setTimeout(() => {
                slotMachineRef.spin();
            }, 400); // Reduced anticipation delay
        }
    }

    function handleNameSelect(event: CustomEvent<string>) {
        finalName = event.detail;
        isSpinning = false;
        nameSelected = true;
    }

    function confirmBooking() {
        const form = document.getElementById('random-form') as HTMLFormElement;
        if (form) form.requestSubmit();
    }

    function respinName() {
        if (isSpinning) return;
        nameSelected = false;
        finalName = "";
        slotMachineRef.spin();
    }
</script>

<div class="page-container">
    <div class="nav">
        <a href="/map" class="back-link">← Return to Map</a>
    </div>

    <div class="randomizer-box">
        <h1 class="laser-text pink">Luck of the Playa</h1>
        <p class="subtitle">Surrender to the dust. We'll find you a home.</p>

        {#if freeBeds.length === 0}
            <div class="empty-state">
                <span class="icon">🏜️</span>
                <p>The playa is full. No free beds left to scavenge.</p>
            </div>
        {:else if !isBookingActive}
            <div class="empty-state">
                <span class="icon">🔒</span>
                <p>The gates are locked. Staging Mode in progress.</p>
            </div>
        {:else}
            <div class="machine-container">
                <div class="bed-display" class:spinning={isSpinning && !hasBedBeenSelected}>
                    <div class="bed-label">
                        <span class="prefix">BED</span>
                        <span class="value">{currentBedLabel}</span>
                    </div>
                    {#if selectedBed && hasBedBeenSelected}
                        <div class="bed-info" in:fade>
                            {selectedBed.expand?.room?.name} • {selectedBed.expand?.room?.expand?.house?.name}
                        </div>
                    {/if}
                    <div class="scan-line"></div>
                </div>

                {#if hasBedBeenSelected}
                    <div class="name-section" in:fade={{ duration: 600 }}>
                        <SlotMachine bind:this={slotMachineRef} autoSpin={false} showButton={false} on:select={handleNameSelect} />
                    </div>
                {/if}

                {#if nameSelected}
                    <div class="selection-actions" in:fade>
                        <button class="confirm-btn" on:click={confirmBooking}>Accept Fate & Book 🌵</button>
                        <div class="respin-row">
                            <button class="respin-btn secondary" on:click={respinName}>New Name 🎲</button>
                            <button class="respin-btn secondary" on:click={spinBed}>Full Respin 🔥</button>
                        </div>
                    </div>
                {:else}
                    <button 
                        class="main-spin-btn" 
                        on:click={spinBed} 
                        disabled={isSpinning}
                    >
                        {isSpinning ? 'CALCULATING FATE...' : 'ROLL THE DICE 🎲'}
                    </button>
                {/if}

                <form 
                    id="random-form" 
                    method="POST" 
                    action="?/bookRandom" 
                    use:enhance={() => {
                        return async ({ result }) => {
                            if (result.type === 'success') {
                                showBookingSuccess = true;
                            }
                        };
                    }}
                >
                    <input type="hidden" name="bedId" value={selectedBed?.id} />
                    <input type="hidden" name="guestName" value={finalName} />
                </form>
            </div>
        {/if}
    </div>

    {#if showBookingSuccess}
        <div class="success-overlay" in:fade>
            <div class="success-card" in:scale>
                <div class="sparkles">✨✨✨</div>
                <h2>Destiny Fulfilled!</h2>
                <p>You are now known as <strong>{finalName}</strong>.</p>
                <p>Your new home is bed <strong>{selectedBed.label}</strong> in <strong>{selectedBed.expand?.room?.name}</strong>.</p>
                <div class="actions">
                    <a href="/room/{selectedBed.room}" class="btn-goto">Visit My Room</a>
                    <a href="/map" class="btn-map">Back to Map</a>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .page-container {
        min-height: 100vh;
        background: #050505;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2rem;
        font-family: 'Inter', sans-serif;
    }

    .nav { width: 100%; max-width: 800px; margin-bottom: 2rem; }
    .back-link { color: #2dd4bf; text-decoration: none; font-weight: 900; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; }

    .randomizer-box {
        background: #0a0a0a;
        border: 1px solid #222;
        border-radius: 32px;
        padding: 4rem;
        width: 100%;
        max-width: 600px;
        text-align: center;
        box-shadow: 0 40px 100px rgba(0,0,0,0.8);
        border-top: 4px solid #f472b6;
    }

    .laser-text { font-size: 2.5rem; font-weight: 900; margin: 0; letter-spacing: -1px; text-transform: uppercase; }
    .laser-text.pink { color: #f472b6; text-shadow: 0 0 20px rgba(244, 114, 182, 0.4); }
    
    .subtitle { color: #666; margin: 0.5rem 0 3rem 0; font-weight: 500; }

    .machine-container { display: flex; flex-direction: column; gap: 2rem; }

    .bed-display {
        background: #000;
        border: 2px solid #333;
        border-radius: 20px;
        padding: 2rem;
        position: relative;
        overflow: hidden;
        transition: all 0.3s;
    }
    .bed-display.spinning {
        border-color: #2dd4bf;
        box-shadow: 0 0 40px rgba(45, 212, 191, 0.2);
    }

    .bed-label { display: flex; flex-direction: column; align-items: center; }
    .bed-label .prefix { font-size: 0.7rem; font-weight: 900; color: #444; letter-spacing: 4px; }
    .bed-label .value { font-size: 4.5rem; font-weight: 900; font-family: 'JetBrains Mono', monospace; }

    .bed-info { margin-top: 1rem; color: #2dd4bf; font-weight: 900; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; }

    .scan-line {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 2px;
        background: rgba(45, 212, 191, 0.5);
        box-shadow: 0 0 10px #2dd4bf;
        animation: scan 2s linear infinite;
        opacity: 0;
    }
    .spinning .scan-line { opacity: 1; }

    @keyframes scan {
        0% { top: 0; }
        100% { top: 100%; }
    }

    .name-section {
        margin-top: 1rem;
    }

    .main-spin-btn {
        background: linear-gradient(135deg, #f472b6, #a855f7);
        border: none;
        color: #fff;
        padding: 1.5rem;
        border-radius: 16px;
        font-size: 1.2rem;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 10px 20px rgba(244, 114, 182, 0.3);
    }
    .main-spin-btn:hover:not(:disabled) {
        transform: translateY(-4px);
        box-shadow: 0 15px 30px rgba(244, 114, 182, 0.5);
    }
    .main-spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .selection-actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .confirm-btn {
        background: #2dd4bf;
        color: #000;
        border: none;
        padding: 1.2rem;
        border-radius: 16px;
        font-size: 1.1rem;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .confirm-btn:hover {
        transform: scale(1.02);
        box-shadow: 0 0 30px rgba(45, 212, 191, 0.4);
    }

    .respin-row {
        display: flex;
        gap: 1rem;
    }

    .respin-btn {
        flex: 1;
        background: #111;
        border: 2px solid #333;
        color: #888;
        padding: 1rem;
        border-radius: 12px;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        font-size: 0.8rem;
    }
    .respin-btn:hover {
        border-color: #666;
        color: #fff;
    }

    /* Success Overlay */
    .success-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(10px);
    }
    .success-card {
        background: #0a0a0a;
        border: 2px solid #2dd4bf;
        border-radius: 40px;
        padding: 4rem;
        text-align: center;
        max-width: 500px;
        box-shadow: 0 0 100px rgba(45, 212, 191, 0.3);
    }
    .sparkles { font-size: 3rem; margin-bottom: 1rem; }
    .success-card h2 { font-size: 2.5rem; font-weight: 900; color: #2dd4bf; margin-bottom: 1.5rem; }
    .success-card p { color: #888; margin-bottom: 1rem; font-size: 1.1rem; }
    .success-card strong { color: #fff; }

    .actions { display: flex; gap: 1rem; margin-top: 3rem; }
    .actions a { flex: 1; padding: 1rem; border-radius: 12px; font-weight: 900; text-decoration: none; transition: all 0.2s; }
    .btn-goto { background: #2dd4bf; color: #000; }
    .btn-map { background: transparent; border: 1px solid #333; color: #666; }
    .btn-goto:hover { transform: scale(1.05); }

    .empty-state { padding: 4rem 0; color: #444; }
    .empty-state .icon { font-size: 4rem; display: block; margin-bottom: 1rem; }
</style>