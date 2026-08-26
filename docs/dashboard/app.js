/* ================= LAB-04 · Rate Limiting — app.js =================
   Tabs de código + 3 simulaciones animadas + render de datos comparativos.
     sim-fixed   (02a) fixed window   → carrera de límites: 200 pasan en el borde
     sim-sliding (02b) sliding window → cualquier intervalo de 60 s: el borde queda cerrado
     sim-token   (02c) token bucket   → ráfaga corta (pasa) vs. sostenida (vacía el balde → 429)
   Sección 06 renderiza BURST_REPORT: la evidencia REAL de exp-04 copiada
   desde docs/output-04-burst.txt (misma estructura meta/fixed/sliding/tokenBucket).
   Convención: texto visible en español neutro; identificadores y comentarios en inglés.
============================================================================ */

/* ================= helpers ================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setTxt(host, html) {
  const t = $(".sim-txt", host);
  if (t) t.innerHTML = html;
}
function setStat(host, sel, val) {
  const el = $(sel, host);
  if (el) el.textContent = val;
}
function setPhase(scope, phase, variant) {
  $$(".cline", scope).forEach((l) => l.classList.remove("run", "win", "lose"));
  if (!phase) return;
  $$(`.cline[data-phase="${phase}"]`, scope).forEach((l) =>
    l.classList.add(variant || "run")
  );
}
function verdict(host, cls, html) {
  const v = $(".sol-verdict", host);
  if (!v) return;
  v.hidden = false;
  v.className = "sol-verdict " + cls;
  v.innerHTML = html;
}
/* execution scope: the article (algorithm card) or the section */
const scopeOf = (host) => host.closest("article") || host.closest("section") || host;

/* —— windows (sim-fixed) —— */
function buildWindows(host) {
  const row = $(".sim-windows", host);
  row.innerHTML = "";
  const names = ["W0 · 00:00–00:01", "W1 · 00:01–00:02"];
  names.forEach((name, wi) => {
    const win = document.createElement("div");
    win.className = "win";
    win.dataset.win = String(wi);
    win.innerHTML =
      `<div class="w-title"><span class="w-name">${name}</span>` +
      `<span class="w-count">0 / 100</span></div>` +
      `<div class="wcells"></div>`;
    const cells = $(".wcells", win);
    for (let i = 0; i < 10; i++) {
      const c = document.createElement("div");
      c.className = "wcell";
      c.textContent = "10";
      cells.appendChild(c);
    }
    row.appendChild(win);
  });
}
function setWinCount(host, wi, n) {
  const el = $(`.win[data-win="${wi}"] .w-count`, host);
  if (el) el.textContent = `${n} / 100`;
}
function setWinCell(host, wi, i, cls) {
  const c = $$(`.win[data-win="${wi}"] .wcell`, host)[i];
  if (c) c.className = "wcell " + cls;
}

/* —— timeline (sim-sliding) —— */
const TL_GROUP1 = 10; // requests at the tail of W0 (t ≈ 49–59 s)
const TL_GROUP2 = 10; // requests at the head of W1 (t ≈ 61–70 s)

function buildTimeline(host) {
  const el = $(".sim-timeline", host);
  el.innerHTML =
    `<div class="tl-axis"><span>t=0</span><span>t=60 s (borde)</span><span>t=120 s</span></div>` +
    `<div class="tl-track">` +
    `<div class="tl-frame" style="left:0%"><span class="tl-f-label">últimos 60 s</span></div>` +
    `<div class="tl-now" style="left:41%"><span class="tl-now-label">now</span></div>` +
    `</div>`;
  const track = $(".tl-track", el);
  for (let i = 0; i < TL_GROUP1; i++) {
    const d = document.createElement("div");
    d.className = "tl-dot";
    d.dataset.g = "1";
    d.textContent = "10";
    d.style.left = (41 + i * 0.9) + "%";
    track.appendChild(d);
  }
  for (let i = 0; i < TL_GROUP2; i++) {
    const d = document.createElement("div");
    d.className = "tl-dot";
    d.dataset.g = "2";
    d.textContent = "10";
    d.style.left = (51 + i * 0.9) + "%";
    track.appendChild(d);
  }
}
function setDot(host, g, i, cls) {
  const d = $$(`.tl-dot[data-g="${g}"]`, host)[i];
  if (d) d.className = "tl-dot " + cls;
}
function setFrame(host, leftPct) {
  const f = $(".tl-frame", host);
  if (f) f.style.left = leftPct + "%";
}
function setNow(host, leftPct) {
  const n = $(".tl-now", host);
  if (n) n.style.left = leftPct + "%";
}

