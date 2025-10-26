<script lang="ts">
  type Bed = { id: string; occupied: boolean; bookingId?: string|null; label?: string; zone?: string };
  type Booking = { id: string; name?: string; bedId?: string|null };

  let booking: Booking | null = null;
  let beds: Bed[] = [];
  let message = '';

  async function load() {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();
    booking = data.booking; beds = data.beds;
  }

  async function swap(targetBedId: string) {
    message = '';
    const res = await fetch('/api/swapBed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBedId })
    });
    if (res.ok) { await load(); message = 'Bed updated ✨'; }
    else if (res.status === 409) { const j = await res.json(); if (j.reason === 'taken') message = 'Just taken. Pick another.'; }
    else { message = 'Failed to update bed.'; }
  }

  $: yourBedId = booking?.bedId ?? null;
  load();
</script>

<div class="min-h-screen p-6 bg-white">
  <div class="max-w-5xl mx-auto space-y-6">
    <header>
      <h1 class="text-xl font-semibold">Your booking</h1>
      {#if booking}
        <p class="text-slate-600">Booking ID: <span class="font-mono">{booking.id}</span></p>
        <p class="text-slate-600">Current bed: <strong>{yourBedId ?? '—'}</strong></p>
      {/if}
    </header>

    {#if message}<div class="p-3 bg-amber-50 border border-amber-200 rounded">{message}</div>{/if}

    <section>
      <h2 class="text-lg font-medium mb-2">Bed map</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {#each beds as bed}
          <button
            class="rounded border p-3 text-sm flex flex-col items-start
            {bed.id === yourBedId ? 'bg-rose-100 border-rose-300'
              : bed.occupied ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'}"
            disabled={bed.occupied && bed.id !== yourBedId}
            on:click={() => bed.id !== yourBedId && !bed.occupied && swap(bed.id)}
          >
            <span class="font-semibold">{bed.label ?? bed.id}</span>
            <span class="text-xs">{bed.id === yourBedId ? 'Yours' : bed.occupied ? 'Taken' : 'Available'}</span>
            {#if bed.zone}<span class="text-[11px] text-slate-500 mt-1">Zone: {bed.zone}</span>{/if}
          </button>
        {/each}
      </div>
    </section>
  </div>
</div>