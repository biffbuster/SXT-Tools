/**
 * Per-principal token bucket for tool calls on the hosted transport.
 *
 * Each principal (a hash of the caller's SXT API key, see sealed.ts) gets
 * `perMinute` calls of burst capacity, refilled continuously. The limit is
 * per instance; with N instances behind a load balancer the effective ceiling
 * is N x perMinute. That is acceptable as abuse protection because every call
 * is also billed to the caller's own SXT account. Move this to a shared store
 * if the limit ever has to be exact.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ratePerMs: number;

  constructor(private readonly perMinute: number) {
    this.ratePerMs = perMinute / 60_000;
  }

  /** Returns 0 if allowed, otherwise the milliseconds until a token is available. */
  take(principal: string, now = Date.now()): number {
    const b = this.buckets.get(principal) ?? { tokens: this.perMinute, updated: now };
    b.tokens = Math.min(this.perMinute, b.tokens + (now - b.updated) * this.ratePerMs);
    b.updated = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(principal, b);
      if (this.buckets.size > 50_000) this.prune(now);
      return 0;
    }
    this.buckets.set(principal, b);
    return Math.ceil((1 - b.tokens) / this.ratePerMs);
  }

  private prune(now: number): void {
    // A bucket that has had a full minute to refill is indistinguishable from a new one.
    for (const [k, b] of this.buckets) if (now - b.updated > 60_000) this.buckets.delete(k);
  }
}
