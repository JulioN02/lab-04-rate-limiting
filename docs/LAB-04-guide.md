# LAB-04 · Guía del laboratorio — Rate Limiting

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Guía de profundización del LAB-04. Complementa el `README.md` (introducción) y el dashboard
> interactivo (`docs/dashboard/`). Explica el problema, el plan de implementación, los tres
> algoritmos en profundidad, los headers, las decisiones técnicas ya tomadas y los puntos de
> decisión que quedan abiertos para el dueño del laboratorio.

---

## 1. Qué es este laboratorio

### El problema

Un endpoint público acepta cualquier cantidad de peticiones. Un cliente mal comportado, un script
de scraping o un ataque de fuerza bruta pueden disparar miles de requests por segundo: la base de
datos se satura, la API responde lento para todos y el costo del servidor se dispara. Sin límites,
el servicio es víctima de sus propios usuarios.

### El objetivo

Implementar y comparar los **tres algoritmos clásicos de rate limiting** — fixed window, sliding
window y token bucket — contra el **mismo límite (100 req/min)**, medir cómo se comportan bajo
ráfagas y latencia, y entender qué headers y respuestas (`429`, `Retry-After`, `X-RateLimit-*`)
debe exponer una API bien comportada.

### Por qué es transversal

LAB-04 es un laboratorio **transversal**: la limitación de peticiones es una capa de seguridad y
protección que todo proyecto profesional necesita (API pública, webhooks, paneles administrativos),
independiente del dominio. Está ubicado en el segundo bloque, **antes del módulo de Workflow
Automation**, para que los workers, webhooks y endpoints de ese módulo ya cuenten con el criterio de
límites y 429 aprendido acá.

No es un producto: es un **experimento hands-on** (scripts + tests + dashboard) del que se aprende
el criterio para decidir cuándo conviene cada algoritmo y qué headers exponer.

---

## 2. Qué se va a hacer

### Entregables del plan

| Entregable | Descripción |
|---|---|
| `src/clock.ts` | Reloj inyectable: `type Now`, `realNow` y `createFakeClock(startMs)` con control de tiempo (avance/posicionamiento). Sin `setTimeout`/`setInterval` → tests deterministas. |
| `src/fixed-window.ts` | Limiter puro de ventana fija (contador + inicio de ventana por `floor`). |
| `src/sliding-window.ts` | Limiter puro de ventana deslizante (log de timestamps con poda en `allow()`). |
| `src/token-bucket.ts` | Limiter puro de balde de tokens (capacity 100, refill float `100/60` tokens/s). |
| `src/api.ts` | Servidor demo con `node:http`: endpoint mínimo `GET /` + middleware rate-limit con `429` + `Retry-After` + `X-RateLimit-*`. |
| `src/exp-01-fixed.ts` | Exp 1: ráfaga que cruza el borde de ventana fija → `docs/output-01-fixed.txt`. |
| `src/exp-02-sliding.ts` | Exp 2: el mismo patrón con ventana deslizante → `docs/output-02-sliding.txt`. |
| `src/exp-03-token.ts` | Exp 3: ráfaga corta vs. sostenida en token bucket → `docs/output-03-token.txt`. |
| `src/exp-04-burst.ts` | Exp 4: comparativa bajo ráfaga (totales, éxitos, 429, p95/p99, distribución temporal) → `docs/output-04-burst.txt` + dashboard. |
| `src/exp-05-client.ts` | Exp 5: cliente que respeta headers vs. cliente ciego, contra el `api.ts` del propio lab → `docs/output-05-client.txt`. |
| `tests/rate-limit.test.ts` | Invariantes con `node:test`: límite respetado (nunca > 100 admitidos en 60 s), 429 con `Retry-After`, reset (ventana/refill). |
| `docs/dashboard/` | Dashboard explicativo + interactivo (index.html + style.css + app.js), patrón visual de lab-03. |
| Evidencias | `docs/output-*.txt` (gitignored, regenerables) + `docs/LAB-04-notion.md`. |

Todos los experimentos usan un **reloj virtual acelerado** (fake clock) para cruzar bordes de
ventana **sin esperar 60 s reales**; la latencia se mide con `performance.now()`. El límite
conceptual se mantiene en **100 req/min** para coherencia de números con el README.

### Fuera de alcance

- Base de datos y Docker/pg (el estado es 100 % en memoria).
- Límites multi-instancia/distribuidos (gateways, proxies, sticky sessions).
- Enforcement real en producción y keying por IP/usuario/API key (solo se documenta como
  consideración de producción).
- Dependencias extra: únicamente `typescript` + `@types/node`.

---

## 3. Los 3 algoritmos en profundidad

Los tres implementan el mismo límite conceptual (100 req/min), pero con reglas, estado y
compromisos distintos.

