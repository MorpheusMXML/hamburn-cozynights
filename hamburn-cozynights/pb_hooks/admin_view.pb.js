routerAdd('GET', '/my-admin', (c) => {
	// Holt alle Häuser aus der DB
	const houses = dao.findRecordsByFilter('houses', 'status = true');

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
	const rooms = dao.findRecordsByFilter('rooms', `house = "${houseId}"`);

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
	const beds = dao.findRecordsByFilter('beds', `room = "${roomId}"`);

	return c.html(
		200,
		`
        <h2>Bettenbelegung</h2>
        <table>
            <tr><th>Bett</th><th>Status</th><th>Gast</th></tr>
            ${beds
							.map(
								(b) => `
                <tr>
                    <td>${b.getString('label')}</td>
                    <td>${b.getBool('occupied') ? '🔴 Belegt' : '🟢 Frei'}</td>
                    <td>${b.getString('guest_name') || '-'}</td>
                </tr>
            `
							)
							.join('')}
        </table>
    `
	);
});
