/**
 * exp-05 · Cliente respetuoso vs. ciego (R15) → docs/output-05-client.txt
 *
 * Dos instancias independientes del MISMO api.ts (createRateLimitServer) con
 * limiter token bucket y fake clock propio, puertos efímeros (listen(0)),
 * teardown garantizado en finally.
 *
 *   1. Cliente CIEGO: 120 requests vía fetch sin esperas ni avance de reloj →
 *      100 ok + 20 429 (el balde se agota y no se respeta el aviso).
 *   2. Cliente RESPETUOSO: 120 requests; al recibir 429 lee
 *      Retry-After / X-RateLimit-Remaining y AVANZA su reloj virtual el tiempo
 *      anunciado antes de reintentar → muchos menos 429 (el refill del bucket
 *      se acelera para la demo sin cambiar el límite conceptual).
 *
 * Invariante demostrado: 429s(respetuoso) < 429s(cego).
 */
import { createFakeClock } from "./clock.ts";
import { LIMIT, WINDOW_MS } from "./rate-limit.ts";
import { createTokenBucketLimiter } from "./token-bucket.ts";
import { createRateLimitServer } from "./api.ts";
import {
  printBanner,
  printTrace,
  printSummary,
  type TraceEntry,
} from "./reporter.ts";

type HttpSample = {
  n: number;
  status: number;
  remaining: string | null;
  retryAfter: string | null;
  latencyMs: number;
  client: "ciego" | "respetuoso";
};

function traceFor(s: HttpSample, note?: string): TraceEntry[] {
  const is429 = s.status === 429;
  const trace: TraceEntry[] = [
    { kind: "input", text: "GET /", detail: `cliente ${s.client} · request #${s.n} · latencia ${s.latencyMs.toFixed(2)} ms` },
    {
      kind: "decision",
      text: is429 ? "rechazar (429)" : "admitir (200)",
      detail: is429
        ? `X-RateLimit-Remaining=${s.remaining ?? "-"} · Retry-After=${s.retryAfter ?? "-"}`
        : `X-RateLimit-Remaining=${s.remaining ?? "-"}`,
      cls: is429 ? "bad" : "ok",
    },
    {
      kind: "output",
      text: is429 ? `429 Too Many Requests (Retry-After ${s.retryAfter ?? "-"} s)` : "200 OK",
      cls: is429 ? "bad" : "ok",
    },
    {
      kind: "result",
      text: note ?? (is429 ? "el cliente respetuoso esperará Retry-After antes de reintentar" : "consumo de cuota"),
      cls: is429 ? "warn" : "ok",
    },
  ];
  return trace;
}

const T0 = 1_700_000_000_000;

// ── Instancias del servidor ─────────────────────────────────────────────────
const clockBlind = createFakeClock(T0);
const serverBlind = createRateLimitServer(
  createTokenBucketLimiter({ capacity: LIMIT, refillRate: LIMIT / (WINDOW_MS / 1000), refillIntervalMs: 1000 }),
  { now: clockBlind.now },
);

const clockRespect = createFakeClock(T0);
const serverRespect = createRateLimitServer(
  createTokenBucketLimiter({ capacity: LIMIT, refillRate: LIMIT / (WINDOW_MS / 1000), refillIntervalMs: 1000 }),
  { now: clockRespect.now },
);

async function main(): Promise<void> {
  const blindSamples: HttpSample[] = [];
  const respectSamples: HttpSample[] = [];

  try {
    await serverBlind.start();
    await serverRespect.start();
    printBanner("LAB-04 · exp-05 · Cliente respetuoso (Retry-After) vs. ciego");

    // ── Cliente ciego: sin esperas, sin avanzar el reloj ───────────────────
    console.log("· Cliente CIEGO: 120 requests sin respetar Retry-After ·");
    for (let n = 1; n <= 120; n++) {
      const s = performance.now();
      const res = await fetch(serverBlind.url);
      blindSamples.push({
        n,
        status: res.status,
        remaining: res.headers.get("x-ratelimit-remaining"),
        retryAfter: res.headers.get("retry-after"),
        latencyMs: performance.now() - s,
        client: "ciego",
      });
    }
    const blind429 = blindSamples.filter((x) => x.status === 429).length;
    console.log(`  resultado: ok=${120 - blind429} · 429=${blind429}`);
    for (const idx of [0, 99, 100, 119]) {
      printTrace(traceFor(blindSamples[idx]!), idx);
    }

    // ── Cliente respetuoso: lee headers y avanza su reloj virtual ──────────
    console.log("· Cliente RESPETUOSO: 120 requests; en 429 avanza el reloj virtual Retry-After s antes de reintentar ·");
    let n = 0;
    while (n < 120) {
      n += 1;
      const s = performance.now();
      const res = await fetch(serverRespect.url);
      const retryAfter = res.headers.get("retry-after");
      respectSamples.push({
        n,
        status: res.status,
        remaining: res.headers.get("x-ratelimit-remaining"),
        retryAfter,
        latencyMs: performance.now() - s,
        client: "respetuoso",
      });
      if (res.status === 429 && retryAfter !== null) {
        // Espera virtual = Retry-After segundos anunciados (refill acelerado).
        clockRespect.advance(Number(retryAfter) * 1000);
      }
    }
    const respect429 = respectSamples.filter((x) => x.status === 429).length;
    console.log(`  resultado: ok=${120 - respect429} · 429=${respect429}`);
    const reps = respectSamples
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.status === 429)
      .slice(0, 3)
      .map(({ i }) => i);
    for (const idx of reps) {
      printTrace(traceFor(respectSamples[idx]!, "espera virtual = Retry-After s; reintento posterior"), idx);
    }
    printTrace(traceFor(respectSamples[respectSamples.length - 1]!), respectSamples.length - 1);

    // ── Resumen comparativo ────────────────────────────────────────────────
    printSummary({
      title: "Cliente respetuoso vs. ciego",
      stats: [
        ["requests", "120 / 120"],
        ["ciego 429", String(blind429)],
        ["respetuoso 429", String(respect429)],
        ["reducción", `${(100 * (1 - respect429 / blind429)).toFixed(1)} %`],
      ],
      anomalies:
        respect429 < blind429
          ? [{ text: `429s(respetuoso)=${respect429} < 429s(cego)=${blind429}`, cls: "ok" }]
          : [{ text: "el respetuoso NO redujo sus 429", cls: "bad" }],
      verdict:
        respect429 < blind429
          ? "respetar Retry-After/X-RateLimit-Remaining reduce los rechazos"
          : "revisar estrategia del cliente",
      verdictCls: respect429 < blind429 ? "ok" : "bad",
    });
  } finally {
    // Teardown garantizado: puertos efímeros liberados aunque algo falle.
    await serverBlind.stop();
    await serverRespect.stop();
  }
}

await main();