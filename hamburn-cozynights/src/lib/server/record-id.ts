/**
 * A PocketBase record id from a form, or '' for anything else. Ids from a
 * guest's form become lock keys and filter values ($lib/server/booking
 * withLock), so nothing longer or stranger than an id gets that far.
 */
export function recordId(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' && /^[a-z0-9]{1,32}$/.test(value) ? value : '';
}
