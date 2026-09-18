import type { ActionResult } from '@sveltejs/kit';
import { deserialize } from '$app/forms';

/** Posts to a SvelteKit form action from script and returns its result. */
export async function submitAction(actionUrl: string, formData: FormData): Promise<ActionResult> {
	try {
		const response = await fetch(actionUrl, {
			method: 'POST',
			body: formData,
			headers: {
				'x-sveltekit-action': 'true',
				accept: 'application/json'
			}
		});
		// The `data` of an action response is devalue-encoded: response.json()
		// would leave it a string, so the real error message never showed up.
		return deserialize(await response.text());
	} catch (err: any) {
		console.error(`[Action Error] Fetch failed for ${actionUrl}:`, err);
		return { type: 'error', error: err };
	}
}

/** Server-provided reason of a failed action: fail(…, { error | message }) or error(…). */
export function actionErrorMessage(result: ActionResult): string | undefined {
	if (result.type === 'failure') {
		const data = result.data as { error?: unknown; message?: unknown } | undefined;
		const reason = data?.error ?? data?.message;
		return typeof reason === 'string' ? reason : undefined;
	}
	if (result.type === 'error') {
		return typeof result.error?.message === 'string' ? result.error.message : undefined;
	}
	return undefined;
}
