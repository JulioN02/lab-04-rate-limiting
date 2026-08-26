import type { AllowResult, Limiter } from "./rate-limit.ts";

/** Configuración del limiter de ventana deslizante (R4). */
export type SlidingWindowConfig = {
  windowMs: number;
  limit: number;
};

/**
 * Limiter de ventana deslizante con log de timestamps (R4).
 *
 * Intervalo evaluado: (now - windowMs, now] — exacto, sin aproximación.
 * Rechaza si hay >= limit entradas en el intervalo. Solo las peticiones
 * ADMITIDAS entran al log (ordenado por construcción).
 *
 * COMPROMISO MEMORIA vs. EXACTITUD: el log crece con el tráfico de la ventana
 * (O(ventana)); la poda dentro de allow() es amortizada O(1) por entrada
 * (cada entrada se elimina una sola vez). Se eligió la versión exacta para
 * poder verificar el invariante (guía 6.3); los precision sets quedan fuera
 * de alcance.
 */
export function createSlidingWindowLimiter(config: SlidingWindowConfig): Limiter {
  const { windowMs, limit } = config;

  // Timestamps (ms) de las admisiones, ordenados por construcción.
  const log: number[] = [];

  return {
    allow(now: number): AllowResult {
      const cutoff = now - windowMs;
      // Poda: elimina las entradas que ya salieron de la ventana (amortizado O(1)).
      while (log.length > 0 && log[0]! <= cutoff) {
        log.shift();
      }

      if (log.length >= limit) {
        // Rechazo ⇒ log.length >= 1, así log[0] es seguro (noUncheckedIndexedAccess).
        return { allowed: false, remaining: 0, resetAt: log[0]! + windowMs, limit };
      }

      log.push(now); // solo las admitidas entran al log
      return { allowed: true, remaining: limit - log.length, resetAt: (log[0] ?? now) + windowMs, limit };
    },
  };
}
