// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
    login: async ({ request, cookies, locals }) => {
        const data = await request.formData();
        const bookingCode = data.get('bookingCode')?.toString().trim();

        if (!bookingCode) {
            return fail(400, { error: 'Please enter a booking code.' });
        }

        // Basic alphanumeric validation to prevent injection attempts
        if (!/^[a-zA-Z0-9_-]+$/.test(bookingCode)) {
            return fail(400, { error: 'Invalid booking code format.' });
        }

        try {
            // Use locals.pb for per-request isolation
            // Using a parameterized filter to prevent injection
            const order = await locals.pb.collection('orders').getFirstListItem(
                locals.pb.filter('order_number = {:code}', { code: bookingCode })
            );
            
            console.log('Order found:', order.id);

            // Persist the code in a cookie for 30 days
            cookies.set('bookingCode', bookingCode, {
                path: '/',
                httpOnly: false,
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 30
            });

            throw redirect(303, '/map');
        } catch (err) {
            if (err && typeof err === 'object' && 'status' in err && err.status === 303) {
                throw err;
            }
            
            console.error('Login error:', err);
            return fail(404, { error: `Order code "${bookingCode}" not found.` });
        }
    }
};