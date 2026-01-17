<script>
  export let data;
</script>

<div class="admin-container">
  <div class="header">
    <a href="/admin">← Zurück zur Hausübersicht</a>
    <h1>Haus: {data.house.name}</h1>
  </div>

  <div class="grid">
    {#each data.rooms as room}
      <div class="card" class:occupied={room.occupied}>
        <a href="/admin/room/{room.id}" class="card-link">
          <h2>Zimmer {room.room_number}</h2>
          <p>{room.name}</p>
          <span class="status">Betten: {room.amount_beds} | {room.occupied ? 'Belegt' : 'Frei'}</span>
        </a>
        <form method="POST" action="?/delete">
          <input type="hidden" name="id" value={room.id} />
          <button type="submit" class="btn-delete">Löschen</button>
        </form>
      </div>
    {/each}
  </div>

  <div class="add-section">
    <h3>Neues Zimmer hinzufügen</h3>
    <form method="POST" action="?/create">
      <input type="number" name="room_number" placeholder="Nr." required style="width: 60px;" />
      <input type="text" name="name" placeholder="Zimmer Name/Beschreibung" required />
      <button type="submit">Hinzufügen</button>
    </form>
  </div>
</div>

<style>
  /* Styles wie oben, plus: */
  .header a { color: #aaa; text-decoration: none; margin-bottom: 1rem; display: inline-block; }
  .header a:hover { color: white; }
</style>