/* —— bucket (sim-token) —— */
const BUCKET_CELLS = 10; // each cell = 10 tokens (capacity 100)

function buildBucket(host) {
  const el = $(".sim-bucket", host);
  el.innerHTML =
    `<div class="bk-head"><span>Capacidad 100 · refill 1,67 tokens/s</span>` +
    `<span class="bk-count">Tokens: <b>100</b> / 100</span></div>` +
    `<div class="bk-cells"></div>`;
  const cells = $(".bk-cells", el);
  for (let i = 0; i < BUCKET_CELLS; i++) {
    const c = document.createElement("div");
    c.className = "bk-cell tok";
    c.textContent = "10";
    cells.appendChild(c);
  }
}
function setBucketTokens(host, tokens) {
  const el = $(".sim-bucket", host);
  const cells = $$(".bk-cell", el);
  cells.forEach((c, i) => {
    if (i * 10 < tokens) c.className = "bk-cell tok";
    else if (i * 10 < BUCKET_CELLS * 10) c.className = "bk-cell used";
    else c.className = "bk-cell empty";
  });
  const count = $(".bk-count", el);
  if (count) count.innerHTML = `Tokens: <b>${tokens}</b> / 100`;
  setStat(host, ".sim-tokens", String(tokens));
}

/* ================= SIMULACIONES ================= */
const simRunners = {
  /* (a) 02a · fixed window — la carrera de límites */
  "sim-fixed": async function (host) {
    const scope = scopeOf(host);
    buildWindows(host);
    const btn = $(".sim-run", host);
    btn.disabled = true;
    setPhase(scope, "fn", "run");
    setStat(host, ".sim-total", "—");
    setStat(host, ".sim-ok", "0");
    setStat(host, ".sim-rejected", "0");

    setTxt(host, "▶ <b>W0</b> (00:00–00:01): llegan <b>100 requests</b> en los últimos instantes de la ventana…");
    await sleep(500);
    for (let i = 0; i < TL_GROUP1; i++) {
      setWinCell(host, 0, i, "on");
      setWinCount(host, 0, (i + 1) * 10);
      setStat(host, ".sim-ok", String((i + 1) * 10));
      setTxt(host, `W0 · request <b>${(i + 1) * 10}/100</b> admitida — el contador de la ventana sube…`);
      await sleep(130);
    }
    setWinCell(host, 0, 9, "full");
    setWinCount(host, 0, 100);
    setTxt(host, "W0 llena: <b>100/100</b>. El contador está al límite…");
    await sleep(500);

    setTxt(host, "⏩ <b>t=60,0 s — empieza W1</b> (00:01–00:02). Es otra ventana de calendario: <b>el contador se reinicia a 0</b>.");
    await sleep(700);

    setTxt(host, "▶ Llegan <b>100 requests</b> en los primeros instantes de W1…");
    await sleep(400);
    for (let i = 0; i < TL_GROUP2; i++) {
      setWinCell(host, 1, i, "on");
      setWinCount(host, 1, (i + 1) * 10);
      setStat(host, ".sim-ok", String(100 + (i + 1) * 10));
      setTxt(host, `W1 · request <b>${(i + 1) * 10}/100</b> admitida — W1 está fresca, nada bloquea…`);
      await sleep(130);
    }
    setWinCell(host, 1, 9, "full");
    setWinCount(host, 1, 100);

    setStat(host, ".sim-total", "200");
    setStat(host, ".sim-rejected", "0");
    setTxt(host, "Resultado: <b>200 admitidas</b> en ~1 segundo de tiempo real. El límite de 100/min <b>se duplicó en el borde</b>.");
    verdict(
      host,
      "warn",
      "⚠️ 200 ADMITIDAS — LA CARRERA DE LÍMITES<span class='sub'>100 al final de W0 + 100 al inicio de W1 = 200 requests pasaron sin un solo 429. El fixed window mide por tramos fijos de calendario, no por ningún intervalo real de 60 s: el borde es permeable y un cliente que conoce el patrón puede duplicar su cuota.</span>"
    );
    btn.disabled = false;
  },

  /* (b) 02b · sliding window — cualquier intervalo de 60 s */
  "sim-sliding": async function (host) {
    const scope = scopeOf(host);
    buildTimeline(host);
    const btn = $(".sim-run", host);
    btn.disabled = true;
    setPhase(scope, "fn", "run");
    setStat(host, ".sim-total", "—");
    setStat(host, ".sim-ok", "0");
    setStat(host, ".sim-rejected", "0");

    setTxt(host, "▶ El mismo patrón: <b>100 requests</b> en el final de la ventana anterior (t≈49–59 s). Cada una entra al <b>log de timestamps</b>…");
    await sleep(500);
    for (let i = 0; i < TL_GROUP1; i++) {
      setDot(host, "1", i, "ok");
      setNow(host, 41 + i * 0.9);
      setStat(host, ".sim-ok", String((i + 1) * 10));
      setTxt(host, `t≈${49 + i}s · request <b>${(i + 1) * 10}/100</b> admitida → se registra su timestamp…`);
      await sleep(130);
    }
    setTxt(host, "El log contiene <b>100 entradas</b>. Ahora llega la primera request «de la ventana nueva»…");
    await sleep(600);

    setNow(host, 50);
    setFrame(host, 0);
    setTxt(host, "⏩ <b>t=60,0 s</b>: la ventana deslizante evalúa el intervalo <code>(0, 60000]</code> — <b>todavía contiene las 100</b> del final de W0 → <b>429</b>.");
    await sleep(700);
    for (let i = 0; i < TL_GROUP2; i++) {
      setDot(host, "2", i, "rej");
      setStat(host, ".sim-rejected", String((i + 1) * 10));
      setTxt(host, `t≈${61 + i}s · request rechazada (429) — hay ≥ 100 entradas en los últimos 60 s…`);
      await sleep(130);
    }
    setStat(host, ".sim-ok", "100");
    setStat(host, ".sim-total", "200");
    setTxt(host, "Resultado parcial: <b>100 admitidas + 100 rechazadas</b>. El borde ya no duplica el límite…");
    await sleep(600);

    setNow(host, 100);
    setFrame(host, 50);
    for (let i = 0; i < TL_GROUP1; i++) setDot(host, "1", i, "prune");
    setTxt(host, "⏩ <b>t=120 s</b>: las entradas con <code>t ≤ 60 s</code> <b>salen de la ventana</b> (poda en <code>allow()</code>) → la siguiente request vuelve a pasar.");
    await sleep(700);

    setTxt(host, "Resultado: <b>100 admitidas · 100 rechazadas · 0 en el borde</b> — cualquier intervalo de 60 s quedó acotado a 100.");
    verdict(
      host,
      "good",
      "✅ 100 ADMITIDAS · 100 RECHAZADAS — EL BORDE QUEDÓ CERRADO<span class='sub'>En t=60,0 s el intervalo (0, 60000] todavía contenía las 100 requests del final de la ventana anterior: la primera «de la ventana nueva» fue rechazada. El límite aplica a cualquier intervalo de 60 s, no a tramos fijos. Costo: el log crece con el tráfico y la poda cuesta CPU por request (memoria vs. exactitud).</span>"
    );
    btn.disabled = false;
  },

  /* (c) 02c · token bucket — ráfaga corta vs. sostenida */
  "sim-token": async function (host) {
    const scope = scopeOf(host);
    buildBucket(host);
    const btn = $(".sim-run", host);
    btn.disabled = true;
    setPhase(scope, "fn", "run");
    setStat(host, ".sim-total", "—");
    setStat(host, ".sim-ok", "0");
    setStat(host, ".sim-rejected", "0");
    setStat(host, ".sim-tokens", "100");

    /* —— fase A: ráfaga corta (30 requests, todas pasan) —— */
    setTxt(host, "▶ <b>Ráfaga corta</b> (exp-03, escenario 1): el balde está lleno (<b>100 tokens</b>). Llegan <b>30 requests</b>…");
    await sleep(600);
    for (let i = 0; i < 3; i++) {
      setBucketTokens(host, 100 - (i + 1) * 10);
      setStat(host, ".sim-ok", String((i + 1) * 10));
      setTxt(host, `Request <b>${(i + 1) * 10}/30</b> admitida — se consume 1 token por request (balde: ${100 - (i + 1) * 10})…`);
      await sleep(350);
    }
    setTxt(host, "Ráfaga corta: <b>30/30 admitidas</b> · balde en <b>70 tokens</b>. El refill apenas suma en segundos.");
    await sleep(700);

    /* —— fase B: ráfaga sostenida (100 + 20) —— */
    setTxt(host, "▶ <b>Ráfaga sostenida</b> (exp-03, escenario 2): se parte del balde lleno. Llegan <b>100 requests</b> de golpe…");
    await sleep(600);
    for (let i = 0; i < BUCKET_CELLS; i++) {
      setBucketTokens(host, 100 - (i + 1) * 10);
      setStat(host, ".sim-ok", String(30 + (i + 1) * 10));
      setTxt(host, `Request <b>${(i + 1) * 10}/100</b> de la ráfaga admitida · acumulado <b>${30 + (i + 1) * 10}</b> admitidas — el balde se vacía…`);
      await sleep(250);
    }
    setTxt(host, "Balde en <b>0 tokens</b>. Siguen llegando requests de la ráfaga…");
    await sleep(400);
    for (let i = 0; i < 2; i++) {
      setStat(host, ".sim-rejected", String((i + 1) * 10));
      setTxt(host, `Request <b>${100 + (i + 1) * 10}/120</b> de la ráfaga <b>rechazada (429)</b> — sin tokens no hay paso…`);
      await sleep(400);
    }
    setTxt(host, "Ráfaga sostenida: <b>100 admitidas + 20 rechazadas</b> · balde en 0. El 429 empezó apenas se agotó el crédito.");
    await sleep(700);

    /* —— fase C: refill —— */
    setTxt(host, "▶ <b>Refill</b>: pasan ~6 s → a <b>1,67 tokens/s</b> se acumulan <b>~10 tokens</b> (refill float: los tokens se suman fraccionados y se comparan con ≥ 1)…");
    await sleep(800);
    setBucketTokens(host, 10);
    setTxt(host, "Balde con <b>~10 tokens</b>. Llegan 10 requests → pasan; las siguientes 10 → 429 de nuevo…");
    await sleep(700);
    setBucketTokens(host, 0);
    setStat(host, ".sim-ok", "140");
    setStat(host, ".sim-rejected", "30");
    setStat(host, ".sim-total", "170");
    setTxt(host, "Resultado: <b>140 admitidas · 30 rechazadas</b>. La tasa promedio se mantiene en 100/min mientras los picos usan el crédito del balde.");
    verdict(
      host,
      "info",
      "🔵 RÁFAGA = CAPACIDAD · SOSTENIDO = 429<span class='sub'>El balde lleno (100) deja pasar una ráfaga de hasta 100 requests; cuando se vacía, el tráfico sostenido se corta hasta que el refill (100/60 ≈ 1,67 tokens/s) acumula tokens. El refill float evita desperdiciar fracciones entre requests: se acumula y se compara con ≥ 1.</span>"
    );
    btn.disabled = false;
  },
};

