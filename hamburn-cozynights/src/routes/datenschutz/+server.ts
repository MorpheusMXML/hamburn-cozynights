import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The privacy policy is in English at /privacy; German visitors often type /datenschutz.
export const GET: RequestHandler = () => redirect(301, '/privacy');
