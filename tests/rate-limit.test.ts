import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { createFakeClock } from "../src/clock.ts";
import { WINDOW_MS, LIMIT } from "../src/rate-limit.ts";
import { createFixedWindowLimiter } from "../src/fixed-window.ts";
import { createSlidingWindowLimiter } from "../src/sliding-window.ts";
import { createTokenBucketLimiter } from "../src/token-bucket.ts";
import { createRateLimitServer } from "../src/api.ts";

// ---------------------------------------------------------------------------
// Suite: token bucket (R5)
// ---------------------------------------------------------------------------
function tokenConfig() {
  return { capacity: LIMIT, refillRate: LIMIT / (WINDOW_MS / 1000), refillIntervalMs: 1000 };
}

test("token: ráfaga == capacidad — 100 consecutivos true, #101 false (R5)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.allow(clock.now()).allowed, true, `allow #${i + 1}`);
  }
  const rejected = limiter.allow(clock.now());
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.ok(rejected.resetAt > clock.now(), "resetAt > now en 429 (R10)");
});

test("token: advance(60000) → refill a capacidad (R5/R6)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  for (let i = 0; i < 100; i++) {
    limiter.allow(clock.now());
  }
  assert.equal(limiter.allow(clock.now()).allowed, false);
  clock.advance(60_000);
  const admitted = limiter.allow(clock.now());
  assert.equal(admitted.allowed, true);
  assert.equal(admitted.remaining, 99);
});

test("token: 100 requests espaciados 600 ms → todos true (refill sostiene 100/min, R5)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    clock.advance(600);
    if (limiter.allow(clock.now()).allowed) ok += 1;
  }
  assert.equal(ok, 100);
});

test("token: float — tras vaciar, 600 ms de refill → 1 token → admite, remaining floor (R5)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  for (let i = 0; i < 100; i++) {
    limiter.allow(clock.now());
  }
  assert.equal(limiter.allow(clock.now()).allowed, false);
  // Refill discreto por intervalos de 1000 ms: tras 600 ms aún no hay intervalo completo.
  clock.advance(600);
  assert.equal(limiter.allow(clock.now()).allowed, false, "600 ms < 1 intervalo de 1000 ms");
  // Tras 400 ms más (total 1000 ms) hay 1 intervalo completo → ~1.6667 tokens.
  clock.advance(400);
  const admitted = limiter.allow(clock.now());
  assert.equal(admitted.allowed, true);
  // Consume 1 → quedan ~0.6667 → remaining = floor(0.6667) = 0.
  assert.equal(admitted.remaining, 0);
});

test("token: burst == capacity luego rechazo sostenido, refill libera slots (R5)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  // 100 admitidas (ráfaga == capacidad).
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.allow(clock.now()).allowed, true);
  }
  // Sostenido sin refill → rechazo.
  let rejected = 0;
  for (let i = 0; i < 30; i++) {
    if (!limiter.allow(clock.now()).allowed) rejected += 1;
  }
  assert.equal(rejected, 30, "sostenido sin refill → 30 rechazos");
  // Refill de 6000 ms → 10 intervalos * 1.6667 = 16.667 → ~16 tokens → admite algunos.
  clock.advance(6000);
  let admittedAfter = 0;
  for (let i = 0; i < 30; i++) {
    if (limiter.allow(clock.now()).allowed) admittedAfter += 1;
  }
  assert.ok(admittedAfter >= 1, "tras refill de 6 s se admiten requests");
});

test("token: resetAt en 200 = instante de restauración completa; balde lleno → resetAt == now (R5)", () => {
  const clock = createFakeClock(0);
  const limiter = createTokenBucketLimiter(tokenConfig());
  // Balde lleno al inicio: resetAt = now (restauración ya completa).
  const first = limiter.allow(clock.now());
  assert.equal(first.allowed, true);
  // Después de 50 consumos (balde medio), resetAt = now + (capacity - tokens)*interval/rate > now.
  for (let i = 0; i < 49; i++) {
    limiter.allow(clock.now());
  }
  const half = limiter.allow(clock.now());
  assert.equal(half.allowed, true);
  assert.ok(half.resetAt > clock.now(), "resetAt (restauración completa) > now cuando no está lleno");
});


