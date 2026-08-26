import type { AllowResult, Limiter } from "./rate-limit.ts";

/** Configuración del limiter de token bucket (R5). */
export type TokenBucketConfig = {
  /** Capacidad máxima del balde (ráfaga máxima) — p.ej. 100. */
  capacity: number;
  /** Tokens por refillIntervalMs — p.ej. 100/60 ≈ 1.6667. */
  refillRate: number;
  /** Granularidad del refill discreto en ms — p.ej. 1000. */
  refillIntervalMs: number;
};

/**
 * Limiter de token bucket con refill lazy y discreto (R5).
 *
 * Refill LAZY: se computa solo dentro de allow(). DISCRETO POR INTERVALOS:
 * avanza `lastRefill` solo por intervalos completos (evita acumulación de
 * error float por deltas enormes). Float con clamp superior:
 *   tokens = min(capacity, tokens + intervals * refillRate)
 *
 * Semántica de resetAt (asimetría 429/200 documentada):
 *   - 429: instante del PRÓXIMO token (cuando allow() volverá a admitir, R10).
 *   - 200: instante de restauración completa (= now si el balde está lleno).
 */
export function createTokenBucketLimiter(config: TokenBucketConfig): Limiter {
  const { capacity, refillRate, refillIntervalMs } = config;

  let tokens = capacity; // balde inicialmente lleno
  let lastRefill = 0;

  return {
    allow(now: number): AllowResult {
      // Refill lazy discreto por intervalos completos.
      const intervals = Math.floor((now - lastRefill) / refillIntervalMs);
      if (intervals > 0) {
        tokens = Math.min(capacity, tokens + intervals * refillRate); // clamp superior
        lastRefill = lastRefill + intervals * refillIntervalMs; // solo intervalos completos
      }

      if (tokens < 1) {
        // 429: instante del próximo token (> now, satisface R10).
        const resetAt = lastRefill + ((1 - tokens) * refillIntervalMs) / refillRate;
        return { allowed: false, remaining: 0, resetAt, limit: capacity };
      }

      tokens -= 1;
      // 200: instante de restauración completa.
      const resetAt = now + ((capacity - tokens) * refillIntervalMs) / refillRate;
      return { allowed: true, remaining: Math.floor(tokens), resetAt, limit: capacity };
    },
  };
}
