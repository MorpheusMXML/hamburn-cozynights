<script lang="ts">
  export let data; // Daten vom Server
</script>

<div class="admin-container">
  <h1>Verwaltung: Häuser</h1>

  <div class="grid">
    {#each data.houses as house}
      <div class="card" class:occupied={house.occupied}>
        <a href="/admin/house/{house.id}" class="card-link">
          <h2>{house.name}</h2>
          <span class="status">{house.occupied ? '🔴 Voll' : '🟢 Frei'}</span>
        </a>
        <form method="POST" action="?/delete" class="delete-form">
          <input type="hidden" name="id" value={house.id} />
          <button type="submit" class="btn-delete">Löschen</button>
        </form>
      </div>
    {/each}
  </div>

  <div class="add-section">
    <h3>Neues Haus hinzufügen</h3>
    <form method="POST" action="?/create">
      <input type="text" name="name" placeholder="Haus Name" required />
      <button type="submit">Hinzufügen</button>
    </form>
  </div>
</div>

<style>
  /* Globale Styles für Admin (können auch in layout.svelte) */
  .admin-container { padding: 2rem; color: white; background: #111; min-height: 100vh; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #222; border: 1px solid #444; border-radius: 8px; position: relative; padding: 1rem; transition: transform 0.2s; }
  .card:hover { transform: translateY(-2px); border-color: #666; }
  .card-link { text-decoration: none; color: inherit; display: block; margin-bottom: 1rem;}
  .occupied { border-left: 5px solid #ef4444; }
  .status { font-size: 0.8rem; opacity: 0.8; }
  .btn-delete { background: #ef4444; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 0.8rem;}
  input { padding: 10px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; }
  button { padding: 10px 20px; cursor: pointer; background: #22c55e; border: none; color: white; border-radius: 4px; }
</style>