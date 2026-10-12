// src/lib/code-mail-offer.ts
/** Remembers on this device that the start page offered to e-mail the ticket code. */
export const CODE_MAIL_OFFERED_KEY = 'cozy:code-mail-offered';

type OfferStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Whether this is the first time this device gets the "send me my code" offer
 * (src/routes/+page.svelte): then the card opens by itself. Every later offer
 * starts folded, and its arrow opens it (Max, 2026-10-13). Without storage
 * (private window, blocked site data) every offer counts as the first, so the
 * card is never hidden from someone who needs it.
 */
export function firstCodeMailOffer(storage: () => OfferStorage = () => localStorage): boolean {
	try {
		const store = storage();
		const seen = store.getItem(CODE_MAIL_OFFERED_KEY) === '1';
		store.setItem(CODE_MAIL_OFFERED_KEY, '1');
		return !seen;
	} catch {
		return true;
	}
}
