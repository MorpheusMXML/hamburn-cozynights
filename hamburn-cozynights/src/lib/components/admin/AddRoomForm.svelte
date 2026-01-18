<script lang="ts">
  export let houseId: string;
</script>

<div class="form-card">
  <h3>Neues Zimmer hinzufügen</h3>
  <form method="POST" action="?/createRoom" class="admin-form">
    <input type="hidden" name="houseId" value={houseId} />

    <div class="form-group">
      <label for="name">Zimmer Name</label>
      <input type="text" id="name" name="name" placeholder="z.B. Seeblick" required />
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="room_number">Nummer</label>
        <input type="number" id="room_number" name="room_number" placeholder="101" required />
      </div>

      <div class="form-group">
        <label for="amount_beds">Anzahl Betten</label>
        <input type="number" id="amount_beds" name="amount_beds" placeholder="0" min="0" />
      </div>
    </div>

    <button type="submit" class="btn-primary">Zimmer erstellen</button>
  </form>
</div>

<style>
  .form-card {
    background: #1a1a1a;
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid #333;
    margin-bottom: 2rem;
  }
  
  h3 { color: #fff; margin-top: 0; }
  
  .admin-form { display: flex; flex-direction: column; gap: 1rem; }
  
  .form-row { display: flex; gap: 1rem; }
  
  .form-group { display: flex; flex-direction: column; flex: 1; }
  
  label { font-size: 0.85rem; color: #aaa; margin-bottom: 0.25rem; }
  
  input {
    padding: 0.5rem;
    background: #2a2a2a;
    border: 1px solid #444;
    color: white;
    border-radius: 4px;
  }
  
  .btn-primary {
    background: #4CAF50;
    color: white;
    padding: 0.75rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    margin-top: 0.5rem;
  }
  .btn-primary:hover { background: #45a049; }
</style>