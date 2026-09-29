// src/lib/server/swap-actions.ts
/**
 * The form actions of swap requests, shared by the room page (ask, take back)
 * and /swaps (answer, take back, pause). The ticket always comes from the
 * guest's session, never from the form; every answer is an ActionResult the
 * pages show where the guest is looking.
 */
import { fail, type ActionFailure } from '@sveltejs/kit';
import type { OrdersResponse } from '$lib/pocketbase-types';
import { BookingService } from '$lib/server/booking';
import { getBookingSettings } from '$lib/server/settings';
import {
	acceptSwap,
	askForSwap,
	declineSwap,
	setSwapPause,
	SwapError,
	withdrawSwap
} from '$lib/server/swaps';

const SIGNED_OUT =
	'You are not signed in anymore. Go to the start page and enter your ticket code again.';
const CODE_UNKNOWN = 'Your ticket code was not found. Go to the start page and enter it again.';
const UNAVAILABLE = 'The booking system is not reachable right now. Nothing was changed.';

type Failure = ActionFailure<{ error: string }>;

/** A record id from the form, or '' for anything that isn't one. */
function recordId(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' && /^[a-z0-9]{1,32}$/.test(value) ? value : '';
}

/** Runs `step` for the signed-in guest's ticket and turns what can go wrong into a failure. */
async function forGuest<T>(
	locals: App.Locals,
	what: string,
	step: (order: OrdersResponse) => Promise<T>
): Promise<T | Failure> {
	if (!locals.orderNumber) return fail(401, { error: SIGNED_OUT });
	if (!locals.adminPb.authStore.isValid) return fail(500, { error: UNAVAILABLE });
	try {
		const order =
			locals.order ??
			(await new BookingService(locals.adminPb).getOrderByNumber(locals.orderNumber));
		if (!order) return fail(404, { error: CODE_UNKNOWN });
		return await step(order);
	} catch (err) {
		if (err instanceof SwapError) return fail(err.status, { error: err.message });
		console.error(`[Swaps] ${what} failed:`, (err as Error)?.message);
		return fail(500, { error: 'That did not work, and nothing was changed. Please try again.' });
	}
}

export async function askSwapAction(locals: App.Locals, request: Request) {
	const form = await request.formData();
	const bedId = recordId(form, 'bedId');
	if (!bedId) return fail(400, { error: 'No spot was selected. Close this and tap a taken spot.' });
	return forGuest(locals, 'Asking', async (order) => {
		const settings = await getBookingSettings(locals.pb);
		const id = await askForSwap(locals.adminPb, settings, order, bedId, {
			vibe: form.get('vibe'),
			note: form.get('note')
		});
		return { success: true, swapAsked: id };
	});
}

export async function withdrawSwapAction(locals: App.Locals, request: Request) {
	const id = recordId(await request.formData(), 'id');
	if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
	return forGuest(locals, 'Withdrawing', async (order) => {
		await withdrawSwap(locals.adminPb, order, id);
		return { success: true, swapWithdrawn: id };
	});
}

export async function acceptSwapAction(locals: App.Locals, request: Request) {
	const id = recordId(await request.formData(), 'id');
	if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
	return forGuest(locals, 'Accepting', async (order) => {
		const settings = await getBookingSettings(locals.pb);
		const { gained, gave } = await acceptSwap(locals.adminPb, settings, order, id);
		return { success: true, swapped: id, gained, gave };
	});
}

export async function declineSwapAction(locals: App.Locals, request: Request) {
	const form = await request.formData();
	const id = recordId(form, 'id');
	if (!id) return fail(400, { error: 'No request was selected. Reload the page.' });
	return forGuest(locals, 'Declining', async (order) => {
		await declineSwap(locals.adminPb, order, id, { pause: form.get('pause') === 'true' });
		return { success: true, swapDeclined: id };
	});
}

export async function pauseSwapsAction(locals: App.Locals, request: Request) {
	const paused = (await request.formData()).get('paused') === 'true';
	return forGuest(locals, 'Pausing', async (order) => {
		await setSwapPause(locals.adminPb, order, paused);
		return { success: true, swapsPaused: paused };
	});
}
