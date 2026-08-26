/**
 * exp-01 · Fixed Window (R3, R12, R13) → docs/output-01-fixed.txt
 *
 * Cronograma compartido: 100 requests espaciados 100 ms en W0 (t=50000..59900),
 * jump(60000) al inicio de W1, y 900 requests espaciados 100 ms (t=60000..149900,
 * cruza a W2 en t=120000). Narra la carrera de límites: 100 en W0 + 100 en W1
 * pasan (ventanas distintas, R3), el resto 429; W2 vuelve a admitir 100.
 *
 * Reloj virtual acelerado: cruza los bordes de 60 s SIN esperar tiempo real.
 */
import { createFakeClock } from "./clock.ts";
import { WINDOW_MS, LIMIT } from "./rate-limit.ts";
import { createFixedWindowLimiter } from "./fixed-window.ts";
import {
  runAtTimes,
  burstTimes,
  timelineAdmits,
} from "./evidence.ts";
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
      text: s.allowed ? "admitir (quota disponible)" : "rechazar (429)",
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
const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });

printBanner("LAB-04 · exp-01 · Fixed Window — ráfaga cruzando el borde");

const times = burstTimes();
const run = runAtTimes(limiter, clock, times);

// Trazas representativas: #1, #100 (última W0), #101 (primera W1), #600 (última
// W1), #601 (primera W2, cruce de borde).
const reps = [0, 99, 100, 599, 600];
console.log("· Trazas representativas del cronograma ·");
for (const idx of reps) {
  printTrace(traceFor(run.samples[idx]!), idx);
}

// Conteo por ventana (fixed): W0 [0,60000), W1 [60000,120000), W2 [120000,180000).
const windowCount = (start: number, end: number) =>
  run.admitTimes.filter((t) => t >= start && t < end).length;
const w0 = windowCount(0, WINDOW_MS);
const w1 = windowCount(WINDOW_MS, 2 * WINDOW_MS);
const w2 = windowCount(2 * WINDOW_MS, 3 * WINDOW_MS);
const rejectedW1 = run.rejectTimes.filter((t) => t >= WINDOW_MS && t < 2 * WINDOW_MS).length;
const rejectedW2 = run.rejectTimes.filter((t) => t >= 2 * WINDOW_MS).length;

const timeline = timelineAdmits(run.admitTimes, 0, 150_000, 10_000);
console.log("· Distribución temporal (admisiones por bucket de 10 s) ·");
console.log("  " + timeline.map(([a, b, n]) => `${a}-${b}s:${n}`).join("  "));

printSummary({
  title: "Fixed Window",
  stats: [
    ["total", String(run.total)],
    ["ok", String(run.ok)],
    ["429", String(run.rejected)],
    ["p95", `${run.p95} ms`],
    ["p99", `${run.p99} ms`],
    ["W0 ok", String(w0)],
    ["W1 ok", String(w1)],
    ["W2 ok", String(w2)],
    ["W1 429", String(rejectedW1)],
    ["W2 429", String(rejectedW2)],
  ],
  anomalies:
    w0 === 100 && w1 === 100 && w2 === 100
      ? [{ text: "carrera de borde respetada (100+100)", cls: "ok" }]
      : [{ text: "conteo de ventana inesperado", cls: "warn" }],
  verdict:
    w0 === 100 && w1 === 100 && w2 === 100
      ? "ventana fija: 100 por ventana, reset por borde"
      : "revisar conteos",
  verdictCls: "ok",
});
