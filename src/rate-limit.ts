/**
 * Contrato común de los tres algoritmos de rate limiting (R2, R6).
 *
 * Unidades internas: milisegundos (ms), coherentes con `Now` y el reloj
 * virtual de `src/clock.ts`. `api.ts` convierte `resetAt` a epoch segundos.
 */

/** Límite conceptual compartido: 100 req/min (R6, coherente con el README). */
export const WINDOW_MS = 60_000;

/** Número máximo de peticiones admitidas por ventana conceptual. */
export const LIMIT = 100;

/** Resultado observable de `allow()`. */
export type AllowResult = {
  /** true si la petición se admite; false en caso de rechazo (429). */
  allowed: boolean;
  /** >= 0; 0 en 429 (R10). */
  remaining: number;
  /** Epoch ms del instante en que `allow()` volverá a admitir. */
  resetAt: number;
  /** Límite de la ventana (para X-RateLimit-Limit). */
  limit: number;
};

/** Contrato común de los 3 algoritmos (R2): check+consume síncrono, atómico en el event loop. */
export type Limiter = { allow: (now: number) => AllowResult };
