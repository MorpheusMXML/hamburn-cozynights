/**
 * The Destiny Roulette's sounds (/random-bed), made in the browser with Web
 * Audio: no audio files to download. Silent until the guest turns them on
 * with the 🔈 button on the machine; the choice is remembered on the device.
 *
 * Browsers only start audio from a tap or click, so `set(true)` and the
 * sounds of the lever and the SPIN button run inside those handlers. Every
 * sound is a few oscillators or a burst of noise with a short envelope; the
 * reels' whirr is one looped noise buffer.
 */

const STORAGE_KEY = 'cozynights:roulette-sound';

/** The reels' whirr while they spin; each stopping reel takes its share away. */
export interface Whirr {
	stop(): void;
	end(): void;
}

export interface SlotSounds {
	readonly on: boolean;
	/** Turns the sounds on or off. Call it from a click: that lets audio start. */
	set(on: boolean): void;
	/** The lever's ratchet. */
	ratchet(): void;
	/** The reels start spinning. */
	whirr(reels: number): Whirr;
	/** A reel locks into place. */
	clunk(): void;
	/** All reels are in: the jackpot jingle. */
	jackpot(): void;
	/** One click of the name roll. */
	tick(): void;
	/** The name roll stops on a name. */
	ding(): void;
	/** Leave No Trace: the spot is swept away. */
	poof(): void;
	destroy(): void;
}

/** Whether the guest turned the sounds on, on this device. */
export function soundWanted(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'on';
	} catch {
		return false; // storage blocked: stay silent
	}
}

type AudioContextClass = typeof AudioContext;

export function createSlotSounds(): SlotSounds {
	let on = soundWanted();
	let ctx: AudioContext | null = null;
	let master: GainNode | null = null;
	let noise: AudioBuffer | null = null;

	/** The audio graph, made on first use (inside a tap, or the browser keeps it muted). */
	function audio(): AudioContext | null {
		if (!on || typeof window === 'undefined') return null;
		if (!ctx) {
			const Ctor: AudioContextClass | undefined =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
			if (!Ctor) return null;
			try {
				ctx = new Ctor();
			} catch {
				return null;
			}
			master = ctx.createGain();
			master.gain.value = 0.45;
			master.connect(ctx.destination);
			noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
			const data = noise.getChannelData(0);
			for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		}
		if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
		return ctx;
	}

	/** A gain envelope: up to `peak` in `attack` s, down to silence by `release` s. */
	function envelope(c: AudioContext, at: number, peak: number, attack: number, release: number) {
		const gain = c.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(peak, at + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + release);
		gain.connect(master!);
		return gain;
	}

	function tone(type: OscillatorType, freq: number, at: number, peak: number, release: number) {
		const c = audio();
		if (!c) return;
		const osc = c.createOscillator();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, at);
		osc.connect(envelope(c, at, peak, 0.005, release));
		osc.start(at);
		osc.stop(at + release + 0.05);
	}

	function burst(at: number, filter: BiquadFilterType, freq: number, peak: number, length: number) {
		const c = audio();
		if (!c || !noise) return;
		const src = c.createBufferSource();
		src.buffer = noise;
		const band = c.createBiquadFilter();
		band.type = filter;
		band.frequency.value = freq;
		src.connect(band);
		band.connect(envelope(c, at, peak, 0.002, length));
		src.start(at, Math.random() * 0.5);
		src.stop(at + length + 0.05);
	}

	const now = () => audio()?.currentTime ?? 0;

	return {
		get on() {
			return on;
		},
		set(value: boolean) {
			on = value;
			try {
				localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
			} catch {
				/* storage blocked: the choice lasts until the page closes */
			}
			if (value) this.ding();
			else void ctx?.suspend().catch(() => {});
		},
		ratchet() {
			const t = now();
			for (let i = 0; i < 4; i++) burst(t + i * 0.045, 'bandpass', 1400 - i * 120, 0.35, 0.02);
		},
		whirr(reels: number): Whirr {
			const c = audio();
			if (!c || !noise) return { stop() {}, end() {} };
			const src = c.createBufferSource();
			src.buffer = noise;
			src.loop = true;
			const band = c.createBiquadFilter();
			band.type = 'bandpass';
			band.frequency.value = 520;
			band.Q.value = 0.9;
			const gain = c.createGain();
			const level = 0.16;
			gain.gain.setValueAtTime(0.0001, c.currentTime);
			gain.gain.exponentialRampToValueAtTime(level, c.currentTime + 0.12);
			src.connect(band);
			band.connect(gain);
			gain.connect(master!);
			src.start();
			let left = reels;
			let ended = false;
			const end = () => {
				if (ended) return;
				ended = true;
				const t = c.currentTime;
				gain.gain.cancelScheduledValues(t);
				gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
				src.stop(t + 0.1);
			};
			return {
				stop() {
					left = Math.max(0, left - 1);
					if (left === 0) return end();
					const t = c.currentTime;
					gain.gain.setTargetAtTime((level * left) / reels, t, 0.04);
					band.frequency.setTargetAtTime(520 - (reels - left) * 110, t, 0.05);
				},
				end
			};
		},
		clunk() {
			const c = audio();
			if (!c) return;
			const t = c.currentTime;
			const osc = c.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(150, t);
			osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
			osc.connect(envelope(c, t, 0.7, 0.004, 0.16));
			osc.start(t);
			osc.stop(t + 0.2);
			burst(t, 'lowpass', 900, 0.4, 0.03);
		},
		jackpot() {
			const t = now();
			[523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) =>
				tone('triangle', freq, t + i * 0.085, 0.28, 0.3)
			);
			for (const freq of [1046.5, 1318.51, 1567.98]) tone('sine', freq, t + 0.45, 0.16, 0.9);
		},
		tick() {
			burst(now(), 'highpass', 2200, 0.22, 0.012);
		},
		ding() {
			const t = now();
			tone('sine', 1567.98, t, 0.22, 0.5);
			tone('sine', 2093, t + 0.03, 0.12, 0.45);
		},
		poof() {
			const c = audio();
			if (!c || !noise) return;
			const t = c.currentTime;
			const src = c.createBufferSource();
			src.buffer = noise;
			const low = c.createBiquadFilter();
			low.type = 'lowpass';
			low.frequency.setValueAtTime(5000, t);
			low.frequency.exponentialRampToValueAtTime(250, t + 0.7);
			src.connect(low);
			low.connect(envelope(c, t, 0.4, 0.02, 0.75));
			src.start(t);
			src.stop(t + 0.8);
			for (let i = 0; i < 7; i++) {
				tone('sine', 2000 + Math.random() * 2200, t + 0.1 + i * 0.08, 0.07, 0.12);
			}
		},
		destroy() {
			void ctx?.close().catch(() => {});
			ctx = null;
			master = null;
			noise = null;
		}
	};
}