// ---------------------------------------------------------------------------
// Suite: sliding window (R4)
// ---------------------------------------------------------------------------
test("sliding: 100 entradas en (0,59999] → allow en t=60000 es false (intervalo contiene 100, R4)", () => {
  const clock = createFakeClock(0);
  const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  // 100 admisiones espaciadas en (0, 59999].
  for (let i = 1; i <= 100; i++) {
    clock.jump(i); // t=1..100
    assert.equal(limiter.allow(clock.now()).allowed, true, `allow #${i}`);
  }
  // Borde cerrado (R4): en t=60000 el intervalo (0,60000] aún contiene las 100
  // → la primera de la nueva ventana es rechazada.
  clock.jump(60_000);
  const rejected = limiter.allow(clock.now());
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.ok(rejected.resetAt > clock.now(), "resetAt > now en 429 (R10)");
});

test("sliding: en t=120000 allow vuelve a true (poda de [0,60000], R4/R6)", () => {
  const clock = createFakeClock(0);
  const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  for (let i = 1; i <= 100; i++) {
    clock.jump(i);
    limiter.allow(clock.now());
  }
  clock.jump(60_000);
  assert.equal(limiter.allow(clock.now()).allowed, false);
  // En t=120000 las entradas de [1,100] quedan fuera del intervalo → admite.
  clock.jump(120_000);
  assert.equal(limiter.allow(clock.now()).allowed, true);
});

test("sliding: invariante — nunca >100 admitidos en cualquier intervalo de 60 s (R4)", () => {
  const clock = createFakeClock(0);
  const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  let admitted = 0;
  for (let t = 1; t <= 60_000; t += 1) {
    clock.jump(t);
    if (limiter.allow(clock.now()).allowed) admitted += 1;
  }
  // En el intervalo (0,60000] caben exactamente 100; el resto se rechaza.
  assert.ok(admitted <= LIMIT, `admitidos ${admitted} <= 100`);
  assert.equal(admitted, 100);
});

test("sliding: poda — entradas viejas se eliminan dentro de allow()", () => {
  const clock = createFakeClock(0);
  const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  // Llenar la ventana con 100 admisiones en t=1..100.
  for (let i = 1; i <= 100; i++) {
    clock.jump(i);
    limiter.allow(clock.now());
  }
  // En t=60000 el intervalo aún las contiene → rechaza.
  clock.jump(60_000);
  assert.equal(limiter.allow(clock.now()).allowed, false);
  // Avanzar 60001ms más: cutoff = 120001 > todas las entradas → se podan → admite.
  clock.advance(60_001);
  const admitted = limiter.allow(clock.now());
  assert.equal(admitted.allowed, true);
});

test("sliding: resetAt = log[0] + windowMs > now en 429 (R10)", () => {
  const clock = createFakeClock(0);
  const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  // 100 admisiones en t=1..100 (ninguna en el borde 0, así ninguna se poda en cutoff=0).
  for (let i = 1; i <= 100; i++) {
    clock.jump(i);
    limiter.allow(clock.now());
  }
  clock.jump(60_000);
  const rejected = limiter.allow(clock.now());
  assert.equal(rejected.allowed, false);
  // La entrada más vieja es t=1 → resetAt = 1 + 60000 = 60001 > now(60000).
  assert.equal(rejected.resetAt, 1 + WINDOW_MS);
  assert.ok(rejected.resetAt > clock.now(), "resetAt > now en 429 (R10)");
});


// ---------------------------------------------------------------------------
// Suite: fixed window (R3)
// ---------------------------------------------------------------------------
test("fixed: floor(w/windowMs)*windowMs determina windowStart (100 → windowStart 0)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  const first = limiter.allow(clock.now());
  assert.equal(first.allowed, true);
  // En t=0 el primer resetAt es el siguiente borde (60000).
  assert.equal(first.resetAt, 60_000);
});

test("fixed: 100 allows → #101 false con remaining 0 y resetAt 60000 (R3)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.allow(clock.now()).allowed, true, `allow #${i + 1} debería admitir`);
  }
  const rejected = limiter.allow(clock.now());
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(rejected.resetAt, 60_000);
});

test("fixed: en t=60000 (inicio W1) allow vuelve a true con remaining 99 (R3/R6)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  for (let i = 0; i < 100; i++) {
    limiter.allow(clock.now());
  }
  assert.equal(limiter.allow(clock.now()).allowed, false);
  clock.jump(60_000);
  const admitted = limiter.allow(clock.now());
  assert.equal(admitted.allowed, true);
  assert.equal(admitted.remaining, 99);
});

