/**
 * Helpers compartidos por los scripts de experimento (exp-01..05, R12–R15).
 *
 * Unidades de tiempo internas: ms (coherentes con `Now`/fake clock). Las
 * latencias se miden con `performance.now()` alrededor de `limiter.allow()`
 * (más construcción del body), sub-ms en memoria.
 *
 * `writeJsonFile` resuelve rutas relativas a `src/` (p. ej. `../docs/...`)
 * independientemente del cwd, para que la evidencia machine-readable de exp-04
 * quede en `docs/output-04-burst.json` (versionado, NO gitignored).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Limiter } from "./rate-limit.ts";
import type { FakeClock } from "./clock.ts";

/** Redondea a 2 decimales (latencia honesta sub-ms). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percentil (0..100) sobre un array ordenado ascendentemente. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(sorted.length - 1, idx));
  return sorted[clamped]!;
}

/** Cronograma compartido de ráfaga cruzando el borde (exp-01/02/04). */
export function burstTimes(): number[] {
  const times: number[] = [];
  // Fase W0: 100 requests espaciados 100 ms, terminando en t=59900 (dentro de W0).
  for (let i = 0; i < 100; i++) times.push(50_000 + i * 100);
  // Fase W1/W2: 900 requests espaciados 100 ms, t=60000..149900 (cruza a W2 en 120000).
  for (let i = 0; i < 900; i++) times.push(60_000 + i * 100);
  return times;
}

export type RequestSample = {
  t: number;
  allowed: boolean;
  remaining: number;
  resetAt: number;
  latency: number;
};

export type RunResult = {
  ok: number;
  rejected: number;
  total: number;
  p95: number;
  p99: number;
  admitTimes: number[];
  rejectTimes: number[];
  samples: RequestSample[];
};

/** Ejecuta el limiter en cada timestamp del cronograma y mide latencia real. */
export function runAtTimes(
  limiter: Limiter,
  clock: FakeClock,
  times: number[],
): RunResult {
  let ok = 0;
  let rejected = 0;
  const admitTimes: number[] = [];
  const rejectTimes: number[] = [];
  const samples: RequestSample[] = [];

  for (const t of times) {
    clock.jump(t);
    const s = performance.now();
    const r = limiter.allow(clock.now());
    const latency = performance.now() - s;
    samples.push({ t, allowed: r.allowed, remaining: r.remaining, resetAt: r.resetAt, latency });
    if (r.allowed) {
      ok += 1;
      admitTimes.push(t);
    } else {
      rejected += 1;
      rejectTimes.push(t);
    }
  }

  const sorted = samples.map((x) => x.latency).sort((a, b) => a - b);
  return {
    ok,
    rejected,
    total: ok + rejected,
    p95: round2(percentile(sorted, 95)),
    p99: round2(percentile(sorted, 99)),
    admitTimes,
    rejectTimes,
    samples,
  };
}

/** Buckets temporales de admisiones (por defecto 10 s) → [startSec, endSec, admits]. */
export function timelineAdmits(
  admitTimes: number[],
  startMs: number,
  endMs: number,
  bucketMs = 10_000,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let s = startMs; s < endMs; s += bucketMs) {
    const e = Math.min(s + bucketMs, endMs);
    const count = admitTimes.filter((t) => t >= s && t < e).length;
    out.push([Math.floor(s / 1000), Math.floor(e / 1000), count]);
  }
  return out;
}

/** Escribe un archivo JSON de evidencia relativo a `src/` (p. ej. ../docs/...). */
export function writeJsonFile(relFromSrc: string, data: unknown): void {
  const target = fileURLToPath(new URL(relFromSrc, import.meta.url));
  writeFileSync(target, JSON.stringify(data, null, 2) + "\n", "utf8");
}
