// src/lib/dialogs.ts
/**
 * In-app replacements for window.alert / window.confirm and a small toast queue.
 *
 * The browser's own dialogs take their button labels ("Abbrechen", "OK") from
 * the browser language. The app is English only, so every message goes through
 * {@link DialogHost} instead, which is mounted once in the root layout.
 */
import { writable } from 'svelte/store';

export type DialogTone = 'info' | 'success' | 'warning' | 'danger';

export interface DialogOptions {
	title?: string;
	tone?: DialogTone;
	confirmLabel?: string;
	cancelLabel?: string;
}

export interface DialogRequest extends Required<Omit<DialogOptions, 'title'>> {
	id: number;
	kind: 'alert' | 'confirm';
	title: string;
	message: string;
	resolve: (confirmed: boolean) => void;
}

export interface Toast {
	id: number;
	message: string;
	tone: DialogTone;
}

/** Open dialogs, oldest first. DialogHost shows the first one. */
export const dialogQueue = writable<DialogRequest[]>([]);
export const toasts = writable<Toast[]>([]);

let nextId = 1;

function open(kind: DialogRequest['kind'], message: string, options: DialogOptions) {
	return new Promise<boolean>((resolve) => {
		const request: DialogRequest = {
			id: nextId++,
			kind,
			message,
			title: options.title ?? '',
			tone: options.tone ?? (kind === 'confirm' ? 'warning' : 'info'),
			confirmLabel: options.confirmLabel ?? (kind === 'confirm' ? 'Confirm' : 'OK'),
			cancelLabel: options.cancelLabel ?? 'Cancel',
			resolve
		};
		dialogQueue.update((queue) => [...queue, request]);
	});
}

/** Closes a dialog and settles its promise. Called by DialogHost. */
export function settleDialog(id: number, confirmed: boolean) {
	dialogQueue.update((queue) => {
		queue.find((request) => request.id === id)?.resolve(confirmed);
		return queue.filter((request) => request.id !== id);
	});
}

/** English replacement for window.confirm. Resolves true when confirmed. */
export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
	return open('confirm', message, options);
}

/** English replacement for window.alert. Resolves when dismissed. */
export async function alertDialog(message: string, options: DialogOptions = {}): Promise<void> {
	await open('alert', message, options);
}

/** A short message that disappears on its own. */
export function toast(message: string, tone: DialogTone = 'info', durationMs = 5000) {
	const id = nextId++;
	toasts.update((list) => [...list, { id, message, tone }]);
	if (durationMs > 0) setTimeout(() => dismissToast(id), durationMs);
	return id;
}

export function dismissToast(id: number) {
	toasts.update((list) => list.filter((entry) => entry.id !== id));
}
