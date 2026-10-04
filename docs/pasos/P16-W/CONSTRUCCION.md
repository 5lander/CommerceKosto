# P16-W — Prevención de INC-015: ninguna prueba entra en la base sin preguntar antes

## Resumen
| Campo | Valor |
|---|---|
| Paquete | P16-W — prevención de INC-015 (tercera recurrencia, CLAUDE.md §8) |
| Fecha | 2026-10-03 |
| Commit final | *(el de este paquete)* |
| Secciones del SPEC | Ninguna: es tooling |
| Estado | ✅ completado |

**Por qué `W`:** E, J y T están reservadas por nombre en `ESTADO.md`; K está en curso; L es el plan de
paridad, que además reserva **M** (campos de API) y **N** (`ULTIMA_COMPRA`). U y V ya existen.

## Objetivo

INC-015 llegó a **tres recurrencias** (13 sep, 1 oct y 3 oct), las tres con los contenedores `healthy`
y `docker port` en orden, y las tres con un síntoma que acusaba a otra cosa. CLAUDE.md §8: tres
recurrencias significan que la prevención no se hizo. **Criterio de aceptación:** ninguna etapa de
`npm run audit` ni del pre-commit entra en la base con un puerto roto; falla antes, nombrando INC-015 y
el comando que lo arregla, y se ve fallar en cada variante provocada de verdad.

## Plan aprobado (decisiones del usuario, 2026-10-03)

| # | Decisión | Respuesta |
|---|---|---|
| W1 | El estado `rota` falla también con `--solo-unitarias` | **Sí** |
| W2 | Check propio `audit:base`, antes de `audit:sec-headers` | **Sí** |
| W3 | Detectar la variante 1 con un `StartupMessage` | **Sí, con dos condiciones**: en una conexión nueva, nunca la del `SSLRequest` (si contestó `S`, espera TLS); y la regla «PostgreSQL `R` / PgBouncer `E`» solo se escribe si el escenario 3 la demuestra con las dos respuestas reales |
| W4 | `Co-Authored-By` | **Nunca**, en ningún commit. Queda como regla en CLAUDE.md §3 en este mismo commit |

## Lo que la lectura previa cambió del diseño

1. **El módulo tiene que ser puro.** `scripts/lib/entorno.mjs` carga el `.env` en `process.env` al
   importarse; `audit:tests` lo lee **sin cargarlo**, a propósito, para que las unitarias no vean sus
   variables. Una sonda compartida que importara `entorno.mjs` habría roto esa garantía sin avisar.
   Por eso la sonda recibe una función `leer` y no toca el entorno: `doctor` le pasa `process.env`,
   los dos checks le pasan `lectorSinCargar(RAIZ)`.
2. **`audit:sec-headers` entra en la base antes que `audit:tests`.** Corre el proyecto de integración
   entero con un filtro de nombre. La recurrencia 2 salió ahí. Una sonda solo en `audit:tests`
   llegaba tarde: de ahí `audit:base`.
3. **`doctor` depende del efecto de importar `entorno.mjs`.** Al quitar el único export que usaba
   (`partesDeConexion`), el import se queda **por su efecto**, con el porqué escrito encima. Quitarlo
   entero habría dejado al informe sin cadenas y diciendo «aviso: sin cadenas de conexión».

## Qué se construyó

| Archivo | Qué |
|---|---|
| `scripts/lib/sonda-de-la-base.mjs` | **Nuevo.** `diagnosticarLaBase(leer, {intentos})` → `ok` · `sin-cadenas` · `apagada` · `rota`; `lectorSinCargar(raiz)`; `INTENTOS_ANTE_EL_PROXY` (3, INC-016). Dentro: el `SSLRequest` movido de `doctor` tal cual y el `StartupMessage` nuevo |
| `tools/audit/base.mjs` | **Nuevo.** El check `audit:base` |
| `tools/audit/tests.mjs` | La sonda TCP de una sola cadena se sustituye por el diagnóstico de las tres. `rota` → FALLO siempre; `apagada`/`sin-cadenas` → el trato de siempre |
| `tools/doctor.mjs` | Usa el módulo. Comportamiento igual; el comando del arreglo pasa a `npm run db:down && npm run db:up` |
| `package.json` | `audit:base` y su sitio en `audit`, entre `audit:deps` y `audit:sec-headers` |
| `CLAUDE.md` | §3 «Commits» (W4) y la fila de `audit:base` en §13 |

