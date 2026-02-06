import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { pb } from '$lib/pocketbase';

export const actions: Actions = {
    login: async ({ request, cookies }) => {
        const data = await request.formData();
        const bookingCode = data.get('bookingCode') as string;

        if (!bookingCode) {
            return fail(400, { error: 'Please enter a booking code.' });
        }

        try {
            // Check if the order exists in the 'orders' collection
            // We search for a record where 'order_number' matches the user input
            await pb.collection('orders').getFirstListItem(`order_number = "${bookingCode}"`);
            
            // If found, save the code in a cookie so the user stays "logged in"
            cookies.set('bookingCode', bookingCode, {
                path: '/',
                httpOnly: false, // Allows client-side reading if needed
                maxAge: 60 * 60 * 24 * 30 // Valid for 30 days
            });

            // Redirect the user to the map page
            throw redirect(303, '/map');
        } catch (err) {
            // SvelteKit redirects are technically errors, so we must let them through
            if (err instanceof Response && err.status === 303) throw err;
            
            console.error('Login error:', err);
            return fail(404, { error: 'Invalid Booking Code. Please check your confirmation email.' });
        }
    }
};