# LAB-04 — Rate Limiting (Limitación de Peticiones)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README es la introducción del laboratorio: definición, hipótesis y plan de experimentos.
> **Estado**: 🔲 Pendiente — lo desarrollo yo (revisar, ejecutar, medir, documentar).

## Problema

Un endpoint público acepta cualquier cantidad de peticiones. Un cliente mal
comportado, un script de scraping o un ataque de fuerza bruta pueden disparar
miles de requests por segundo: la base de datos se satura, la API responde lento
para todos, y el costo del servidor se dispara. Sin límites, el servicio es
víctima de sus propios usuarios.

La solución clásica es el **rate limiting**: permitir un máximo de peticiones
por ventana de tiempo (p. ej. 100 requests por minuto) y responder con
`429 Too Many Requests` cuando se excede. Pero "100 por minuto" se puede
implementar de varias formas, y cada una se comporta distinto bajo ráfagas:
¿cuenta ventanas fijas de calendario? ¿ventanas deslizantes continuas? ¿un
balde de tokens que se recarga con el tiempo? La elección cambia qué tan
estricto es el límite, cuánta memoria usa, y cómo se siente para el usuario.

Además, limitar del lado del servidor es solo una mitad: conviene comunicar el
estado (headers `X-RateLimit-*`, `Retry-After`) para que el cliente pueda
comportarse bien, y hay límites que solo se pueden aplicar del lado del
cliente (o viceversa). El lab consiste en implementar los algoritmos y medir
su comportamiento real bajo ráfagas.

## Objetivo del lab

Implementar y comparar los tres algoritmos clásicos — fixed window, sliding
window y token bucket — contra el mismo límite (100 req/min), medir cómo se
comportan bajo ráfagas y latencia, y entender qué headers y respuestas (`429`,
`X-RateLimit-*`, `Retry-After`) debe exponer una API bien comportada.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Fixed window es simple pero punzante**: cuenta en ventanas fijas de
   calendario (00:00–00:01, …). En el borde entre dos ventanas, un cliente
   puede disparar el doble del límite (la "carrera de límites") sin ser
   bloqueado: 100 al final de una ventana + 100 al inicio de la siguiente.
2. **Sliding window suaviza el borde**: al deslizar la ventana sobre el tiempo
   real, el límite se aplica a *cualquier* intervalo de 60 segundos, no a
   tramos fijos — cierra el agujero del fixed window a costa de más estado y
   cómputo (o de aproximaciones por log/timestamps).
3. **Token bucket permite ráfagas controladas**: el bucket acumula tokens
   (capacity) y se recarga a una tasa fija; permite picos cortos (ráfagas de
   hasta el tamaño del bucket) mientras la tasa promedio se mantiene dentro del
   límite. Es el más flexible de los tres.
4. **Bajo ráfagas sostenidas, los tres bloquean igual de tarde**: con 1000
   requests en ráfaga, todos terminan rechazando ~el mismo total, pero
   **distinto patrón de éxitos/429** en el tiempo (el token bucket deja pasar
   una ráfaga inicial; el sliding window reparte de forma más pareja).
5. **Los headers importan**: un cliente que respeta `Retry-After` y
   `X-RateLimit-Remaining` se comporta mejor que uno ciego; sin headers, el
   429 es solo un número que el cliente ignora.

## Plan de experimentos

- Exp 1: **Fixed window** — límite de 100/min por ventana fija; disparar una
  ráfaga que cruce el borde de ventana y contar éxitos/429.
- Exp 2: **Sliding window** — mismo límite con ventana deslizante (timestamp
  logs o precision set); medir el mismo patrón de ráfaga.
- Exp 3: **Token bucket** — bucket capacity + refill rate; probar ráfaga corta
  (todos pasan) vs. ráfaga sostenida (se vacía y empieza el 429).
- Exp 4: **Comparativa bajo ráfaga** — tabla de medición: requests totales,
  exitosos, 429, latencias p95/p99 y distribución temporal para los tres
  algoritmos.
- Exp 5 (opcional): **Enforcement cliente vs. servidor** — demostrar que un
  límite del lado del cliente (marcas de espera) reduce el 429 del servidor, y
  documentar qué headers debe respetar.

## Temas a explorar

- Algoritmos: fixed window, sliding window (log / precision set), token bucket
- Respuestas `429 Too Many Requests` y headers `X-RateLimit-Limit/Remaining/Reset`, `Retry-After`
- Comportamiento bajo ráfagas (burst) y la "carrera de límites" del fixed window
- Compromisos: estado en memoria vs. exactitud, memoria vs. CPU
- Enforcement: cliente vs. servidor, y límites por clave (IP, usuario, API key)
- Vínculo con sistemas reales: gateways, proxies y firewalls de aplicación

## Estructura esperada

```
lab-04-rate-limiting/
├── package.json          # scripts: test, typecheck, exp:*
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── src/
│   ├── fixed-window.ts       # algoritmo 1
│   ├── sliding-window.ts     # algoritmo 2
│   ├── token-bucket.ts       # algoritmo 3
│   ├── api.ts                # endpoint mínimo + middleware de rate limit
│   ├── exp-01-fixed.ts       # Exp 1
│   ├── exp-02-sliding.ts     # Exp 2
│   ├── exp-03-token.ts       # Exp 3
│   └── exp-04-burst.ts       # Exp 4: comparativa bajo ráfaga
├── tests/
│   └── rate-limit.test.ts    # invariantes: límite respetado, 429, reset
└── docs/
    ├── output-01-fixed.txt
    ├── output-02-sliding.txt
    ├── output-03-token.txt
    ├── output-04-burst.txt
    └── output-test.txt
```

