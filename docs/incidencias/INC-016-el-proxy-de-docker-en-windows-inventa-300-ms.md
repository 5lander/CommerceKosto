# INC-016 — Una prueba de rendimiento falla y el sistema no tiene la culpa: el proxy de Docker en Windows añade ~300 ms

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-06 |
| **Paquete** | P8 (verificación posterior) |
| **Área** | despliegue · pruebas |
| **Tiempo perdido** | ~2 h |
| **Recurrencias** | 0 |

> **Es el reverso exacto de INC-007 caso 8.** Aquella era una comprobación que pasaba en verde sin medir nada. Esta es una que falla en rojo sin que el sistema tenga nada que ver. Las dos tienen la misma raíz: **una medición que no mide lo que dice medir.**

## Síntoma

`rendimiento-de-costeo.spec.ts` falla contra el presupuesto de CLAUDE.md §5:

```
AssertionError: p95 medido: 963.6 ms: expected 963.5555999999997 to be less than 400
```

Y lo que lo hace desconcertante: **la latencia es bimodal sobre datos idénticos.** La misma petición, repetida cuarenta veces, da dos poblaciones separadas y ninguna intermedia:

```
372 366 340  80 68  367 382  93 66 78  389  88 86 77  372  67  368  96 73 70 ...
```

~85 ms o ~370 ms. Nunca 200.

## Lo que NO era — descartado con medición, no por descarte

| Sospechoso | Cómo se midió | Resultado |
|---|---|---|
| PostgreSQL | `pg_stat_statements` | **~12 ms** de ejecución por petición |
| La red | 400 × `SELECT 1` desde el host | mediana **1,09 ms**, máximo 3,9. **Cero** por encima de 5 |
| El recolector de basura | `node --trace-gc` sobre el build real | **Ninguna pausa tras el arranque.** Máxima 5,7 ms |
| El pool de conexiones | `connection_limit` de 10 → 40 | Sin cambio |
| La autenticación | `/ubicaciones` autentica y devuelve poco | 13-26 ms, estable |
| El cliente HTTP | curl y `fetch` de Node | Idénticos, y el servidor registra el mismo tiempo |
| Prisma | Las mismas 6 consultas con `pg` **crudo** | **También se bloquea.** No es Prisma |
| Vitest y SWC | Medido contra `dist/main.js` | El modo lento persiste |
| Compresión o temporizadores | No existen en el camino de respuesta | — |

El perfil de CPU (`--cpu-prof`) daba la forma del problema: **31 huecos de ~295 ms con el hilo principal OCIOSO**, uno por petición lenta, en puntos arbitrarios del trabajo. Ocioso y sin GC significa que nadie estaba calculando: se estaba esperando.

## Causa raíz

**El reenvío de puertos de Docker Desktop en Windows se atasca ~300 ms cuando cruza un resultado grande.**

La prueba que lo aísla — la misma consulta de 1.600 filas, doce veces:

| Desde dónde | Tiempos |
|---|---|
| **Dentro del contenedor** (`psql`) | 1,8 · 2,2 · 2,0 · 2,0 · 2,6 · 1,8 · 2,3 · 2,2 · 3,1 · 2,0 · 2,4 · 3,1 ms — **sin un solo pico** |
| **Desde el host** (`pg`) | 27 · 15 · 16 · 15 · 14 · 12 · 13 · 15 · 12 · 16 · 14 · 13 · **320** · **326** · 17 ms |

Por eso `SELECT 1` nunca lo sufre y una lectura de 2.900 filas sí: **depende del volumen que cruza, no del trabajo que cuesta.**

## La medición que cierra el caso

`/costeo` con 200 productos y 1.600 líneas, tres rondas **alternadas** en el mismo minuto y la misma máquina, para que ninguna se beneficie de estar más caliente:

| Topología | mediana | p95 | máximo |
|---|---|---|---|
| **API en contenedor**, base por la red interna — *la de producción* | 63 · 69 · 63 ms | 95 · 84 · **81** ms | 101 · 150 · 106 ms |
| **API en el host**, base por el proxy — *la de las pruebas* | 350 · 112 · 343 ms | 383 · **959** · 366 ms | **1253** · 977 · 367 ms |

**`/costeo` cumple el presupuesto de §5 con holgura: p95 ≈ 85 ms contra 400 ms, un 21 %.** El modo de 370 ms no existe en la topología de producción.

