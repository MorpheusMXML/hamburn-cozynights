import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/firebase';
import { readSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
  const token = cookies.get('session');
  const session = await readSession(token);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const bookingRef = db.collection('bookings').doc(session.bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) return new Response('Not found', { status: 404 });
  const booking = { id: bookingDoc.id, ...bookingDoc.data() };

  const bedsSnap = await db.collection('beds').get();
  const beds = bedsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return new Response(JSON.stringify({ booking, beds }), { headers: { 'Content-Type': 'application/json' } });
};