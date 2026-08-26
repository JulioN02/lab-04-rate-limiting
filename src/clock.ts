/**
 * Reloj inyectable (R1). Los limiters reciben el tiempo por parámetro en cada
 * llamada y NUNCA usan setTimeout/setInterval (determinismo, sin timers).
 */

/** Epoch milliseconds. */
export type Now = () => number;

/** Reloj real basado en Date.now(). */
export const realNow: Now = () => Date.now();

/** Reloj virtual controlable para scripts de experimento y tests. */
export type FakeClock = {
  /** Devuelve el tiempo virtual actual. */
  now: Now;
  /** Avanza el tiempo virtual (delta >= 0; negativo -> throw). */
  advance: (deltaMs: number) => void;
  /** Posiciona en un instante absoluto (para cruzar bordes de ventana). */
  jump: (targetMs: number) => void;
};

/** Crea un reloj virtual que comienza en `startMs` (por defecto 0). */
export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;

  return {
    now: () => current,
    advance: (deltaMs: number) => {
      if (deltaMs < 0) {
        throw new Error(`advance() con delta negativo (${deltaMs}) no está permitido`);
      }
      current += deltaMs;
    },
    jump: (targetMs: number) => {
      current = targetMs;
    },
  };
}
