import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
    default: async ({ locals }) => {
        const userEmail = locals.pb.authStore.model?.email;
        console.log(`[Session] Terminating session for burner: ${userEmail || 'Unknown'}`);
        
        locals.pb.authStore.clear();
        
        console.log(`[Session] Burner ${userEmail || 'Unknown'} successfully ejected to orbit. 🚀`);
        throw redirect(303, '/admin/login');
    }
};
