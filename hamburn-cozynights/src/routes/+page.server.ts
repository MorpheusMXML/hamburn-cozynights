// src/routes/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { BookingService } from '$lib/server/booking';

export const actions: Actions = {
    login: async ({ request, cookies, locals }) => {
        const data = await request.formData();
        const bookingCode = data.get('bookingCode')?.toString().trim();

        if (!bookingCode) {
            return fail(400, { error: 'Please enter a booking code.' });
        }

        // Basic alphanumeric validation
        if (!/^[a-zA-Z0-9_-]+$/.test(bookingCode)) {
            return fail(400, { error: 'Invalid booking code format.' });
        }

        const bookingService = new BookingService(locals.adminPb);
        const order = await bookingService.getOrderByNumber(bookingCode);

        if (order) {
            // Persist the code in a cookie
            cookies.set('bookingCode', bookingCode, {
                path: '/',
                httpOnly: false,
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 30
            });

            throw redirect(303, '/map');
        } else {
            console.warn(`[Login] Code not found: ${bookingCode}`);
            return fail(404, { error: `Order code "${bookingCode}" not found.` });
        }
    }
};
