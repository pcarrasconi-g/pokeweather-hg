// Caché en memoria con TTL y tope de entradas (FIFO por inserción).
export class TtlCache {
  constructor({ max = 500, ttlMs = 60_000, now = Date.now } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, exp: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  get size() {
    return this.map.size;
  }

  // Devuelve valor cacheado o ejecuta fn (deduplicando llamadas concurrentes).
  async wrap(key, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const v = await fn();
        this.set(key, v);
        return v;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
