/**
 * Mounts the burning-effigy title on a canvas.
 *
 * `box` is the element that reserves the title's space in the layout (its
 * aspect ratio comes from `effigyAspect()`); the canvas sits on top of it and
 * reaches beyond it, so flames and smoke can rise above the letters without
 * pushing the page around.
 *
 * The loop only runs while the title is on screen, the tab is visible and the
 * animation isn't paused. With `still: true` (reduced motion) it draws the
 * standing title once and never animates.
 */
import { EffigyRenderer, type Viewport } from './renderer';
import { EffigySimulation, type Phase } from './simulation';
import { buildStructure, DEFAULT_LINES, layoutUnits } from './structure';

/** Room around the layout box for flames (top), wind (sides) and the pile (bottom), in letter heights. */
const PAD_TOP = 1.15;
const PAD_SIDE = 0.5;
const PAD_BOTTOM = 0.3;

export interface EffigyOptions {
	lines?: readonly string[];
	/** Draw the standing title once, no animation (prefers-reduced-motion). */
	still?: boolean;
	/** Let the cursor or a finger light the letters. */
	torch?: boolean;
	/** Called after the first frame is on the canvas. */
	onReady?: () => void;
	/** Called whenever the burn cycle enters a new phase. */
	onPhase?: (phase: Phase) => void;
}

export interface EffigyController {
	setPaused(paused: boolean): void;
	destroy(): void;
}

export function createEffigyBurn(
	canvas: HTMLCanvasElement,
	box: HTMLElement,
	{ lines = DEFAULT_LINES, still = false, torch = true, onReady, onPhase }: EffigyOptions = {}
): EffigyController | null {
	if (!canvas.getContext('2d')) return null;
	const units = layoutUnits(lines);

	let sim: EffigySimulation | null = null;
	let renderer: EffigyRenderer | null = null;
	let boxWidth = 0;
	let raf = 0;
	let last = 0;
	let paused = false;
	let onScreen = true;
	let ready = false;
	let phase: Phase | null = null;
	let destroyed = false;
	let frameEma = 16;
	let qualityClock = 0;

	function layout() {
		const width = box.clientWidth;
		if (width < 10) return false;
		boxWidth = width;
		const S = width / units.width;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const view: Viewport = {
			originX: PAD_SIDE * S,
			originY: PAD_TOP * S,
			width: width + 2 * PAD_SIDE * S,
			height: units.height * S + (PAD_TOP + PAD_BOTTOM) * S,
			dpr
		};
		Object.assign(canvas.style, {
			left: `${-view.originX}px`,
			top: `${-view.originY}px`,
			width: `${view.width}px`,
			height: `${view.height}px`
		});
		canvas.width = Math.round(view.width * dpr);
		canvas.height = Math.round(view.height * dpr);

		const structure = buildStructure(lines, S);
		// Only the very first appearance plays the build; after a resize the title just stands.
		const first = !sim;
		sim = new EffigySimulation(structure, {
			seed: (Math.random() * 2 ** 31) | 0,
			start: still || !first ? 'stand' : 'build',
			autoIgnite: !still
		});
		const quality = renderer?.quality ?? 1;
		renderer = new EffigyRenderer(canvas, sim, view);
		renderer.quality = quality;
		return true;
	}

	function draw(dt: number, now: number) {
		if (!sim || !renderer) return;
		if (dt > 0) sim.step(dt);
		renderer.render(dt, now / 1000);
		if (sim.phase !== phase) {
			phase = sim.phase;
			onPhase?.(phase);
		}
		if (!ready) {
			ready = true;
			onReady?.();
		}
	}

	function frame(now: number) {
		raf = 0;
		if (destroyed || paused || !onScreen || document.hidden) return;
		const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
		last = now;
		const start = performance.now();
		draw(dt, now);
		adaptQuality(performance.now() - start, dt);
		raf = requestAnimationFrame(frame);
	}

	/** Fewer particles when frames get slow, more again when there is headroom. */
	function adaptQuality(cost: number, dt: number) {
		if (!renderer) return;
		frameEma += (Math.max(cost, dt * 1000) - frameEma) * 0.05;
		qualityClock += dt;
		if (qualityClock < 1) return;
		qualityClock = 0;
		if (frameEma > 24) renderer.quality = Math.max(0.35, renderer.quality * 0.8);
		else if (frameEma < 17) renderer.quality = Math.min(1, renderer.quality * 1.05);
	}

	function wake() {
		if (still || raf || destroyed || paused || !onScreen || document.hidden) return;
		last = performance.now();
		raf = requestAnimationFrame(frame);
	}

	// --- Torch -------------------------------------------------------------------

	function torchAt(clientX: number, clientY: number, radius: number) {
		if (!sim || paused || still) return;
		const rect = box.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const S = sim.structure.scale;
		if (x < -S || y < -S || x > rect.width + S || y > rect.height + S) return;
		sim.torch(x, y, radius * S);
	}

	const onPointerMove = (e: PointerEvent) => {
		if (e.pointerType === 'touch') return;
		torchAt(e.clientX, e.clientY, 0.06);
	};
	const onPointerDown = (e: PointerEvent) => {
		torchAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 0.16 : 0.08);
	};
	const onTouchMove = (e: TouchEvent) => {
		const t = e.touches[0];
		if (t) torchAt(t.clientX, t.clientY, 0.14);
	};

	// --- Observers ---------------------------------------------------------------

	const resizeObserver = new ResizeObserver(() => {
		if (Math.abs(box.clientWidth - boxWidth) < 1) return;
		if (layout()) {
			if (still || paused) draw(0, performance.now());
			else wake();
		}
	});
	const intersection = new IntersectionObserver(
		([entry]) => {
			onScreen = entry.isIntersecting;
			wake();
		},
		{ rootMargin: '64px' }
	);
	const onVisibility = () => wake();

	if (!layout()) {
		// Not laid out yet; the resize observer builds it as soon as it has a size.
		boxWidth = -10;
	} else if (still) {
		draw(0, performance.now());
	}
	resizeObserver.observe(box);
	if (!still) {
		intersection.observe(box);
		document.addEventListener('visibilitychange', onVisibility);
		if (torch) {
			const passive: AddEventListenerOptions = { passive: true };
			window.addEventListener('pointermove', onPointerMove, passive);
			window.addEventListener('pointerdown', onPointerDown, passive);
			window.addEventListener('touchmove', onTouchMove, passive);
		}
		wake();
	}

	return {
		setPaused(value: boolean) {
			paused = value;
			if (!paused) wake();
		},
		destroy() {
			destroyed = true;
			cancelAnimationFrame(raf);
			resizeObserver.disconnect();
			intersection.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('touchmove', onTouchMove);
		}
	};
}
