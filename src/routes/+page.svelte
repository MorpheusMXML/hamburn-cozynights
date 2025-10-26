<script lang="ts">
  let code = '';
  let error = '';
  let loading = false;

  async function submit() {
    error = ''; loading = true;
    try {
      const res = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      if (!res.ok) { error = 'Code not found. Please check your booking code.'; return; }
      window.location.href = '/booking';
    } catch {
      error = 'Network error. Try again.';
    } finally { loading = false; }
  }
</script>

<div class="min-h-screen grid place-items-center bg-gradient-to-br from-rose-50 via-white to-amber-50">
  <div class="w-full max-w-md p-8 bg-white/70 backdrop-blur rounded-xl shadow">
    <h1 class="text-2xl font-semibold mb-4">Enter your booking code</h1>
    <div class="space-y-3">
      <input class="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:ring-rose-300"
             placeholder="e.g. ABC123" bind:value={code} on:keydown={(e)=>e.key==='Enter'&&submit()} />
      <button class="w-full bg-rose-600 text-white py-2 rounded hover:bg-rose-700 disabled:opacity-50"
              on:click={submit} disabled={loading || code.length < 4}>
        {loading ? 'Checking…' : 'Continue'}
      </button>
      {#if error}<p class="text-rose-600 text-sm">{error}</p>{/if}
    </div>
  </div>
</div>