import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Basic Check: Is user logged in?
    if (!locals.pb.authStore.isValid) {
        if (url.pathname !== '/admin/login') {
            throw redirect(303, '/admin/login');
        }
    } else {
        // User is logged in.
        
        // Lock login page for authenticated users
        if (url.pathname === '/admin/login') {
            throw redirect(303, '/admin');
        }
    }

    // Fetch user object
    const userModel = locals.pb.authStore.model;
    const userJSON = userModel ? JSON.parse(JSON.stringify(userModel)) : null;

    return {
        user: userJSON,
        // Explicit flag for the frontend to hide buttons
        isVerified: userJSON?.verified === true
    };
};