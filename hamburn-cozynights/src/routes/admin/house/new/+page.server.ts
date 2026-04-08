import { error, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
    create: async ({ request, locals }) => {
        if (!locals.pb.authStore.isValid) {
            throw error(401, 'Unauthorized');
        }

        const data = await request.formData();
        const name = data.get('name');
        const x = parseInt(data.get('x') as string);
        const y = parseInt(data.get('y') as string);

        try {
            // Beispiel-Aufruf für Pocketbase
            await locals.pb.collection('houses').create({
                name,
                x,
                y,
                occupied: false
            });
        } catch (err) {
            console.error(err);
            throw error(500, 'Could not create house');
        }

        throw redirect(303, '/admin');
    }
};