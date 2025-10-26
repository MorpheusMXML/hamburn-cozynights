import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DATABASE_URL } from '$env/static/private';

const client = postgres(DATABASE_URL, {
  ssl: 'require',
  // PGBouncer friendly (Supabase pooled)
  max: 1,
  prepare: false
});

export const db = drizzle(client);
export * as schema from './schema';