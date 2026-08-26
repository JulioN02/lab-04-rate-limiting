import type { AllowResult, Limiter } from "./rate-limit.ts";

/** Configuración del limiter de ventana fija (R3). */
export type FixedWindowConfig = {
  windowMs: number;
  limit: number;
};

/**
 * Limiter de ventana fija (R3).
 *
 * windowStart = floor(now/windowMs) * windowMs; el reset se hace POR COMPARACIÓN
 * de ventana (no por timer). Los rechazos NO incrementan `count`.
 */
export function createFixedWindowLimiter(config: FixedWindowConfig): Limiter {
  const { windowMs, limit } = config;

  let windowStart = Math.floor(0 / windowMs) * windowMs;
  let count = 0;

  return {
    allow(now: number): AllowResult {
      const start = Math.floor(now / windowMs) * windowMs;
      if (start !== windowStart) {
        // Reset por comparación de ventana: nueva ventana, contador a cero.
        windowStart = start;
        count = 0;
      }

      if (count >= limit) {
        // Rechazo: NO se incrementa el contador.
        return { allowed: false, remaining: 0, resetAt: windowStart + windowMs, limit };
      }

      count += 1;
      return { allowed: true, remaining: limit - count, resetAt: windowStart + windowMs, limit };
    },
  };
}
