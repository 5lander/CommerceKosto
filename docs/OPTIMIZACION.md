# OPTIMIZACION.md — Estándar de eficiencia y código sin desperdicio

> **Cumplimiento obligatorio.** Complementa `CLAUDE.md` §3 (Clean Code) y §5 (base de datos). Dos principios rectores que conviven:
> 1. **YAGNI — no construir lo que no se pidió.** Cada línea que no sirve es costo de mantenimiento, superficie de bugs y ruido para el siguiente lector.
> 2. **Medir antes de optimizar.** La optimización sin medición es superstición; la que sí importa (índices, N+1, algoritmos en el camino crítico) está definida aquí y no espera a medirse.

---

## 1. Código sin desperdicio (YAGNI)

### Prohibido crear
- **Abstracciones "por si acaso"**: interfaces con una sola implementación fuera de los puertos de Clean Architecture, factories de una cosa, jerarquías de herencia especulativas
- **Parámetros y flags que nadie usa**: si el caso de uso actual no lo necesita, no existe
- **Código muerto**: funciones sin llamadas, exports sin imports, ramas inalcanzables, features detrás de flags que nada activa
- **Endpoints, campos de respuesta o columnas "para el futuro"** — se agregan cuando el futuro llega, con su migración
- **Utilidades genéricas prematuras**: la tercera repetición justifica extraer; la primera no ("regla de tres")
- **Comentarios TODO sin ticket**: o se hace, o se registra en `ESTADO.md`, o se borra
- Reimplementar lo que la librería estándar o una dependencia ya aprobada resuelve — y a la inversa: **no traer una dependencia para 10 líneas** que se escriben a mano

### Detección automatizada (entra en `npm run audit`)
| Check | Herramienta | Falla si |
|---|---|---|
| `audit:deadcode` | `knip` (o ts-prune) | Hay exports, archivos o dependencias sin uso |
| `audit:complexity` | ESLint `complexity: 10`, `max-depth: 3`, `max-lines-per-function: 40` | Se excede sin `eslint-disable` (que está prohibido → refactorizar) |
| `audit:duplication` | `jscpd`, **cero clones** de ≥50 tokens y ≥5 líneas | Bloques duplicados — extraer al tercer uso |
| `audit:deps-weight` | Revisión en PR | Dependencia nueva sin justificación de peso/mantenimiento |

---

## 2. Eficiencia algorítmica — donde sí importa siempre

El camino crítico de este sistema es conocido; ahí la eficiencia no es opcional:

| Operación | Regla de eficiencia | Presupuesto p95 |
|---|---|---|
| **Costeo de un catálogo completo** (200 productos, 1.500 líneas) | Cargar ítems, precios vigentes y líneas en **tres consultas**, no una por producto. El motor calcula en memoria sobre estructuras planas. N+1 aquí es el error más caro del proyecto | **400 ms** |
| **Cascada de subpreparaciones** | Resolver el grafo de dependencias **una vez** por corrida y calcular en orden topológico, memorizando cada ítem producido. Jamás recalcular una preparación dos veces en la misma corrida | incluido arriba |
| **Saldo de inventario de una ubicación** (500 ítems) | Proyección incremental sobre el libro, no recorrido completo del historial. Agregación en SQL sobre el índice `(company_id, location_id, item_id, occurred_at)` | **300 ms** |
| **Consolidado de company** (10 ubicaciones) | Una sola consulta agregada con `GROUP BY`, nunca un bucle por ubicación. Vista materializada para períodos cerrados | **800 ms** |
| **Guardar una receta** | La validación de ciclos recorre el grafo con memorización y corta al primer ciclo. No recalcula el costo del catálogo entero | **150 ms** |
| **Importación de archivo** | Nada pesado en el proceso de la petición: validar cabecera, encolar, responder. El parseo y la deduplicación corren en el worker | respuesta **200 ms** |

Reglas generales:
- Estructuras correctas: `Map`/`Set` para pertenencia y lookup, no `array.includes` dentro de bucles (O(n²) accidental)
- Sin trabajo repetido en bucles: lo invariante se calcula fuera
- Los valores derivados que se leen mucho se calculan **al escribir** y se persisten — no se recalculan en cada lectura

## 3. Node.js — no bloquear, no filtrar memoria

- **El event loop es sagrado**: nada de CPU pesada (parseo de Excel/CSV, deduplicación por similitud, costeo masivo del catálogo, generación de datos sintéticos) en el proceso HTTP — todo a workers de BullMQ
- Sin APIs síncronas de I/O (`readFileSync`, `execSync`) fuera del arranque
- **Streams para archivos**: los archivos de importación se procesan por stream, jamás bufferizados completos
- Concurrencia controlada: `Promise.all` con lotes acotados (p-limit) — nunca disparar 10.000 promesas a la vez contra la base o un servicio externo
- Sin fugas: listeners removidos, timers limpiados, conexiones devueltas al pool; los workers de cola procesan con concurrencia fija
- Backpressure respetado en colas y streams

## 4. Caché — con reglas, no por reflejo

