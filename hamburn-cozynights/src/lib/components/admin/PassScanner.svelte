<script lang="ts">
	// Scans QR codes with the device camera in any browser (the decoder of the
	// `qr` package, loaded only when the camera is opened). Needs HTTPS.
	import { createEventDispatcher, onDestroy, tick } from 'svelte';

	const dispatch = createEventDispatcher<{ scan: string }>();

	let video: HTMLVideoElement;
	let overlay: HTMLCanvasElement;
	let active = false;
	let starting = false;
	let error = '';
	let stopCamera: (() => void) | null = null;

	async function start() {
		error = '';
		starting = true;
		try {
			const { QRCanvas, frameLoop, rearCamera, selfieCamera } = await import('qr/dom.js');
			active = true;
			await tick();
			const canvas = new QRCanvas({ overlay });
			// Phones: the back camera. Laptops only have the one facing you.
			const camera = await rearCamera(video).catch(() => selfieCamera(video));
			let busy = false;
			const cancel = frameLoop(async () => {
				if (busy) return;
				busy = true;
				try {
					const result = await camera.readFrame(canvas);
					const text =
						typeof result === 'string'
							? result
							: Array.isArray(result)
								? result.find((r): r is string => typeof r === 'string')
								: undefined;
					if (text) {
						stop();
						dispatch('scan', text);
					}
				} finally {
					busy = false;
				}
			}, video);
			stopCamera = () => {
				cancel();
				camera.stop();
			};
		} catch (err) {
			stop();
			error =
				'The camera could not be opened. Allow camera access for this site, or type the code.';
			console.warn('[PassScanner]', (err as Error)?.message);
		} finally {
			starting = false;
		}
	}

	function stop() {
		stopCamera?.();
		stopCamera = null;
		active = false;
	}

	onDestroy(stop);
</script>

<div class="scanner">
	{#if active}
		<div class="viewport">
			<!-- svelte-ignore a11y-media-has-caption -->
			<video bind:this={video} playsinline muted></video>
			<canvas bind:this={overlay}></canvas>
		</div>
		<button type="button" class="btn-secondary" on:click={stop}>Close camera</button>
	{:else}
		<button type="button" class="btn-secondary" on:click={start} disabled={starting}>
			📷 {starting ? 'Opening camera…' : 'Scan with camera'}
		</button>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.scanner {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
	}
	.viewport {
		position: relative;
		width: min(100%, 420px);
		border-radius: 12px;
		overflow: hidden;
		background: #000;
	}
	.viewport video,
	.viewport canvas {
		width: 100%;
		display: block;
	}
	.viewport canvas {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.btn-secondary {
		min-height: 44px;
		padding: 0 1.1rem;
		border-radius: 10px;
		border: 1px solid #2dd4bf;
		background: transparent;
		color: #2dd4bf;
		font-weight: 800;
		cursor: pointer;
	}
	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.error {
		color: #fecaca;
		margin: 0;
	}
</style>
