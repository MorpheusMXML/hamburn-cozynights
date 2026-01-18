<script lang="ts">
  import type { PageData } from './$types';
  
  export let data: PageData;
  $: ({ houses } = data);

  // Hilfsfunktion für Status-Farben
  function getStatusColor(free: number, total: number) {
    if (total === 0) return 'gray';
    if (free === 0) return 'red';      // Voll
    if (free < 3) return 'orange';     // Fast voll
    return 'green';                    // Verfügbar
  }

  function getStatusText(free: number, total: number) {
      if (total === 0) return 'Nicht eingerichtet';
      if (free === 0) return 'Ausgebucht';
      return `${free} Betten frei`;
  }
</script>

<div class="dashboard-container">
  <header class="dashboard-header">
    <h1>Hamburn Übersicht</h1>
    <p class="subtitle">Verwaltung und Belegung in Echtzeit</p>
  </header>

  <div class="grid">
    {#each houses as house}
      <a href="/admin/house/{house.id}" class="card">
        
        <div class="card-header">
          <h2>{house.name}</h2>
          <span class="status-badge {getStatusColor(house.freeBeds, house.totalBeds)}">
             {getStatusText(house.freeBeds, house.totalBeds)}
          </span>
        </div>

        <div class="card-body">
            <div class="stat-row">
                <span class="label">Belegung</span>
                <span class="value">{house.occupiedBeds} / {house.totalBeds}</span>
            </div>

            <div class="progress-track">
                <div 
                    class="progress-fill" 
                    style="width: {house.occupancyRate}%;"
                    class:full={house.occupancyRate === 100}
                ></div>
            </div>
            
            <div class="coordinates">
                📍 {house.x || 0} / {house.y || 0}
            </div>
        </div>

      </a>
    {/each}
  </div>

  <form action="?/logout" method="POST">
    <button type="submit">Abmelden</button>
</form>
</div>

<style>
  :global(body) {
    background-color: #050505; /* Sehr dunkler Hintergrund */
    color: #e5e5e5;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
  }

  .dashboard-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }

  .dashboard-header {
    margin-bottom: 3rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
    color: #fff;
  }

  .subtitle {
    color: #888;
    margin-top: 0.5rem;
    font-size: 1rem;
  }

  /* Grid Layout */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  /* Card Design */
  .card {
    background: #111;
    border: 1px solid #222;
    border-radius: 12px;
    padding: 1.5rem;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  }

  .card:hover {
    transform: translateY(-4px);
    background: #161616;
    border-color: #333;
    box-shadow: 0 10px 15px rgba(0,0,0,0.4);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  /* Status Badges */
  .status-badge {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 99px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge.green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
  .status-badge.orange { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
  .status-badge.red { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
  .status-badge.gray { background: rgba(255, 255, 255, 0.1); color: #aaa; }

  /* Stats & Progress */
  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
    color: #ccc;
  }

  .progress-track {
    height: 6px;
    background: #333;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .progress-fill {
    height: 100%;
    background: #34d399; /* Green default */
    border-radius: 3px;
    transition: width 0.5s ease-out;
  }

  .progress-fill.full {
    background: #ef4444; /* Red when full */
  }

  .coordinates {
    font-size: 0.8rem;
    color: #555;
    font-family: monospace;
  }
</style>