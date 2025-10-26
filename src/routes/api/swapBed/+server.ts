import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/firebase';
import { readSession } from '$lib/server/session';
import { z } from 'zod';

const bodySchema = z.object({ targetBedId: z.string().min(1) });

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const token = cookies.get('session');
  const session = await readSession(token);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new Response('Bad Request', { status: 400 });

  const { targetBedId } = parsed.data;

  const result = await db.runTransaction(async (tx) => {
    const bookingRef = db.collection('bookings').doc(session.bookingId);
    const bookingDoc = await tx.get(bookingRef);
    if (!bookingDoc.exists) throw new Error('booking-missing');

    const currentBedId = bookingDoc.get('bedId') || null;

    const targetRef = db.collection('beds').doc(targetBedId);
    const targetDoc = await tx.get(targetRef);
    if (!targetDoc.exists) throw new Error('bed-missing');

    if (targetDoc.get('occupied')) {
      return { ok: false, reason: 'taken' as const };
    }

    if (currentBedId) {
      tx.update(db.collection('beds').doc(currentBedId), { occupied: false, bookingId: null });
    }

    tx.update(targetRef, { occupied: true, bookingId: bookingRef.id });
    tx.update(bookingRef, { bedId: targetBedId, updatedAt: Date.now() });

    tx.set(db.collection('audit').doc(), {
      type: 'swap',
      bookingId: bookingRef.id,
      from: currentBedId,
      to: targetBedId,
      ts: Date.now(),
      ip: getClientAddress()
    });

    return { ok: true as const };
  });

  if (!result.ok) return new Response(JSON.stringify(result), { status: 409 });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};