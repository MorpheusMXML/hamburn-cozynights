<script lang="ts">
    import { onMount } from 'svelte';

    interface Point {
        x: number;
        y: number;
        id: number;
    }

    interface Spark {
        x: number;
        y: number;
        vx: number;
        vy: number;
        life: number;
        color: string;
        id: number;
    }

    let points: Point[] = [];
    let sparks: Spark[] = [];
    let counter = 0;
    
    const maxPoints = 20;
    const neonColors = ["#f472b6", "#2dd4bf", "#fb923c", "#a855f7", "#fff"];

    function createSparks(x: number, y: number) {
        const amount = 3;
        const newSparks: Spark[] = [];
        for (let i = 0; i < amount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2;
            newSparks.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                color: neonColors[Math.floor(Math.random() * neonColors.length)],
                id: counter++
            });
        }
        sparks = [...sparks, ...newSparks].slice(-60);
    }

    onMount(() => {
        let frame: number;
        
        const update = () => {
            // Update Sparks
            sparks = sparks
                .map(s => ({
                    ...s,
                    x: s.x + s.vx,
                    y: s.y + s.vy,
                    vy: s.vy + 0.05,
                    life: s.life - 0.03
                }))
                .filter(s => s.life > 0);
            
            frame = requestAnimationFrame(update);
        };

        const handleMouseMove = (e: MouseEvent) => {
            const { clientX: x, clientY: y } = e;
            
            // Update Rainbow Points
            const newPoint = { x, y, id: counter++ };
            points = [newPoint, ...points.slice(0, maxPoints - 1)];
            
            // Trigger Sparks
            createSparks(x, y);
        };

        window.addEventListener('mousemove', handleMouseMove);
        frame = requestAnimationFrame(update);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            cancelAnimationFrame(frame);
        };
    });
</script>

<div class="trail-container">
    <!-- Rainbow Stripe -->
    {#each points as point, i (point.id)}
        <div 
            class="rainbow-segment" 
            style="
                left: {point.x}px; 
                top: {point.y}px; 
                opacity: {(maxPoints - i) / maxPoints}; 
                transform: scale({(maxPoints - i) / maxPoints}) translate(-100%, -50%);
            "
        >
            <div class="stripe red"></div>
            <div class="stripe orange"></div>
            <div class="stripe yellow"></div>
            <div class="stripe green"></div>
            <div class="stripe blue"></div>
            <div class="stripe purple"></div>
        </div>
    {/each}

    <!-- Sparks -->
    {#each sparks as spark (spark.id)}
        <div 
            class="spark" 
            style="
                left: {spark.x}px; 
                top: {spark.y}px; 
                background: {spark.color}; 
                opacity: {spark.life}; 
                transform: scale({spark.life});
                box-shadow: 0 0 8px {spark.color};
            "
        ></div>
    {/each}
</div>

<style>
    .trail-container {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        pointer-events: none;
        z-index: 9999;
        overflow: hidden;
    }

    /* Rainbow Styles */
    .rainbow-segment {
        position: absolute;
        width: 10px;
        height: 16px;
        display: flex;
        flex-direction: column;
        pointer-events: none;
    }
    .stripe { flex: 1; width: 100%; }
    .red { background: #ff0000; }
    .orange { background: #ff9900; }
    .yellow { background: #ffff00; }
    .green { background: #33ff00; }
    .blue { background: #0099ff; }
    .purple { background: #6633ff; }

    /* Spark Styles */
    .spark {
        position: absolute;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        pointer-events: none;
    }
</style>