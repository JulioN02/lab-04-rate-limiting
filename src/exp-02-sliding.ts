/**
 * exp-02 · Sliding Window (R4, R12, R13) → docs/output-02-sliding.txt
 *
 * Mismo cronograma que exp-01 (100×100 ms en W0 + jump(60000) + 900×100 ms).
 * Contrasta con fixed: en t=60000 el intervalo (0,60000] aún contiene las 100
 * admisiones → la primera de W1 es RECHAZADA (borde cerrado). Las entradas
 * envejecen a partir de t=110000 (log[0]=50000 sale de la ventana) y liberan
 * slots uno por request; en t=120000 el borde W2 vuelve a estar cerrado porque
 * las admisiones de 110000..119900 siguen dentro del intervalo.
 *
 * Reloj virtual acelerado: sin esperas reales de 60 s.
 */
import { createFakeClock } from "./clock.ts";
import { WINDOW_MS, LIMIT } from "./rate-limit.ts";
import { createSlidingWindowLimiter } from "./sliding-window.ts";
import { runAtTimes, burstTimes, timelineAdmits } from "./evidence.ts";
import {
  printBanner,
  printTrace,
  printSummary,
  type TraceEntry,
} from "./reporter.ts";

function traceFor(s: { t: number; allowed: boolean; remaining: number; resetAt: number }): TraceEntry[] {
  const trace: TraceEntry[] = [
    { kind: "input", text: "GET /", detail: `t=${s.t} ms` },
    {
      kind: "decision",
      text: s.allowed ? "admitir (intervalo (now-60s, now] con slots)" : "rechazar (429)",
      detail: s.allowed
        ? `remaining=${s.remaining}`
        : `remaining=0, resetAt=${s.resetAt}`,
      cls: s.allowed ? "ok" : "bad",
    },
    {
      kind: "output",
      text: s.allowed ? "200 OK" : "429 Too Many Requests",
      detail: s.allowed
        ? `X-RateLimit-Remaining=${s.remaining}`
        : "Retry-After >= 1 (RFC 6585)",
      cls: s.allowed ? "ok" : "bad",
    },
    {
      kind: "result",
      text: s.allowed ? "quota consumida" : "petición rechazada",
      cls: s.allowed ? "ok" : "bad",
    },
  ];
  return trace;
}

const clock = createFakeClock(0);
const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });

printBanner("LAB-04 · exp-02 · Sliding Window — borde cerrado y envejecimiento");

const times = burstTimes();
const run = runAtTimes(limiter, clock, times);

// Trazas representativas: #1, #100 (última W0), #101 (primera W1 → rechazada,
// borde cerrado), #600 (t=119900, envejecimiento libera slot), #601 (t=120000,
// borde W2 cerrado de nuevo).
const reps = [0, 99, 100, 599, 600];
console.log("· Trazas representativas del cronograma ·");
for (const idx of reps) {
  printTrace(traceFor(run.samples[idx]!), idx);
}

// Conteo por ventana conceptual (solo referencia; la ventana real es deslizante).
const windowCount = (start: number, end: number) =>
  run.admitTimes.filter((t) => t >= start && t < end).length;
const w0 = windowCount(0, WINDOW_MS);
const w1 = windowCount(WINDOW_MS, 2 * WINDOW_MS);
const w2 = windowCount(2 * WINDOW_MS, 3 * WINDOW_MS);

// Envejecimiento: admisiones entre t=110000 y t=119900 (las 100 de W0 salen del intervalo).
const agingAdmits = run.admitTimes.filter((t) => t >= 110_000 && t < 120_000).length;

const timeline = timelineAdmits(run.admitTimes, 0, 150_000, 10_000);
console.log("· Distribución temporal (admisiones por bucket de 10 s) ·");
console.log("  " + timeline.map(([a, b, n]) => `${a}-${b}s:${n}`).join("  "));

printSummary({
  title: "Sliding Window",
  stats: [
    ["total", String(run.total)],
    ["ok", String(run.ok)],
    ["429", String(run.rejected)],
    ["p95", `${run.p95} ms`],
    ["p99", `${run.p99} ms`],
    ["W0 ok", String(w0)],
    ["W1 ok", String(w1)],
    ["W2 ok", String(w2)],
    ["aging 110-120s", String(agingAdmits)],
  ],
  anomalies: [
    { text: "borde cerrado en t=60000 (W1)", cls: "info" },
    { text: `envejecimiento libera ${agingAdmits} slots`, cls: agingAdmits > 0 ? "ok" : "warn" },
  ],
  verdict:
    agingAdmits > 0
      ? "ventana deslizante: sin ráfaga de borde; liberación gradual por envejecimiento"
      : "revisar envejecimiento",
  verdictCls: agingAdmits > 0 ? "ok" : "warn",
});