/**
 * exp-03 · Token Bucket (R5, R12, R13) → docs/output-03-token.txt
 *
 * Tres fases con reloj virtual acelerado:
 *   (A) ráfaga corta — 30 requests espaciados 600 ms. Como el refill repone
 *       1 token cada 600 ms (100/60 s), el consumo se compensa: todas pasan.
 *   (B) ráfaga sostenida — 130 requests espaciados 50 ms: el consumo supera al
 *       refill, el balde se vacía → las primeras ~100 pasan y las siguientes
 *       reciben 429 (ráfaga == capacidad; sostenido = rechazo).
 *   (C) refill — advance(6000) repone ~10 tokens → 10 pasan y 10 reciben 429.
 *
 * Los totales ok/429 son deterministas (reloj virtual); solo las latencias
 * varían entre corridas.
 */
import { createFakeClock } from "./clock.ts";
import { LIMIT, WINDOW_MS } from "./rate-limit.ts";
import { createTokenBucketLimiter } from "./token-bucket.ts";
import { runAtTimes, round2 } from "./evidence.ts";
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
      text: s.allowed ? "admitir (tokens >= 1)" : "rechazar (429)",
      detail: s.allowed
        ? `remaining=${s.remaining}`
        : `remaining=0, próximo token en ${s.resetAt} ms`,
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
const limiter = createTokenBucketLimiter({
  capacity: LIMIT,
  refillRate: LIMIT / (WINDOW_MS / 1000), // 100 tokens por 60 s
  refillIntervalMs: 1000,
});

printBanner("LAB-04 · exp-03 · Token Bucket — ráfaga vs. sostenido vs. refill");

// ── Fase A: ráfaga corta (30 × 600 ms) ──────────────────────────────────────
const phaseA: number[] = [];
for (let i = 0; i < 30; i++) phaseA.push(i * 600); // t=0..17400
const runA = runAtTimes(limiter, clock, phaseA);
console.log(`· Fase A — ráfaga corta (30 × 600 ms): ok=${runA.ok} 429=${runA.rejected}`);

// ── Fase B: ráfaga sostenida (130 × 50 ms) ──────────────────────────────────
const phaseB: number[] = [];
for (let i = 0; i < 130; i++) phaseB.push(18_000 + i * 50); // t=18000..24450
const runB = runAtTimes(limiter, clock, phaseB);
console.log(`· Fase B — ráfaga sostenida (130 × 50 ms): ok=${runB.ok} 429=${runB.rejected}`);

// ── Fase C: refill tras advance(6000) ───────────────────────────────────────
clock.advance(6_000); // ~10 tokens (6 intervalos × 1.6667)
const runC = runAtTimes(limiter, clock, Array(20).fill(clock.now()));
console.log(`· Fase C — tras advance(6000): ok=${runC.ok} 429=${runC.rejected}`);

// ── Trazas representativas con numeración global ────────────────────────────
const all = [...runA.samples, ...runB.samples, ...runC.samples];
const reps = [0, 29, 30, 129, 130, 139, 140, 159]; // #1, #30, #31, #130, #131, #140, #141, #160
console.log("· Trazas representativas ·");
for (const idx of reps) {
  printTrace(traceFor(all[idx]!), idx);
}

// ── Totales agregados ───────────────────────────────────────────────────────
const totalOk = runA.ok + runB.ok + runC.ok;
const totalRej = runA.rejected + runB.rejected + runC.rejected;
const allLat = all.map((s) => s.latency).sort((a, b) => a - b);
const pct = (p: number) => round2(allLat[Math.min(allLat.length - 1, Math.max(0, Math.ceil((p / 100) * allLat.length) - 1))]!);

printSummary({
  title: "Token Bucket",
  stats: [
    ["total", String(all.length)],
    ["ok", String(totalOk)],
    ["429", String(totalRej)],
    ["p95", `${pct(95)} ms`],
    ["p99", `${pct(99)} ms`],
    ["A ok", String(runA.ok)],
    ["B ok", String(runB.ok)],
    ["C ok", String(runC.ok)],
  ],
  anomalies: [
    { text: runA.ok === 30 ? "ráfaga corta pasa completa (refill compensa)" : "fase A parcial", cls: runA.ok === 30 ? "ok" : "warn" },
    { text: runB.rejected > 0 ? "sostenido vacía el balde → 429" : "sin rechazos en B", cls: runB.rejected > 0 ? "warn" : "info" },
    { text: runC.ok >= 1 ? "refill repone tokens → vuelve a admitir" : "sin refill", cls: "ok" },
  ],
  verdict:
    runA.ok === 30 && runB.rejected > 0 && runC.ok >= 1
      ? "ráfaga = capacidad, sostenido = 429, refill recupera"
      : "revisar fases",
  verdictCls: runA.ok === 30 && runB.rejected > 0 && runC.ok >= 1 ? "ok" : "warn",
});