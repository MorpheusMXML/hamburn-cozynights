<script lang="ts">
    import { onMount } from 'svelte';

    interface Point {
        x: number;
        y: number;
        id: number;
    }

    let points: Point[] = [];
    let counter = 0;
    const maxPoints = 25;

    onMount(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const newPoint = { x: e.clientX, y: e.clientY, id: counter++ };
            points = [newPoint, ...points.slice(0, maxPoints - 1)];
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    });
</script>

<div class="trail-container">
    {#each points as point, i (point.id)}
        <div 
            class="rainbow-segment" 
            style="left: {point.x}px; top: {point.y}px; opacity: {(maxPoints - i) / maxPoints}; transform: scale({(maxPoints - i) / maxPoints})"
        >
            <div class="stripe red"></div>
            <div class="stripe orange"></div>
            <div class="stripe yellow"></div>
            <div class="stripe green"></div>
            <div class="stripe blue"></div>
            <div class="stripe purple"></div>
        </div>
        {#if i % 8 === 0}
            <div 
                class="cloud" 
                style="left: {point.x - 20}px; top: {point.y + 10}px; opacity: {(maxPoints - i) / maxPoints}"
            >
                ☁️
            </div>
        {/if}
    {/each}

    {#if points.length > 0}
        <div class="nyan-head" style="left: {points[0].x}px; top: {points[0].y}px">
            <div class="cat-pixel">🐈</div>
        </div>
    {/if}
</div>

<style>
    .trail-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 9999;
        overflow: hidden;
    }

    .rainbow-segment {
        position: absolute;
        width: 12px;
        height: 18px;
        display: flex;
        flex-direction: column;
        pointer-events: none;
        transform: translate(-100%, -50%);
    }

    .stripe {
        flex: 1;
        width: 100%;
    }

    .red { background: #ff0000; }
    .orange { background: #ff9900; }
    .yellow { background: #ffff00; }
    .green { background: #33ff00; }
    .blue { background: #0099ff; }
    .purple { background: #6633ff; }

    .cloud {
        position: absolute;
        font-size: 1.5rem;
        pointer-events: none;
        filter: drop-shadow(0 0 5px rgba(255,255,255,0.5));
    }

    .nyan-head {
        position: absolute;
        font-size: 2rem;
        transform: translate(-20%, -50%);
        pointer-events: none;
        filter: drop-shadow(0 0 10px rgba(255,255,255,0.8));
        animation: bob 0.2s infinite alternate;
    }

    @keyframes bob {
        from { transform: translate(-20%, -50%) translateY(-2px); }
        to { transform: translate(-20%, -50%) translateY(2px); }
    }
</style>