**Solo se cachea lo que cumple las tres**: se lee mucho más de lo que cambia · tolerar datos levemente viejos es aceptable · la invalidación es definible.

| Dato | Caché | TTL / invalidación |
|---|---|---|
| Unidades y factores de conversión · grupos de ítems · definición de planes | ✅ Redis + memoria local | Invalidación por evento al editar |
| Configuración versionada (`branding`, `periods`, `plans`, `locale`) | ✅ Memoria con recarga | Al cambiar versión |
| Resultados del cálculo central | Si se **persisten**, eso ES su caché | Recálculo controlado |
| Métricas de paneles | ✅ Vista materializada | Refresco programado |
| Saldos de inventario · precios de referencia vigentes · versiones de receta · resultados de costeo | ❌ **Nunca** | Consistencia manda: leer siempre de la base |
| Sesiones y rate limits | Redis (es su lugar natural) | TTL propio |

Regla dura: **jamás cachear datos de una company en una capa compartida** — un caché mal segmentado es una fuga entre companies, y aquí lo que se fugaría son recetas, costos y márgenes. Toda clave de caché que toque datos de negocio lleva el `company_id` (y el `location_id` cuando aplique) **dentro de la clave**, no como filtro posterior.

## 5. Frontend — presupuestos, no opiniones

- **Presupuesto de bundle** medido en CI: las pantallas de uso en piso —conteo físico y carga de unidades vendidas, móvil y red mala— < 200 KB de JS inicial; el resto de la app cliente < 350 KB. Se excede → el build avisa y se justifica o se corta
- Server Components por defecto; `"use client"` solo donde hay interactividad real
- Cascadas de catálogo: carga diferida por nivel (no bajar el catálogo entero al abrir la página); búsqueda con debounce (300 ms) y cancelación de peticiones obsoletas (AbortController)
- Sin re-renders evitables: estado local donde se usa, `memo` solo con causa medida en profiler — no por costumbre
- Imágenes y assets optimizados por el framework; sin librerías de UI pesadas (ya normado en §10 de CLAUDE.md)
- **Guardado incremental en la grilla de unidades vendidas**: peticiones pequeñas por celda o por lote corto, no un submit gigante de 48 productos. Es el punto de abandono del producto (SPEC §10)

## 6. La medición es parte del trabajo

- **Presupuestos de rendimiento en CI**, los de `CLAUDE.md` §5, siempre **p95, no promedio**: costeo de 200 productos con 1.500 líneas < 400 ms · inventario de una ubicación con 500 ítems < 300 ms · consolidado de 10 ubicaciones < 800 ms · guardar una receta (con validación de ciclos) < 150 ms
- `EXPLAIN ANALYZE` obligatorio en camino crítico (auditoría D8) — con datos de volumen realista, no con 20 filas
- Perfil antes de optimizar fuera del camino crítico: `clinic.js` / `--prof` cuando algo se sienta lento; el resultado se adjunta a la decisión
- Toda optimización no trivial se documenta: qué medía antes, qué mide después, qué costó en legibilidad (si empeoró la legibilidad sin mejora medible → se revierte)

## 7. Anti-patrones vetados (lista rápida)

| Anti-patrón | En su lugar |
|---|---|
| Optimización prematura fuera del camino crítico | Medir primero; el camino crítico ya está definido arriba |
| Micro-optimizaciones que sacrifican claridad (bit tricks, one-liners crípticos) | Código claro; el JIT hace su trabajo |
| `SELECT` amplio "por comodidad" | Columnas explícitas (además protege campos bloqueados) |
| Cargar todo y filtrar en JS | Filtrar en SQL |
| Caché como parche de una consulta lenta | Arreglar la consulta; cachear solo si cumple §4 |
| Abstraer "para reusar después" | Regla de tres |
| Copiar un bloque y ajustarlo | Al tercer uso, extraer |
| Reintentos infinitos o sin backoff | Reintentos acotados con backoff exponencial + jitter |
| Polling donde hay eventos | Colas/webhooks/invalidación por evento |

---

## 8. Verificación en cada paquete (sección I de la auditoría)

| # | Verificación |
|---|---|
| I1 | `audit:deadcode` en verde — sin exports, archivos ni dependencias sin uso |
| I2 | `audit:complexity` en verde — complejidad ≤10, profundidad ≤3, funciones ≤40 líneas |
| I3 | `audit:duplication` en verde — duplicación < 3 % |
| I4 | Ninguna abstracción con una sola implementación fuera de los puertos |
| I5 | Nada de CPU pesada en el proceso HTTP — verificado en los handlers del paquete |
| I6 | Concurrencia acotada en todo `Promise.all` sobre I/O |
| I7 | Cachés nuevos cumplen las tres condiciones de §4 y tienen invalidación definida |
| I8 | Presupuestos de rendimiento del paquete medidos y en verde (p95) |
| I9 | Presupuesto de bundle en verde *(solo P12/P13)* |
| I10 | Optimizaciones no triviales documentadas con antes/después en CONSTRUCCION.md |
