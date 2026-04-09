<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { fade } from 'svelte/transition';

    export let targetDate: string;
    
    let timeLeft = "";
    let interval: any;

    function calculateTimeLeft() {
        const now = new Date().getTime();
        const target = new Date(targetDate).getTime();
        const difference = target - now;

        if (difference <= 0) {
            timeLeft = "ANY MOMENT NOW...";
            return;
        }

        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        let parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0 || days > 0) parts.push(`${hours}h`);
        parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);

        timeLeft = parts.join(" ");
    }

    onMount(() => {
        calculateTimeLeft();
        interval = setInterval(calculateTimeLeft, 1000);
    });

    onDestroy(() => {
        if (interval) clearInterval(interval);
    });
</script>

<div class="countdown-wrapper" in:fade>
    <span class="label">IGNITION IN:</span>
    <span class="timer">{timeLeft}</span>
</div>

<style>
    .countdown-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: rgba(0, 0, 0, 0.8);
        padding: 1rem 2rem;
        border-radius: 12px;
        border: 1px solid #fb923c;
        box-shadow: 0 0 20px rgba(251, 146, 60, 0.2);
        min-width: 200px;
    }
    .label {
        font-size: 0.65rem;
        font-weight: 900;
        color: #666;
        letter-spacing: 2px;
    }
    .timer {
        font-size: 1.5rem;
        font-weight: 900;
        color: #fb923c;
        font-family: monospace;
        text-shadow: 0 0 10px rgba(251, 146, 60, 0.5);
    }
</style>