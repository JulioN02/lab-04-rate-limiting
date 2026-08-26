/**
 * Middleware HTTP de rate limiting (R7–R11).
 *
 * `createRateLimitServer(limiter, options?)` levanta un servidor `node:http`
 * mínimo con un endpoint `GET /` que consume la cuota del limiter (KEY GLOBAL:
 * un único limiter para todas las requests, R11). Puertos EFÍMEROS por defecto
 * (`listen(0)`) para tests y exp-05; `start(port)` permite fijar puerto en
 * modo main (PORT).
 *
 * Headers en TODA respuesta 200 y 429 (R9):
 *   - X-RateLimit-Limit   = limit
 *   - X-RateLimit-Remaining = remaining (>= 0; 0 en 429, R10)
 *   - X-RateLimit-Reset   = Math.ceil(resetAt / 1000) (epoch segundos; nunca en el pasado)
 * En 429 (R8): Retry-After delay-seconds entero >= 1 (RFC 6585).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Limiter } from "./rate-limit.ts";
import { WINDOW_MS, LIMIT } from "./rate-limit.ts";
import { realNow, type Now } from "./clock.ts";
import { createFixedWindowLimiter } from "./fixed-window.ts";

export type RateLimitServerOptions = {
  /** Reloj inyectable (default realNow); exp-05 inyecta un fake clock. */
  now?: Now;
};

export type RateLimitServer = {
  /** URL base (http://127.0.0.1:<port>/). Válida tras start(). */
  url: string;
  /** Escucha en 127.0.0.1; por defecto puerto efímero (0). Resuelve en "listening". */
  start: (port?: number) => Promise<void>;
  /** Cierra el servidor en una promesa; idempotente. */
  stop: () => Promise<void>;
};

/** Crea el servidor demo con key global sobre el limiter dado (R7). */
export function createRateLimitServer(
  limiter: Limiter,
  options?: RateLimitServerOptions,
): RateLimitServer {
  const now: Now = options?.now ?? realNow;
  let server: Server | undefined;
  let state = { url: "" };
  let stopped = false;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      // Solo GET / consume cuota (R7). Cualquier otra ruta/método → 404 SIN
      // interactuar con el limiter ni emitir headers de rate limit (R10).
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const isGetRoot = req.method === "GET" && reqUrl.pathname === "/";
      if (!isGetRoot) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "recurso no encontrado" }));
        return;
      }

      const result = limiter.allow(now());
      const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        "Content-Type": "application/json; charset=utf-8",
      };

      if (result.allowed) {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true }));
      } else {
        // 429 (R8): Retry-After delay-seconds entero >= 1 (RFC 6585 MUST).
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((result.resetAt - now()) / 1000),
        );
        headers["Retry-After"] = String(retryAfterSeconds);
        res.writeHead(429, headers);
        res.end(
          JSON.stringify({
            ok: false,
            error: "límite de peticiones excedido",
            retryAfterSeconds,
          }),
        );
      }
    } catch {
      // Nunca una excepción no capturada (R10): 500 JSON controlado.
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "error interno" }));
    }
  };

  return {
    get url(): string {
      return state.url;
    },
    start(port = 0): Promise<void> {
      return new Promise((resolve, reject) => {
        if (stopped) {
          reject(new Error("servidor ya detenido"));
          return;
        }
        server = createServer(handler);
        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            console.error(`[api] puerto ${port} en uso (EADDRINUSE)`);
          }
          reject(err);
        });
        server.listen(port, "127.0.0.1", () => {
          const address = server?.address();
          const actualPort =
            typeof address === "object" && address !== null ? address.port : port;
          state.url = `http://127.0.0.1:${actualPort}/`;
          resolve();
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        stopped = true;
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}

// ── Modo main (node src/api.ts) ─────────────────────────────────────────────
const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
  const server = createRateLimitServer(limiter);
  const port = Number(process.env.PORT ?? 3000);

  server
    .start(port)
    .then(() => {
      console.log(`[api] rate-limit demo en ${server.url}`);
      console.log(`[api] límite ${LIMIT} req/min (ventana fija); presiona Ctrl+C para detener`);
    })
    .catch((err: unknown) => {
      console.error("[api] no se pudo iniciar:", (err as Error).message ?? err);
      process.exitCode = 1;
    });
}
