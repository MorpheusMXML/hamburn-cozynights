// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { pb } from '$lib/pocketbase';

export const actions: Actions = {
    login: async ({ request, cookies }) => {
        const data = await request.formData();
        const bookingCode = data.get('bookingCode')?.toString().trim();

        console.log('Attempting login with code:', bookingCode);

        if (!bookingCode) {
            return fail(400, { error: 'Please enter a booking code.' });
        }

        try {
            // 1. Verify the order exists in the 'orders' collection. 
            // Ensure your PocketBase field name is exactly 'order_number'
            const order = await pb.collection('orders').getFirstListItem(`order_number = "${bookingCode}"`);
            
            console.log('Order found:', order.id);

            // 2. Persist the code in a cookie for 30 days
            cookies.set('bookingCode', bookingCode, {
                path: '/',
                httpOnly: false,
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 30
            });

            // 3. Redirect to map
            throw redirect(303, '/map');
        } catch (err) {
            // Handle the redirect throw (which is technically an "error" in SvelteKit)
            if (err && typeof err === 'object' && 'status' in err && err.status === 303) {
                throw err;
            }
            
            console.error('Login error details:', err);
            return fail(404, { error: `Order code "${bookingCode}" not found in database.` });
        }
    }
};