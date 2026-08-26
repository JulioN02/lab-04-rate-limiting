/**
 * Reporter autocontenido para LAB-04 (rate limiting).
 *
 * Port del patrón de trazas de lab-02 SIN nada de DB: cada request se traza
 * como una secuencia de pasos INPUT / DECISIÓN / OUTPUT / ERROR / RECUPERACIÓN
 * / RESULTADO en español neutro. Los colores ANSI se aplican SOLO cuando
 * stdout es una TTY, por lo que los archivos de evidencia redirigidos a
 * `docs/output-*.txt` quedan en texto plano (sin secuencias ESC).
 *
 * No importa nada de otros labs (cada lab es autocontenido).
 */

// ── Modelo de traza ─────────────────────────────────────────────────────────

export type TraceEntry = {
  kind: "input" | "decision" | "output" | "error" | "recovery" | "result";
  text?: string;
  detail?: string;
  code?: string;
  cls?: "ok" | "bad" | "warn" | "info";
};

// ── Colores ANSI (códigos crudos, sin dependencias) ─────────────────────────

const USE_COLOR = process.stdout.isTTY === true;

function c(code: string, s: string): string {
  return USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const cyan = (s: string): string => c("1;36", s);
const blue = (s: string): string => c("34", s);
export const green = (s: string): string => c("32", s);
export const red = (s: string): string => c("31", s);
export const yellow = (s: string): string => c("33", s);
export const dim = (s: string): string => c("2", s);

const CLS_COLOR: Record<NonNullable<TraceEntry["cls"]>, (s: string) => string> = {
  ok: green,
  bad: red,
  warn: yellow,
  info: dim,
};

// ── Layout ──────────────────────────────────────────────────────────────────

const BANNER_WIDTH = 60;
const REQUEST_WIDTH = 60;
const INDENT = "  ";
const LABEL_W = 11; // label más largo: "RECUPERACIÓN"
const CONT = " ".repeat(2 + LABEL_W + 1); // indent de líneas de continuación

function banner(title: string): string {
  const inner = ` ${title} `;
  const side = Math.max(2, BANNER_WIDTH - inner.length);
  const left = Math.ceil(side / 2);
  return "═".repeat(left) + inner + "═".repeat(side - left);
}

export function printBanner(title: string): void {
  console.log(cyan(banner(title)));
  console.log();
}

function requestHeader(n: number): string {
  const title = `◆ REQUEST ${n}`;
  const fill = "─".repeat(Math.max(2, REQUEST_WIDTH - title.length - 1));
  return INDENT + cyan(title + " " + fill);
}

function labelLine(name: string, text: string, color?: (s: string) => string): string {
  return INDENT + blue(name.padEnd(LABEL_W) + " ") + (color ? color(text) : text);
}

function arrowLine(detail: string): string {
  return CONT + dim("→ " + detail);
}

export function printTrace(trace: TraceEntry[], index: number): void {
  console.log(requestHeader(index + 1));
  for (const t of trace) {
    const color = t.cls ? CLS_COLOR[t.cls] : undefined;
    switch (t.kind) {
      case "input":
        if (t.text) console.log(labelLine("INPUT", t.text, color));
        if (t.detail) console.log(arrowLine(t.detail));
        break;
      case "decision":
        if (t.text) console.log(labelLine("DECISIÓN", t.text, color));
        if (t.detail) console.log(arrowLine(t.detail));
        break;
      case "output":
        if (t.text) console.log(labelLine("OUTPUT", t.text, color));
        if (t.detail) console.log(arrowLine(t.detail));
        break;
      case "error":
        console.log(labelLine("ERROR", t.text ?? "", color ?? red));
        if (t.detail) console.log(CONT + t.detail);
        break;
      case "recovery":
        console.log(labelLine("RECUPERACIÓN", `→ ${t.text ?? ""}`, color ?? yellow));
        if (t.detail) console.log(CONT + t.detail);
        break;
      case "result":
        console.log(labelLine("RESULTADO", t.text ?? "", color));
        break;
    }
  }
  console.log();
}

export type Anomaly = { text: string; cls: "ok" | "bad" | "warn" | "info" };

/** Resumen con estadísticas, anomalías y veredicto (sin base de datos). */
export function printSummary(opts: {
  title: string;
  stats: ReadonlyArray<readonly [string, string]>;
  anomalies: readonly Anomaly[];
  verdict: string;
  verdictCls: "ok" | "bad" | "warn";
}): void {
  const { title, stats, anomalies, verdict, verdictCls } = opts;

  console.log(cyan(banner(`RESUMEN · ${title}`)));
  console.log(INDENT + stats.map(([k, v]) => `${k}: ${v}`).join(" · "));
  const anomalyTxt =
    anomalies.length === 0
      ? dim("[sin anomalías]")
      : anomalies.map((a) => CLS_COLOR[a.cls](a.text)).join(" · ");
  console.log(INDENT + `anomalías: ${anomalyTxt}`);
  const verdictColor =
    verdictCls === "ok" ? green : verdictCls === "bad" ? red : yellow;
  console.log(INDENT + `veredicto: ${verdictColor(verdict)}`);
  console.log();
}