### 3.1 Fixed window

**Cómo funciona.** Divide el tiempo en ventanas fijas de calendario (00:00–00:01, 00:01–00:02, …).
Mantiene un contador por ventana; cuando el contador llega a `limit`, se rechaza hasta que empiece
la siguiente ventana. El inicio de la ventana se calcula con
`windowStart = floor(now / windowMs) * windowMs` y el **reset es por comparación de ventana**, no
por timer: si `start !== windowStart`, el contador vuelve a 0.

**Fortalezas.** Memoria mínima (un contador + el inicio de ventana), CPU mínima, trivial de
implementar y de razonar.

**Debilidades.** La **"carrera de límites"**: en el borde entre dos ventanas, un cliente puede
disparar el doble del límite sin ser bloqueado (100 al final de una ventana + 100 al inicio de la
siguiente = 200 pasan). El límite no aplica a *ningún* intervalo real de 60 segundos, sino a tramos
fijos de calendario.

### 3.2 Sliding window (log de timestamps)

**Cómo funciona.** Mantiene un log de timestamps de las peticiones admitidas. En cada `allow()`
**poda** las entradas con `t <= now - windowMs` y rechaza si el log tiene `>= limit` entradas en el
intervalo `(now - windowMs, now]`. El límite aplica a **cualquier intervalo de 60 segundos**, no a
tramos fijos: cierra el agujero del fixed window.

**Fortalezas.** Exactitud total: ningún intervalo deslizante supera el límite. Es el estándar
"correcto" para el caso general.

**Debilidades.** Más estado: el log crece con el tráfico (memoria O(tráfico en la ventana)) y la
poda + conteo cuestan CPU por request. Existen variantes aproximadas (precision sets o ventanas
deslizantes por logaritmos) que recortan memoria a costa de exactitud; en este lab se implementa la
versión exacta con poda y se documenta el compromiso **memoria vs. exactitud**.

### 3.3 Token bucket

**Cómo funciona.** Un balde con capacidad `capacity = 100` tokens que se recarga a tasa fija
(`rate = 100/60 ≈ 1,67 tokens/s`). Cada petición consume 1 token; se admite si `tokens >= 1`. El
refill usa **float**: `tokens = clamp(min(capacity, tokens + delta * rate))` — los tokens se
acumulan fraccionados entre peticiones y se comparan contra `>= 1`, sin desperdiciar fracciones.

**Fortalezas.** El más flexible: permite **ráfagas de hasta la capacidad** (un pico de 100 pasa sin
fricción) mientras la **tasa promedio** se mantiene dentro del límite. Estado constante (dos
números), CPU mínima.

**Debilidades.** El sostenido se corta bruscamente cuando el balde se vacía; el "crédito" acumulado
permite que un cliente consuma la capacidad completa de una vez (por diseño, pero hay que saberlo).
La precisión float del refill exige clamp y comparaciones cuidadosas (cubiertas por invariantes en
tests).

### 3.4 Compromisos comparados

| Algoritmo | Estado | Exactitud | Memoria | CPU por request | Ráfagas |
|---|---|---|---|---|---|
| Fixed window | contador + inicio de ventana | borde permeable (×2) | mínima (constante) | mínima | sin control fino en el borde |
| Sliding window (log) | log de timestamps | exacta en cualquier intervalo | crece con el tráfico (poda) | poda + conteo | controlada |
| Token bucket | tokens + último refill | promedio acotado; pico = capacidad | constante | mínima | ráfaga = capacidad, sostenido cortado |

El patrón general: **exactitud y memoria van de la mano** (sliding window es el más exacto y el que
más estado usa), mientras que fixed window y token bucket son baratos pero aproximan el límite de
formas distintas (tramos fijos vs. promedio).

---

## 4. Headers

### Tabla de headers

| Header | Qué significa | Ejemplo | Estatus |
|---|---|---|---|
| `429 Too Many Requests` | Código de estado: el límite de peticiones se agotó. No es error del cliente ni del servidor: es "vuelva más tarde". | `HTTP/1.1 429 Too Many Requests` | **RFC 6585** (estándar aprobado) |
| `Retry-After` | Cuántos segundos esperar antes de reintentar (formato `delay-seconds`, entero). | `Retry-After: 37` | **Obligatorio en todo 429** (RFC 6585: MUST) |
| `X-RateLimit-Limit` | El límite de la ventana. | `X-RateLimit-Limit: 100` | De-facto |
| `X-RateLimit-Remaining` | Cuántas peticiones quedan (≥ 0, decreciente). | `X-RateLimit-Remaining: 42` | De-facto |
| `X-RateLimit-Reset` | Cuándo se restablece el límite, en **epoch segundos**. | `X-RateLimit-Reset: 1765217100` | De-facto |

