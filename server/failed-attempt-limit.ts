export class FailedAttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  isBlocked(key: string, now = Date.now()) {
    return this.recent(key, now).length >= this.limit;
  }

  recordFailure(key: string, now = Date.now()) {
    const failures = this.recent(key, now);
    failures.push(now); this.failures.set(key, failures);
  }

  clear(key: string) { this.failures.delete(key); }

  private recent(key: string, now: number) {
    const cutoff = now - this.windowMs;
    const failures = (this.failures.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (failures.length) this.failures.set(key, failures); else this.failures.delete(key);
    return failures;
  }
}
