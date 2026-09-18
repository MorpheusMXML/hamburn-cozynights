import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The legal notice is in English at /legal-notice; German visitors often type /impressum.
export const GET: RequestHandler = () => redirect(301, '/legal-notice');
