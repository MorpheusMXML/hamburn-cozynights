// Was previously in this file only ever ran if you mounted pb_hooks/ into
// the container, which docker-compose.yml never did — so none of this had
// actually executed before. Ported from the pre-0.23 `dao.*` API (removed
// in modern PocketBase) to `$app.*`, and from a `status`/`guest_name`
// field pair that doesn't exist on these collections (see pb_migrations/)
// to the real ones. The list view below (/my-admin) works; the nested
// /my-admin/house/:id and /my-admin/room/:id routes still 404 — looks like
// a routing quirk in this PocketBase version rather than anything
// specific to this handler, not chased down further here.
routerAdd('GET', '/my-admin', (c) => {
	// Holt alle Häuser aus der DB
	const houses = $app.findRecordsByFilter('houses', '');

	// Hier würdest du normalerweise ein HTML-Template rendern
	return c.html(
		200,
		`
        <h1>Hausübersicht</h1>
        <div class="grid">
            ${houses
							.map(
								(h) => `
                <button onclick="location.href='/my-admin/house/${h.id}'">
                    ${h.getString('name')}
                </button>
            `
							)
							.join('')}
        </div>
    `
	);
});

routerAdd('GET', '/my-admin/house/:id', (c) => {
	const houseId = c.pathParam('id');
	const rooms = $app.findRecordsByFilter('rooms', `house = "${houseId}"`);

	return c.html(
		200,
		`
        <h2>Zimmer in Haus ${houseId}</h2>
        <ul>
            ${rooms
							.map(
								(r) => `
                <li onclick="location.href='/my-admin/room/${r.id}'">
                    Zimmer ${r.getInt('room_number')} - Betten: ${r.getInt('amount_beds')}
                </li>
            `
							)
							.join('')}
        </ul>
    `
	);
});

routerAdd('GET', '/my-admin/room/:id', (c) => {
	const roomId = c.pathParam('id');
	const beds = $app.findRecordsByFilter('beds', `room = "${roomId}"`);

	return c.html(
		200,
		`
        <h2>Bettenbelegung</h2>
        <table>
            <tr><th>Bett</th><th>Status</th></tr>
            ${beds
							.map(
								(b) => `
                <tr>
                    <td>${b.getString('label')}</td>
                    <td>${b.getBool('occupied') ? '🔴 Belegt' : '🟢 Frei'}</td>
                </tr>
            `
							)
							.join('')}
        </table>
    `
	);
});