test("fixed: remaining decreciente 99, 98, ... (R9)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  let expected = LIMIT - 1;
  for (let i = 0; i < 100; i++) {
    const r = limiter.allow(clock.now());
    assert.equal(r.remaining, expected, `remaining tras allow #${i + 1}`);
    expected -= 1;
  }
});

test("fixed: resetAt siempre > now en 429 (R10)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  for (let i = 0; i < 100; i++) {
    limiter.allow(clock.now());
  }
  const rejected = limiter.allow(clock.now());
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.resetAt > clock.now(), "resetAt > now");
});

test("fixed: carrera de borde — 100 en W0 + 100 en W1 → pasan los 200 (R3)", () => {
  const clock = createFakeClock(0);
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  // 100 requests en W0, muy juntas al final de la ventana (t=59999).
  clock.jump(59_999);
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.allow(clock.now()).allowed, true, `W0 allow #${i + 1}`);
  }
  // #101 en la MISMA ventana W0 → rechazado.
  assert.equal(limiter.allow(clock.now()).allowed, false);
  // Salto al inicio de W1 (t=60001): admite de nuevo 100.
  clock.jump(60_001);
  let admittedW1 = 0;
  for (let i = 0; i < 100; i++) {
    if (limiter.allow(clock.now()).allowed) admittedW1 += 1;
  }
  assert.equal(admittedW1, 100, "W1 debería admitir 100 requests");
});


// ---------------------------------------------------------------------------
// Suite: HTTP a nivel de servidor (R7–R10)
// ---------------------------------------------------------------------------
// STRICT TDD: esta suite se escribió ANTES de src/api.ts (RED — el import de
// api.ts no existía). Se implementó api.ts hasta GREEN. Servidor real sobre
// puerto efímero (listen(0)) con fetch real; teardown garantizado en after().
describe("http: servidor rate-limit (R7-R10)", () => {
  let clock: ReturnType<typeof createFakeClock>;
  let server: ReturnType<typeof createRateLimitServer>;
  let baseUrl: string;

  before(async () => {
    clock = createFakeClock(1_700_000_000_000); // epoch ms arbitrario y estable
    const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
    server = createRateLimitServer(limiter, { now: clock.now });
    await server.start();
    baseUrl = server.url;
  });

  after(async () => {
    await server.stop();
  });

  test("http: 100×GET / → 200 con X-RateLimit-* decrecientes (R9)", async () => {
    let expected = LIMIT - 1;
    for (let i = 0; i < 100; i++) {
      const res = await fetch(baseUrl);
      assert.equal(res.status, 200, `request #${i + 1} debería ser 200`);
      assert.equal(res.headers.get("x-ratelimit-limit"), String(LIMIT));
      assert.equal(res.headers.get("x-ratelimit-remaining"), String(expected));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      assert.ok(reset > clock.now() / 1000, `Reset (${reset}) > now (epoch seg)`);
      expected -= 1;
    }
  });

  test("http: #101 → 429 con Retry-After ≥1, Remaining 0, Reset > now (R8/R10)", async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("x-ratelimit-limit"), String(LIMIT));
    assert.equal(res.headers.get("x-ratelimit-remaining"), "0");
    const retryAfter = Number(res.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After (${retryAfter}) entero ≥ 1 (RFC 6585)`);
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    assert.ok(reset > clock.now() / 1000, "Reset > now en 429 (R10)");
  });

  test("http: path/método inesperado → 404 controlado sin crash (R10)", async () => {
    const resPath = await fetch(baseUrl + "nope");
    assert.equal(resPath.status, 404, "GET /nope → 404");
    assert.equal(JSON.parse(await resPath.text()).ok, false);
    const resMethod = await fetch(baseUrl, { method: "POST" });
    assert.equal(resMethod.status, 404, "POST / → 404");
    // Body arbitrario en un método que no consume cuota → 404 controlado (no crash).
    const resBad = await fetch(baseUrl, { method: "POST", body: "no-json-arbitrario" });
    assert.equal(resBad.status, 404, "POST / con body arbitrario → 404 (no crash)");
    assert.equal(JSON.parse(await resBad.text()).ok, false);
  });

  test("http: reset por ventana → jump(60000) → 200 con Remaining 99 (R6)", async () => {
    clock.jump(clock.now() + WINDOW_MS);
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-ratelimit-remaining"), "99");
  });
});