/* ================= SECCIÓN 06 · DATOS COMPARATIVOS (EXP-04) =================
   BURST_REPORT: evidencia REAL de exp-04, copiada desde docs/output-04-burst.json
   (machine-readable). Estructura fija: meta + una entrada por algoritmo con
   total / ok / rejected / p95 / p99 / note / timeline ([startSec,endSec,admits]
   buckets de 10 s). Para actualizar: re-ejecutar exp-04 y copiar el JSON aquí. */
const BURST_REPORT = {
  meta: {
    source: "exp-04",
    pattern: "burst: 100×100ms en W0 + jump(60000) + 900×100ms (W1/W2)",
    generatedAt: "2026-08-26T03:18:04.094Z",
    windowMs: 60000,
    limit: 100,
  },
  fixed: {
    total: 1000,
    ok: 300,
    rejected: 700,
    p95: 0.01,
    p99: 0.02,
    note: "Ventana fija: ráfaga de 100 por ventana; al cruzar el borde W1 admite 100 y rechaza el resto hasta la siguiente ventana.",
    timeline: [
      [0, 10, 0], [10, 20, 0], [20, 30, 0], [30, 40, 0], [40, 50, 0],
      [50, 60, 100], [60, 70, 100], [70, 80, 0], [80, 90, 0], [90, 100, 0],
      [100, 110, 0], [110, 120, 0], [120, 130, 100], [130, 140, 0], [140, 150, 0],
    ],
  },
  sliding: {
    total: 1000,
    ok: 200,
    rejected: 800,
    p95: 0,
    p99: 0.01,
    note: "Ventana deslizante: el borde está cerrado (sin ráfaga de borde); las admisiones envejecen y liberan slots gradualmente.",
    timeline: [
      [0, 10, 0], [10, 20, 0], [20, 30, 0], [30, 40, 0], [40, 50, 0],
      [50, 60, 100], [60, 70, 0], [70, 80, 0], [80, 90, 0], [90, 100, 0],
      [100, 110, 0], [110, 120, 100], [120, 130, 0], [130, 140, 0], [140, 150, 0],
    ],
  },
  tokenBucket: {
    total: 1000,
    ok: 265,
    rejected: 735,
    p95: 0.01,
    p99: 0.02,
    note: "Token bucket: ráfaga == capacidad; el sostenido agota el balde y se rechaza hasta que el refill repone tokens.",
    timeline: [
      [0, 10, 0], [10, 20, 0], [20, 30, 0], [30, 40, 0], [40, 50, 0],
      [50, 60, 100], [60, 70, 31], [70, 80, 17], [80, 90, 17], [90, 100, 16],
      [100, 110, 17], [110, 120, 17], [120, 130, 16], [130, 140, 17], [140, 150, 17],
    ],
  },
};

