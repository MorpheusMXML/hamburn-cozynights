import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/firebase';
import { z } from 'zod';
import { createSession } from '$lib/server/session';
import { verifyCode } from '$lib/server/crypto';
import { sha256 } from '$lib/server/hash';

const bodySchema = z.object({ code: z.string().min(4).max(128) });

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new Response('Bad Request', { status: 400 });

  const { code } = parsed.data;
  const lookup = sha256(code);

  const snap = await db.collection('bookings')
    .where('codeLookup', '==', lookup)
    .limit(1).get();

  if (snap.empty) return new Response('Invalid code', { status: 401 });

  const doc = snap.docs[0];
  const data = doc.data() as { codeHash?: string };

  if (!data.codeHash || !(await verifyCode(code, data.codeHash))) {
    return new Response('Invalid code', { status: 401 });
  }

  const token = await createSession(doc.id, 12);
  cookies.set('session', token, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12
  });

  // best effort audit
  db.collection('audit').add({ type: 'login', bookingId: doc.id, ts: Date.now(), ip: getClientAddress() })
    .catch(() => void 0);

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};