### RFC 6585 vs. draft-ietf-httpapi-ratelimit-headers

- **RFC 6585** define el código `429 Too Many Requests` y establece que el servidor **MUST**
  incluir `Retry-After` en la respuesta 429. Es un estándar aprobado: **no es negociable**.
- **`draft-ietf-httpapi-ratelimit-headers`** es el borrador que propone la familia
  `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` (y sus variantes `X-RateLimit-*`
  por convención histórica). **No es un estándar aprobado**: es una convención **de-facto** que
  casi todas las APIs exponen.

En el laboratorio, **toda** respuesta (200 y 429) incluye los tres `X-RateLimit-*`; el 429 incluye
además `Retry-After` obligatorio. Nota: el README del lab usa la forma `X-RateLimit-*` (de-facto);
el nombre correcto del segundo header es `X-RateLimit-Remaining` (el README tiene un typo
`Rest/Reset` que se corregirá en la fase de implementación).

---

## 5. Decisiones técnicas ya tomadas

Decididas en la exploración, la propuesta y la especificación del SDD. La implementación debe
respetarlas:

| Decisión | Detalle |
|---|---|
| **Clock inyectable, sin setTimeout** | Los limiters reciben `Now` por parámetro; los experimentos usan `createFakeClock` acelerado para cruzar bordes de ventana sin esperar 60 s reales. Latencia real con `performance.now()`. |
| **`allow()` síncrono y atómico** | Check + consume sin `await` entre ambos → atómico en el event loop (sin interleaving). Cada limiter expone `allow(): boolean` con estado observable `remaining` y `reset`. |
| **Fixed window por floor** | `windowStart = floor(now / windowMs) * windowMs`; reset por comparación de ventana, no por timer. |
| **Token bucket con clamp float** | `tokens = clamp(min(capacity, tokens + delta * rate))`; admite si `tokens >= 1`. Ráfaga máxima == capacidad. |
| **Sliding window con poda** | Log de timestamps con poda de entradas viejas dentro de `allow()`; el compromiso memoria/exactitud queda documentado en el código. |
| **Límite compartido** | `windowMs = 60000` y `limit = 100` como constantes compartidas, coherentes con el README. |
| **Key GLOBAL en api.ts** | La demo usa un único limiter para todas las requests (key global). El keying por IP/API key queda **documentado como consideración de producción**, no implementado. |
| **exp-05 como script propio** | `src/exp-05-client.ts` autocontenido contra el `api.ts` del propio lab vía `fetch`: cliente respetuoso (se autopausa con `Retry-After`/`X-RateLimit-Remaining`) vs. cliente ciego; el respetuoso debe recibir **menos 429**. |
| **Convención gitignore** | `docs/output-*.txt` y `docs/LAB-04-notion.md` se ignoran (evidencia regenerable / notas de portafolio); `docs/dashboard/` está versionado. |
| **Node nativo sin build** | `node src/*.ts` (Node ≥ 26 ejecuta TypeScript nativo), ESM nodenext, TS strict (`erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), sin transpilador. |
| **Template de reporter** | Traza INPUT / DECISIÓN / OUTPUT / RESULTADO con ANSI si `isTTY` (patrón lab-02). |
| **Dashboard patrón lab-03** | HTML/CSS/JS puro, autocontenido, sin CDN ni build. El README del lab no lista el dashboard; se incluye por patrón de serie (portfolio base). |

---

## 6. Puntos de decisión abiertos para el dueño

Estos puntos no están cerrados en el plan; cada uno se presenta con contexto y recomendación.

### 6.1 Unidades y coherencia de `X-RateLimit-Reset`

**Contexto.** El spec fija `X-RateLimit-Reset` en **epoch segundos** (convención de-facto
predominante: GitHub, Stripe, Cloudflare). El limiter interno trabaja en **milisegundos** (fake
clock y `performance.now()`). Hay que decidir el redondeo: `Math.floor(ms / 1000)` vs.
`Math.ceil(ms / 1000)`, y cómo se calcula el reset por algoritmo (inicio de la siguiente ventana
fija en fixed window; `now + windowMs` en sliding; `now + (1 - tokens)/rate` o el instante en que
`tokens >= 1` en token bucket).

**Recomendación.** Epoch segundos con `Math.ceil(ms / 1000)` (nunca anunciar un reset en el
pasado), y exponer el reset como el instante exacto en que `allow()` volverá a admitir, calculado
por cada limiter a partir de su estado observable. Documentar la unidad (segundos) en el código.

### 6.2 Ciclo de vida del servidor en exp-05

**Contexto.** exp-05 levanta el `api.ts` y le dispara requests con `fetch`. Preguntas: ¿puerto fijo
o efímero? ¿cómo se garantiza el teardown (el script debe terminar aunque falle)? ¿el servidor usa
reloj real o se le inyecta un fake clock para acelerar el reset?

**Recomendación.** Puerto efímero (`server.listen(0)` → `address().port`) para evitar colisiones y
permitir corridas paralelas; teardown con `finally { server.close() }` y timeout de seguridad;
inyectar el reloj real del lab al middleware (el reset del token bucket en ~60 s es aceptable en
una corrida de pocos segundos, o se acelera el refill para la demo — decidir al implementar, sin
cambiar el límite conceptual).

### 6.3 Compromiso memoria vs. exactitud del sliding window

**Contexto.** El log de timestamps crece con el tráfico. La versión exacta con poda en `allow()` es
la elegida, pero la poda tiene costo O(k) por request (k = entradas expiradas). Alternativas:
precision sets (memoria acotada, exactitud aproximada) o ventanas por logaritmos.

**Recomendación.** Mantener la versión **exacta con poda** para el lab (es la que permite verificar
el invariante "ningún intervalo de 60 s supera 100"), y documentar el compromiso en el código y en
la conclusión del README. No implementar precision sets en esta iteración (fuera de alcance).

### 6.4 Dashboard final: estático (datos embebidos) vs. lectura de `output-04-burst.txt`

**Contexto.** El dashboard actual (esta pre-fase) renderiza un objeto `SIMULATED` de ejemplo,
claramente marcado, con la estructura fija `total / ok / rejected / p95 / p99 / note` por algoritmo.
El spec (R17) dice que el dashboard "consumirá" `output-04-burst.txt`, pero los navegadores no leen
archivos locales por defecto (CORS/file://) sin un servidor estático o un paso de build.

**Recomendación.** Para mantener el patrón "abrir `index.html` directo en el navegador, sin build",
embeder los datos reales de exp-04 en un objeto con la misma estructura que `SIMULATED`
(reemplazando el valor por defecto) al final de la fase de implementación, y dejar documentado el
procedimiento de actualización (copiar métricas del output-04 a `app.js`). La lectura automática
del `.txt` requiere servir la carpeta con un servidor HTTP local, lo que rompe la apertura directa
— solo si el dueño lo prefiere, se agrega como modo opcional.

### 6.5 Alcance del fix del typo del README

**Contexto.** El README tiene un typo en la línea 79 (`X-RateLimit-Limit/Rest/Reset`). La propuesta
incluye corregirlo como parte del cambio.

**Recomendación.** Corregirlo en la fase de implementación (junto con la conclusión del lab), no en
esta pre-fase — los artefactos nuevos ya usan la forma correcta
`X-RateLimit-Limit/Remaining/Reset`.

---

## 7. Cómo ejecutar el lab (una vez implementado)

Este lab no necesita base de datos (estado en memoria), pero sigue el patrón de scripts y tests de
los labs anteriores:

```bash
npm install                # solo TypeScript nativo (sin build), node:test

npm run exp:fixed          # Exp 1 · fixed window — ráfaga cruzando el borde
npm run exp:sliding        # Exp 2 · sliding window — el mismo patrón
npm run exp:token          # Exp 3 · token bucket — ráfaga corta vs. sostenida
npm run exp:burst          # Exp 4 · comparativa bajo ráfaga (éxitos, 429, p95/p99)

npm test                   # invariantes con node:test
npm run typecheck          # tsc --noEmit (TS strict)
```

Evidencia real (script `evidence` o redirección manual):

```bash
npm run exp:fixed    > docs/output-01-fixed.txt
npm run exp:sliding  > docs/output-02-sliding.txt
npm run exp:token    > docs/output-03-token.txt
npm run exp:burst    > docs/output-04-burst.txt
npm test             > docs/output-test.txt
# exp-05 (cliente respetuoso vs. ciego) usa el api.ts del propio lab:
npm run exp:client   > docs/output-05-client.txt
```

Los outputs son texto plano, gitignored (se regeneran). El dashboard se abre directo en el
navegador (`docs/dashboard/index.html`).

---

## 8. Relación con el README

- El **README** sigue siendo la **introducción** del laboratorio: problema, hipótesis, plan de
  experimentos y estructura esperada. Es la primera puerta de entrada.
- Esta **guía** profundiza: plan de implementación, algoritmos en profundidad, headers, decisiones
  técnicas y puntos abiertos. Es la referencia para decidir y para implementar.
- El **dashboard** es la explicación visual e interactiva del mismo contenido, orientada a
  comprender los algoritmos y a mostrar la evidencia de exp-04.

Los tres documentos deben permanecer **coherentes**: el límite conceptual (100 req/min), los
nombres de headers (`X-RateLimit-Limit/Remaining/Reset`, `Retry-After`) y el patrón de los
experimentos (reloj virtual acelerado) son el canon compartido.