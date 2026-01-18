<script lang="ts">
  export let name: string;
  // Fallback 'frei', falls status undefined ist
  export let status: string = 'frei';
</script>

<div class="marker-container">
  <div class="pin" class:occupied={status === 'voll'}></div>
  <span class="label">{name}</span>
</div>

<style>
  .marker-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* WICHTIG: Transformieren, damit die Spitze des Pins (oder die Mitte) exakt auf den Koordinaten liegt */
    transform: translate(-50%, -50%);
    pointer-events: none; /* Klicks gehen durch an den Link */
  }

  .pin {
    width: 30px;
    height: 30px;
    background-color: #22c55e; /* Grün (frei) */
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 5px rgba(0,0,0,0.5);
    transition: background-color 0.3s;
  }

  .pin.occupied {
    background-color: #ef4444; /* Rot (voll) */
  }

  .label {
    margin-top: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
    white-space: nowrap;
    font-weight: bold;
    text-shadow: 0 1px 2px black;
  }
</style>