## Decisiones técnicas tomadas

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| 1 | El `StartupMessage` se manda **solo con el usuario de `MIGRATION_DATABASE_URL`** | Preguntar también con el de la app | PgBouncer conoce a `costeo_app` y contestaría `R` igual que PostgreSQL: la pregunta no distinguiría nada. El rol de migraciones es el que, por ADR-001, nunca pasa por el pooler |
| 2 | Un `E` se informa **citando el error tal cual**, sin afirmar que es PgBouncer | Mensaje «contesta PgBouncer» | PostgreSQL también manda `E` ante una regla de `pg_hba` o un rol inexistente. Lo medido es que PostgreSQL con la cadena buena contesta `R`; el resto es un entorno roto, y el texto del error dice cuál |
| 3 | Los 3 intentos se aplican a **cada** puerto, y la constante vive en el módulo | Dejarla escrita en `tests.mjs` y en `base.mjs` | Dos copias del mismo número con la misma historia (P9, INC-016) se desincronizan; `doctor` usa 1 porque es un informe, no una puerta |
| 4 | `sin-cadenas` se trata como `apagada` en `audit:tests` | Volver al `127.0.0.1:5432` por defecto de antes | El valor por defecto sondeaba un puerto que esta máquina no usa desde D-16.145 (INC-007, caso 13); sin cadenas, lo honesto es decir que no hay base que probar |

## La medición previa a escribir la regla (condición de W3)

Antes de escribir una línea en el repositorio, un experimento en el scratchpad mandó un
`StartupMessage` sin contraseña, en conexión nueva, a cada puerto:

```
usuario de la cadena directa: costeo_migrator, base: costeo
{"puerto":5442,"tipo":"R","longitud":23,"codigoDeAutenticacion":10}
{"puerto":6432,"tipo":"E","longitud":41,"error":{"S":"FATAL","C":"08P01","M":"bouncer config error"}}
```

Las dos respuestas reales, la `R` de SCRAM y el `bouncer config error` exacto de la recurrencia 2.
Con eso la regla se escribió; sin eso, el paquete se habría parado.

## Verificación: los cuatro escenarios, provocados de verdad

| # | Cómo se provocó | `audit:base` | `audit:tests --solo-unitarias` | `doctor` |
|---|---|---|---|---|
| 1 | `docker stop costeo-pgbouncer` | FALLO · `localhost:6432 (PGBOUNCER_DATABASE_URL) rechazada` + INC-015 y el comando | **FALLO**, no PARCIAL | FALLO, mismo detalle |
| 2 | `npm run db:down` | FALLO · «La pila no esta levantada: npm run db:up» | PARCIAL (sin la bandera: FALLO) | — |
| 3 | `MIGRATION_DATABASE_URL` con el puerto 6432, **solo en el entorno del proceso hijo** | FALLO · `rechaza a costeo_migrator antes de autenticar: «bouncer config error»` | FALLO, mismo detalle | — |
| 4 | Todo arriba | OK · `localhost:5442, localhost:6432 contestan; el directo es PostgreSQL` | corre la integración | OK |

**El escenario 1 es la recurrencia 3 reproducida**: antes de este paquete, con el 5442 vivo, la sonda
de `audit:tests` daba la base por buena, la integración corría entera y acababa en cinco
`ECONNREFUSED` sin nombrar la causa. **El escenario 3 es la recurrencia 2**, que el `SSLRequest` solo
no podía ver.

Al terminar, la pila quedó arriba (`audit:base` en OK) y **`costeo-pgdata` sigue**: las dos companies
sintéticas y los 13.474.351 movimientos del libro intactos.

## Lo que este paquete NO cubre, dicho

- **El 5432 de CI.** CI usa `localhost:5432` y `6432` desde variables del workflow; `audit:base` lo
  sondea igual, pero en CI nunca se ha visto INC-015 (es un fallo del reenvío de Docker Desktop en
  Windows). Si un día aparece allí, el mismo check lo para.
- **Una base que contesta pero está vacía o sin migrar.** No es INC-015 y no se pregunta aquí.