const ALGO_LABELS = {
  fixed: "Fixed window",
  sliding: "Sliding window",
  tokenBucket: "Token bucket",
};

function renderData() {
  const banner = $("#data-banner");
  if (banner && BURST_REPORT.meta) {
    banner.innerHTML =
      `✔ <b>Evidencia real de exp-04</b> — corrida del laboratorio contra el ` +
      `mismo patrón de ráfaga para los tres algoritmos. ` +
      `Fuente: <code>docs/output-04-burst.json</code> (generado en ` +
      `<code>${BURST_REPORT.meta.generatedAt}</code>). ` +
      `Patrón: <code>${BURST_REPORT.meta.pattern}</code> — límite ` +
      `<code>${BURST_REPORT.meta.limit} req / ${BURST_REPORT.meta.windowMs / 1000} s</code>.`;
  }

  /* bars: éxitos vs 429 por algoritmo */
  const barsHost = $("#data-bars");
  if (barsHost) {
    barsHost.innerHTML = "";
    Object.entries(BURST_REPORT).forEach(([key, algo]) => {
      if (key === "meta") return;
      const label = ALGO_LABELS[key] || key;
      const okPct = Math.round((algo.ok / algo.total) * 100);
      const rejPct = Math.round((algo.rejected / algo.total) * 100);
      const mk = (cls, tag, pct, val) => {
        const bar = document.createElement("div");
        bar.className = "bar " + cls;
        bar.innerHTML =
          `<span class="b-label">${label} · ${tag}</span>` +
          `<span class="b-track"><span class="b-fill" style="width:${pct}%"></span></span>` +
          `<span class="b-val"><span class="bx">${pct}%</span> ${val}</span>`;
        barsHost.appendChild(bar);
      };
      mk("good", "admitidas", okPct, algo.ok);
      mk("bad", "429", rejPct, algo.rejected);
    });
  }

  /* table: métricas por algoritmo */
  const tbody = $("#data-table tbody");
  if (tbody) {
    tbody.innerHTML = "";
    Object.entries(BURST_REPORT).forEach(([key, algo]) => {
      if (key === "meta") return;
      const label = ALGO_LABELS[key] || key;
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="k">${label}</td>` +
        `<td class="num">${algo.total}</td>` +
        `<td class="num">${algo.ok}</td>` +
        `<td class="num">${algo.rejected}</td>` +
        `<td class="num">${algo.p95.toFixed(1)}</td>` +
        `<td class="num">${algo.p99.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
  }

  /* note: lectura de la evidencia real */
  const note = $("#data-note");
  if (note) {
    const rows = Object.entries(BURST_REPORT)
      .filter(([key]) => key !== "meta")
      .map(([key, algo]) => `<b>${ALGO_LABELS[key]}</b>: ${algo.note}`);
    note.innerHTML =
      `<b>Lectura de la evidencia real (exp-04):</b> ` +
      rows.join(" · ") +
      `. Latencias p95/p99 en ms (middleware en memoria, sub-ms).`;
  }

  renderTimeline();
}

/* timeline: filas de mini-barras por algoritmo, buckets de 10 s (admisiones) */
function renderTimeline() {
  const wrap = $("#datos .wrap");
  if (!wrap) return;
  const old = $("#data-timeline-wrap");
  if (old) old.remove();

  const card = document.createElement("div");
  card.id = "data-timeline-wrap";
  card.className = "card";
  card.style.marginTop = "18px";
  card.innerHTML =
    `<h3>Distribución temporal — admisiones por bucket de 10 s</h3>` +
    `<p class="lede" style="margin:6px 0 12px">Altura ∝ admisiones del bucket ` +
    `(relativa al máximo de su algoritmo). Cursor encima de una barra para ver el rango.</p>` +
    `<div class="tl-rows"></div>`;

  const rows = $(".tl-rows", card);
  Object.entries(BURST_REPORT).forEach(([key, algo]) => {
    if (key === "meta" || !Array.isArray(algo.timeline)) return;
    const label = ALGO_LABELS[key] || key;
    const max = Math.max(1, ...algo.timeline.map((b) => b[2]));
    const cells = algo.timeline
      .map(([start, end, admits]) => {
        const h = Math.round((admits / max) * 100);
        return (
          `<span class="tl-cell${admits > 0 ? " on" : ""}" ` +
          `style="height:${h}%" title="${start}–${end} s · ${admits} admitidas"></span>`
        );
      })
      .join("");
    const row = document.createElement("div");
    row.className = "tl-row";
    row.innerHTML = `<span class="tl-label">${label}</span><div class="tl-cells">${cells}</div>`;
    rows.appendChild(row);
  });

  wrap.appendChild(card);
}

/* ================= tabs de código ================= */
$$(".tab-btn").forEach((b) =>
  b.addEventListener("click", () => {
    const code = b.closest(".sol-code");
    if (!code) return;
    $$(".tab-btn", code).forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $$(".code-view", code).forEach((v) => (v.hidden = v.dataset.lang !== b.dataset.lang));
  })
);

/* ================= bind: cada sim-host → su runner ================= */
$$(".sim-host").forEach((host) => {
  const btn = $(".sim-run", host);
  if (!btn) return;
  const fn = simRunners[host.id];
  if (fn) btn.addEventListener("click", () => fn(host));
});

/* ================= init: render de datos (sección 06) ================= */
renderData();