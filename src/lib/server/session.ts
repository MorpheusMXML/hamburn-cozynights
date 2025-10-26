import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? 'dev-secret');

export type SessionPayload = { bookingId: string; exp: number };

export async function createSession(bookingId: string, ttlHours = 12) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ bookingId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlHours * 3600)
    .sign(secret);
}

export async function readSession(token?: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { bookingId: payload.bookingId as string, exp: payload.exp as number };
  } catch {
    return null;
  }
}