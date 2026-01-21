// src/routes/map/+page.server.ts
import type { PageServerLoad } from './$types';
// Entferne diesen Import: import { pb } from '$lib/pocketbase'; 

export const load: PageServerLoad = async ({ locals }) => { // Füge 'locals' hier hinzu
  // Nutze locals.pb statt der globalen pb Variable
  const houses = await locals.pb.collection('houses').getFullList({
    sort: 'name',
  });

  return { houses };
};