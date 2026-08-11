export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) { this.buckets.set(key, recent); return false; }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  clear(key: string) { this.buckets.delete(key); }
}