## Cómo ejecutar este lab (una vez desarrollado)

Este lab no necesita base de datos (estado en memoria), pero sigue el patrón de
scripts y tests del LAB-01:

```bash
npm install                # solo TypeScript nativo (sin build), node:test

npm run exp:fixed          # Exp 1
npm run exp:sliding        # Exp 2
npm run exp:token          # Exp 3
npm run exp:burst          # Exp 4: comparativa bajo ráfaga

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Capturar cada salida en `docs/output-*.txt` como evidencia real.

## Cómo se conecta con el plan

LAB-04 es un laboratorio **transversal**: la limitación de peticiones es una
capa de seguridad y protección que todo proyecto profesional necesita (API
pública, webhooks, paneles administrativos), independiente del dominio. Está
ubicado en el segundo bloque, antes del módulo de Workflow Automation, para que
los workers, webhooks y endpoints de ese módulo ya cuenten con el criterio de
límites y 429 aprendido acá.

## Conclusión

Bajo el mismo patrón de ráfaga (1.000 requests contra un límite de 100 req/min,
con un salto de ventana en t=60 s), la evidencia real de exp-04 fue:

| Algoritmo | Total | Admitidas | 429 | Lectura |
|---|---|---|---|---|
| Fixed window | 1000 | **300** | 700 | La carrera de límites deja pasar 100 por ventana (W0, W1 y W2): la cuota se duplicó en cada cruce de borde. |
| Sliding window | 1000 | **200** | 800 | El borde queda cerrado: ninguna admisión extra en el cruce; las entradas envejecen y liberan slots gradualmente. |
| Token bucket | 1000 | **265** | 735 | Ráfaga inicial == capacidad (100); el refill (~1,67 tokens/s) sostiene luego una tasa promedio mientras el sostenido se rechaza. |

(Latencias p95/p99 sub-ms en los tres: middleware en memoria; los outputs
`docs/output-01-fixed.txt`, `docs/output-02-sliding.txt`,
`docs/output-03-token.txt`, `docs/output-04-burst.txt`,
`docs/output-05-client.txt` y `docs/output-04-burst.json` contienen el detalle.)

### Cuándo conviene cada algoritmo

- **Fixed window** — el más simple y con memoria mínima (solo un contador y el
  instante de inicio de ventana). Ideal cuando la implementación debe ser
  trivial y el servicio puede tolerar la *carrera de límites* en el borde
  (un cliente puede disparar hasta el doble de la cuota en el cruce de dos
  ventanas). No recomendado si el límite debe ser estricto sobre *cualquier*
  intervalo real de tiempo.
- **Sliding window (log de timestamps)** — exacto en cualquier intervalo de
  60 s: cierra el agujero del fixed window. El costo es estado y cómputo: el
  log crece con el tráfico de la ventana y la poda consume CPU por request.
  Conviene cuando la exactitud importa más que la memoria.
- **Token bucket** — el más flexible: permite ráfagas controladas de hasta el
  tamaño del bucket mientras la tasa promedio se mantiene dentro del límite.
  Usa memoria constante (solo tokens + último refill). Es la opción habitual
  en APIs públicas y gateways por su equilibrio entre permitir picos y frenar
  el abuso sostenido.

### Qué headers exponer

- **`429 Too Many Requests` con `Retry-After`** — obligatorio (RFC 6585):
  indica cuántos segundos esperar antes de reintentar (`delay-seconds`, entero).
- **`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`** —
  convención *de-facto* (borrador `draft-ietf-httpapi-ratelimit-headers`):
  el límite de la ventana, cuántas peticiones quedan (≥ 0, decreciente) y
  cuándo se restablece (epoch segundos). Incluirlos en toda respuesta (200 y
  429) permite que el cliente se autoregule y reduzca los 429.

### Keying por IP / API key (consideración de producción)

La demo usa **key global**: un único limiter para todas las requests. En
producción conviene **keying por clave** (IP, usuario o API key), de modo que
cada cliente tenga su propia cuota y el abuso de uno no agote el límite de los
demás. Implica guardar un estado por clave (p. ej. `Map<clave, limiter>`) y, en
sistemas distribuidos, un almacén compartido (Redis, etc.) fuera de alcance de
este laboratorio.

### Actualizar el dashboard

El dashboard (`docs/dashboard/index.html`) consume la evidencia embebida en
`docs/dashboard/app.js`. Para refrescarla: re-ejecutar `npm run exp:burst`,
copiar el contenido de `docs/output-04-burst.json` (machine-readable) dentro
del objeto `BURST_REPORT` de `app.js`, y recargar la página en el navegador.

## Criterio de completado

- [x] Documentar problema, hipótesis y plan en este README (sección mediciones completada)
- [x] Tres algoritmos implementados (fixed, sliding, token bucket)
- [x] Comparativa bajo ráfaga con evidencia real en `docs/output-*.txt` (éxitos, 429, latencias)
- [x] Invariante verificado con tests: límite respetado, respuesta 429 y reset correcto
- [x] Conclusión documentada: cuándo conviene cada algoritmo y qué headers exponer
- [x] `npm run typecheck` limpio