> **Cuidado con medir justo después de un `docker compose build`.** Durante unos minutos la máquina está ocupada procesando capas y el contenedor también da números malos (medianas de 280 y 214 ms que luego bajaron a 70). Fue lo que estuvo a punto de mandar este diagnóstico por el camino equivocado. **Repite la medición alternando topologías**, nunca una después de la otra.

## El agravante que multiplica el daño: NO dejes `costeo-api` levantado

Descubierto por accidente, levantando el contenedor de la API para medir la topología de producción **y olvidándome de pararlo**. Con él corriendo, el transporte del host a la base deja de ser malo y pasa a ser inservible:

| La misma consulta, 60 veces | mediana | máximo |
|---|---|---|
| Con `costeo-api` levantado | 11,7 ms | **60.015 ms** |
| Con `costeo-api` parado | **6,4 ms** | **20 ms** — cero picos |

Y se nota en toda la suite, no solo en las de rendimiento:

| | |
|---|---|
| Con `costeo-api` levantado | 5 archivos en rojo, distintos en cada corrida, con `ETIMEDOUT` |
| Con `costeo-api` parado | **18 de 18 en verde** |

**La regla operativa:** `npm run db:up` levanta `db` y `pgbouncer`, y nada más, **a propósito**. Si alguna vez levantas `api` para una prueba manual, **párala antes de correr la suite**:

```bash
docker compose stop api
```

Ojo: esto **no** es la causa raíz. Con `api` parado la bimodalidad base del host sigue ahí —mediana 85 ms, p95 378, máximo 991— y sigue siendo el proxy. El contenedor solo la multiplica.

## Consecuencia, y es la incómoda

**Las tres suites de rendimiento corren en el host y hablan con la base por ese proxy.** Es decir: **nunca han medido el sistema.** Han medido el reenvío de puertos de esta máquina de desarrollo, y han pasado o fallado según le apeteciera.

Lo que sí siguen midiendo bien son las comprobaciones de **plan** —`EXPLAIN` sobre índices—, porque el plan no depende del transporte. Es exactamente lo que el comentario de esa suite ya decía: *«el tiempo depende de la máquina; el PLAN no»*. Resultó ser más literal de lo previsto.

## Solución

**La medición se ejecuta siempre y su número se imprime siempre; el presupuesto solo se EXIGE donde la medición es válida** — en CI, que corre sobre Linux con el mismo `docker-compose.yml` y sin ese proxy. Fuera de ahí la aserción se salta con el motivo escrito en la salida:

```
↓ costea la carta entera por debajo de 400 ms en el p95
  [medido e impreso, pero no exigido aqui: el proxy de Docker en Windows
   falsea el tiempo (INC-016). El presupuesto lo guarda CI]

[rendimiento] costeo de la carta p95 = 960.7 ms (presupuesto 400 ms)
[rendimiento] inventario de la ubicacion p95 = 49.4 ms (presupuesto 300 ms)
[rendimiento] conteo p95 = 57.4 ms (presupuesto 300 ms)
```

Nadie pierde de vista el rendimiento por trabajar en Windows: el número sigue delante. Lo que no pasa es que un check falle acusando a un código que está bien.

**Se intentó antes algo más ambicioso y se descartó por las malas:** una sonda que midiera el transporte justo antes de medir, y decidiera. No funciona — el atasco aparece y desaparece por minutos enteros, así que una medición del transporte a las 16:20 no dice nada de cómo estará a las 16:21. La sonda daba falsos verdes y falsos rojos, **y encima parecía rigurosa**, que es lo peor de las dos cosas.

**Deuda con fecha de pago:** esto deja el presupuesto guardado por CI y por nadie más. Lo que corresponde es un banco de pruebas que mida en la topología de producción —`npm run bench`, con la API en la red de compose—, anotado en `ESTADO.md` para P9, que trae su propio presupuesto de 800 ms.

## Prevención

**La regla que queda, y vale para todo presupuesto de §5:** antes de creerse un número de rendimiento —bueno o malo—, comprueba **por dónde viaja el dato**. Una medición a través del proxy de Docker en Windows no es una medición del sistema.

Y la señal que lo delata en un minuto: **latencia bimodal sin valores intermedios.** Un sistema lento es lento de forma continua. Dos poblaciones separadas por ~300 ms, con la misma entrada, son transporte — no código.
