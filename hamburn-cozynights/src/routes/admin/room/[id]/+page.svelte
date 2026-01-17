<script>
  export let data;
</script>

<div class="admin-container">
  <div class="header">
    <a href="/admin/house/{data.room.link}">← Zurück zum Zimmer</a>
    <h1>Zimmer {data.room.room_number}: Betten</h1>
  </div>

  <table class="bed-table">
    <thead>
      <tr>
        <th>Label</th>
        <th>Status</th>
        <th>Gast Name</th>
        <th>Aktionen</th>
      </tr>
    </thead>
    <tbody>
      {#each data.beds as bed}
        <tr class:occupied-row={bed.occupied}>
          <td><strong>{bed.label}</strong></td>
          <td>{bed.occupied ? '🔴 Belegt' : '🟢 Frei'}</td>
          <td>{bed.guest_name || '-'}</td>
          <td>
             <form method="POST" action="?/delete" style="display:inline;">
                <input type="hidden" name="id" value={bed.id} />
                <button class="btn-delete-small">Löschen</button>
             </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="add-section">
    <h3>Bett hinzufügen</h3>
    <form method="POST" action="?/create">
      <input type="text" name="label" placeholder="Label (z.B. B1)" required />
      <button type="submit">Hinzufügen</button>
    </form>
  </div>
</div>

<style>
  /* ... Styles von oben übernehmen ... */
  .bed-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; background: #222; border-radius: 8px; overflow: hidden;}
  th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
  th { background: #333; color: #fff; }
  .occupied-row { background: rgba(239, 68, 68, 0.1); }
  .btn-delete-small { padding: 2px 8px; font-size: 0.7rem; background: #ef4444; border: none; color: white; cursor: pointer; border-radius: 3px; }
</style>