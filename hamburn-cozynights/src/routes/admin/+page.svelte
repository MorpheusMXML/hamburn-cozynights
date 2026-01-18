<script lang="ts">
    import type { PageData } from './$types';
    
    // Die Daten kommen typisiert vom Server
    export let data: PageData;
</script>

<div class="container mx-auto p-8 max-w-5xl">
    <h1 class="text-3xl font-bold mb-8 text-gray-800">Verwaltung: Häuser & Betten</h1>

    {#if data.houses.length === 0}
        <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8 text-blue-700">
            <p class="font-bold">Die Datenbank ist leer.</p>
            <p>Erstelle unten dein erstes Haus, um zu beginnen.</p>
        </div>
    {/if}

    <div class="grid gap-10">
        {#each data.houses as house}
            <div class="bg-white border shadow-sm rounded-lg overflow-hidden">
                <div class="bg-gray-800 text-white p-4 flex justify-between items-center">
                    <h2 class="text-xl font-bold">🏠 {house.name}</h2>
                    <form action="?/deleteHouse" method="POST">
                        <input type="hidden" name="id" value={house.id}>
                        <button class="text-xs bg-red-600 hover:bg-red-700 px-3 py-1 rounded transition">
                            Haus Löschen
                        </button>
                    </form>
                </div>

                <div class="p-6">
                    {#if house.items.length === 0}
                        <p class="text-gray-400 italic mb-4">Noch keine Zimmer in diesem Haus.</p>
                    {/if}

                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
                        {#each house.items as room}
                            <div class="border rounded-md p-4 bg-gray-50 relative group">
                                <div class="flex justify-between items-start mb-3 border-b pb-2">
                                    <div>
                                        <span class="font-bold text-lg">Zimmer {room.room_number}</span>
                                        <span class="block text-xs text-gray-500">{room.name}</span>
                                    </div>
                                    <form action="?/deleteRoom" method="POST">
                                        <input type="hidden" name="id" value={room.id}>
                                        <button class="text-gray-400 hover:text-red-500 text-xl font-bold px-2">×</button>
                                    </form>
                                </div>

                                <div class="space-y-2 mb-4">
                                    {#each room.items as bed}
                                        <div class="flex justify-between items-center bg-white border px-3 py-2 rounded text-sm shadow-sm">
                                            <div class="flex items-center gap-2">
                                                <span class="text-lg">🛏️</span>
                                                <span class="font-medium">{bed.label}</span>
                                            </div>
                                            <form action="?/deleteBed" method="POST">
                                                <input type="hidden" name="id" value={bed.id}>
                                                <button class="text-red-200 hover:text-red-500 transition">×</button>
                                            </form>
                                        </div>
                                    {/each}
                                </div>

                                <form action="?/createBed" method="POST" class="flex gap-2 mt-auto">
                                    <input type="hidden" name="room_id" value={room.id}>
                                    <input type="text" name="label" placeholder="Bett Bez." required 
                                           class="w-full text-xs p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none">
                                    <button class="bg-blue-600 text-white px-3 rounded text-lg hover:bg-blue-700">+</button>
                                </form>
                            </div>
                        {/each}
                    </div>

                    <div class="border-t pt-4 bg-gray-50 -mx-6 -mb-6 p-6">
                        <h4 class="text-sm font-bold text-gray-600 mb-2 uppercase tracking-wide">Neues Zimmer anlegen</h4>
                        <form action="?/createRoom" method="POST" class="flex gap-3">
                            <input type="hidden" name="house_id" value={house.id}>
                            <input type="text" name="room_number" placeholder="Nr. (z.B. 101)" required class="border p-2 rounded w-32">
                            <input type="text" name="name" placeholder="Name (Optional)" class="border p-2 rounded flex-1">
                            <button class="bg-gray-800 text-white px-6 py-2 rounded font-medium hover:bg-black transition">Speichern</button>
                        </form>
                    </div>
                </div>
            </div>
        {/each}

        <div class="mt-8 border-t-2 border-dashed border-gray-300 pt-8">
            <h2 class="text-xl font-bold mb-4 text-gray-700">Neues Gebäude hinzufügen</h2>
            <form action="?/createHouse" method="POST" class="flex gap-4 max-w-lg bg-white p-6 rounded-lg shadow-sm border">
                <input type="text" name="name" placeholder="Name des Hauses (z.B. Waldhütte)" required class="border p-3 rounded flex-1 text-lg">
                <button class="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded font-bold text-lg transition">
                    Erstellen
                </button>
            </form>
        </div>
    </div>
</div>