/**
 * exp-04 · Comparativa de ráfaga (R14, R17) → docs/output-04-burst.txt
 *          + docs/output-04-burst.json (BurstReport machine-readable)
 *
 * Un ÚNICO cronograma compartido (el de exp-01/02: 100×100 ms en W0 +
 * jump(60000) + 900×100 ms) corrido contra los 3 algoritmos. Emite la tabla
 * comparativa (total/ok/429/p95/p99/distribución) y el contrato BurstReport
 * (meta/fixed/sliding/tokenBucket) que el dashboard de la Fase 7 embebe.
 *
 * docs/output-04-burst.txt sale por stdout (redirección del script evidence);
 * docs/output-04-burst.json se escribe directo (evidencia versionable, NO
 * gitignored) para que la Fase 7 lo copie a docs/dashboard/app.js.
 */
import { createFakeClock } from "./clock.ts";
import { WINDOW_MS, LIMIT } from "./rate-limit.ts";
import type { Limiter } from "./rate-limit.ts";
import { createFixedWindowLimiter } from "./fixed-window.ts";
import { createSlidingWindowLimiter } from "./sliding-window.ts";
import { createTokenBucketLimiter } from "./token-bucket.ts";
import { runAtTimes, burstTimes, timelineAdmits, writeJsonFile } from "./evidence.ts";
import { printBanner, printSummary } from "./reporter.ts";

type AlgoResult = {
  total: number;
  ok: number;
  rejected: number;
  p95: number;
  p99: number;
  note: string;
  timeline: Array<[number, number, number]>;
};

type BurstReport = {
  meta: { source: "exp-04"; pattern: string; generatedAt: string; windowMs: number; limit: number };
  fixed: AlgoResult;
  sliding: AlgoResult;
  tokenBucket: AlgoResult;
};

function algoResult(
  limiter: Limiter,
  note: string,
): AlgoResult {
  const clock = createFakeClock(0);
  const run = runAtTimes(limiter, clock, burstTimes());
  return {
    total: run.total,
    ok: run.ok,
    rejected: run.rejected,
    p95: run.p95,
    p99: run.p99,
    note,
    timeline: timelineAdmits(run.admitTimes, 0, 150_000, 10_000),
  };
}

printBanner("LAB-04 · exp-04 · Comparativa de ráfaga (3 algoritmos, mismo cronograma)");

const fixed = algoResult(
  createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT }),
  "Ventana fija: ráfaga de 100 por ventana; al cruzar el borde W1 admite 100 y rechaza el resto hasta la siguiente ventana.",
);
const sliding = algoResult(
  createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT }),
  "Ventana deslizante: el borde está cerrado (sin ráfaga de borde); las admisiones envejecen y liberan slots gradualmente.",
);
const tokenBucket = algoResult(
  createTokenBucketLimiter({ capacity: LIMIT, refillRate: LIMIT / (WINDOW_MS / 1000), refillIntervalMs: 1000 }),
  "Token bucket: ráfaga == capacidad; el sostenido agota el balde y se rechaza hasta que el refill repone tokens.",
);

// ── Tabla comparativa ───────────────────────────────────────────────────────
const rows: Array<[string, AlgoResult]> = [
  ["fixed", fixed],
  ["sliding", sliding],
  ["tokenBucket", tokenBucket],
];
console.log("· Tabla comparativa (mismo cronograma: 1000 requests) ·");
console.log("  algoritmo    total   ok   429    p95(ms)   p99(ms)");
for (const [name, r] of rows) {
  console.log(
    `  ${name.padEnd(11)} ${String(r.total).padStart(5)} ${String(r.ok).padStart(4)} ${String(r.rejected).padStart(5)} ${String(r.p95).padStart(8)} ${String(r.p99).padStart(8)}`,
  );
}

console.log();
console.log("· Distribución temporal (admisiones por bucket de 10 s) ·");
console.log(`  bucket        ${fixed.timeline.map(([a, b]) => `${a}-${b}s`.padStart(9)).join("")}`);
console.log(`  fixed         ${fixed.timeline.map(([, , n]) => String(n).padStart(9)).join("")}`);
console.log(`  sliding       ${sliding.timeline.map(([, , n]) => String(n).padStart(9)).join("")}`);
console.log(`  tokenBucket   ${tokenBucket.timeline.map(([, , n]) => String(n).padStart(9)).join("")}`);

const report: BurstReport = {
  meta: {
    source: "exp-04",
    pattern: "burst: 100×100ms en W0 + jump(60000) + 900×100ms (W1/W2)",
    generatedAt: new Date().toISOString(),
    windowMs: WINDOW_MS,
    limit: LIMIT,
  },
  fixed,
  sliding,
  tokenBucket,
};

// Bloque EVIDENCIA_JSON en una sola línea dentro del .txt (para copiar al dashboard).
console.log();
console.log(`EVIDENCIA_JSON ${JSON.stringify(report)}`);

// Archivo machine-readable versionable (NO gitignored) para la Fase 7.
writeJsonFile("../docs/output-04-burst.json", report);
console.log("· BurstReport escrito en docs/output-04-burst.json");

printSummary({
  title: "Comparativa de ráfaga",
  stats: [
    ["fixed", `${fixed.ok} ok / ${fixed.rejected} 429`],
    ["sliding", `${sliding.ok} ok / ${sliding.rejected} 429`],
    ["tokenBucket", `${tokenBucket.ok} ok / ${tokenBucket.rejected} 429`],
  ],
  anomalies: [
    { text: "fixed admite la ráfaga de borde", cls: fixed.ok > sliding.ok ? "ok" : "info" },
    { text: "sliding sin ráfaga de borde", cls: sliding.rejected > fixed.rejected ? "warn" : "info" },
    { text: "tokenBucket rellena por refill", cls: "info" },
  ],
  verdict: "3 algoritmos sobre el mismo patrón; invariantes garantizados por los tests",
  verdictCls: "ok",
});