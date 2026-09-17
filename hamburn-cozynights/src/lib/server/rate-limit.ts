/**
 * In-memory limiter for *failed* attempts per key (e.g. client IP).
 *
 * Only failures count, so a crowd behind one festival NAT entering valid codes
 * is never blocked; guessing ticket codes is. State lives in this server
 * process, which matches the single app container deployment.
 */
export class FailureRateLimiter {
	private attempts = new Map<string, { count: number; resetAt: number }>();

	constructor(
		private readonly maxFailures: number,
		private readonly windowMs: number
	) {}

	isBlocked(key: string, now = Date.now()): boolean {
		const entry = this.attempts.get(key);
		if (!entry) return false;
		if (now >= entry.resetAt) {
			this.attempts.delete(key);
			return false;
		}
		return entry.count >= this.maxFailures;
	}

	recordFailure(key: string, now = Date.now()): void {
		const entry = this.attempts.get(key);
		if (!entry || now >= entry.resetAt) {
			this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
		} else {
			entry.count++;
		}
		if (this.attempts.size > 10_000) this.prune(now);
	}

	private prune(now: number): void {
		for (const [key, entry] of this.attempts) {
			if (now >= entry.resetAt) this.attempts.delete(key);
		}
	}
}
