# P16-A2 — Resultado de la auditoría

**Fecha:** 2026-09-10 · **Paquete:** P16-A2 — API · `shared` + sesión + token CSRF + frontera HTTP + lecturas de catálogo
**Veredicto provisional:** los doce checks en verde corridos uno a uno sobre el árbol completo, **870 unitarias** y **460 + 5 de integración** en verde, **una migración verificada 4/4**, bundle de `apps/web` dentro de presupuesto y `npm run bench` ejecutado con el consolidado fuera de límite por la misma razón que en P16-A1 (demostrada abajo). **La salida de `npm run audit` completo la pega el orquestador** en el bloque marcado, y hasta entonces el paquete está 🟡 «construido, pendiente de auditoría final y commit».

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api`, la interfaz del back office, `tools` y `apps/web`, modo estricto máximo. Código 0 |
| `audit:lint` | ✅ | `eslint . --max-warnings=0 --no-inline-config`. Código 0. Paró dos veces durante el paquete (`no-control-regex` y `no-misused-spread` sobre `valorParaMensaje`) y las dos veces se arregló el código |
| `audit:forbidden` | ✅ | **45 reglas sobre 455 archivos** (eran 44 sobre 433 al cerrar P16-A1). La nueva es `403-de-integracion-sin-su-code`, en `tools/audit/rules/repo.rules.mjs`. Guardián ejecutado (sabotaje, captura, reversión): abajo. Paró además una vez con un carácter de control 0x00 **vivo dentro de un comentario** de `valor-en-mensaje.ts` — la regla nacida de la octava recurrencia de INC-007, funcionando |
| `audit:arch` | ✅ | **368 módulos, 1608 dependencias**, sin violaciones (eran 351 / 1529). Sin reglas nuevas de `dependency-cruiser`: las piezas nuevas caen dentro de las capas que ya existían |
| `audit:deadcode` | ✅ | knip, código 0. Solo «configuration hints» (8), como en P16-A1. Durante la etapa 3 sí encontró código muerto de verdad —`CrearItem` y `ActualizarItem` registrados dos veces en `CatalogModule` tras meterlos en `GestionDeItems`— y se quitaron |
| `audit:complexity` | ✅ | complejidad ≤ 10, profundidad ≤ 3, funciones ≤ 40 líneas, ≤ 3 parámetros. Forzó dos extracciones reales: `GestionDeItems` (el controlador de ítems ya iba con tres dependencias y la ficha era la cuarta) y el controlador propio de unidades |
| `audit:duplication` | ✅ | **Found 0 clones.** Paró dos veces: al envolver los dos esquemas del mes en `.strict()` sus líneas coaccionadas quedaron idénticas (70 tokens → `MES_COACCIONADO`), y al partir `crearItemsEnLote` en «envoltorio + escritura» los dos envoltorios quedaban casi iguales (→ un solo `aPruebaDeChoques` parametrizado). Es exactamente para lo que sirve el check |
| `audit:migrations` | ✅ | M1–M11 · **16 migraciones** reversibles y con RLS (eran 15). La nueva no crea tabla, así que M6 no aplica; sí lleva sus dos `CHECK` con sección propia en `guardas-de-dominio.md` (M11) |
| `audit:secrets` | ✅ | secretlint sobre todo el árbol. Código 0 |
| `audit:deps` | ✅ | `audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas`. **Sin dependencia nueva en el paquete**: `timingSafeEqual` y `createHash` son de `node:crypto` |
| `audit:sec-headers` | ✅ | 19 pruebas en verde (446 saltadas por `--testNamePattern`, que es como funciona el check). Las cabeceras no se tocaron; los 403, 400 y 404 nuevos salen por el mismo `ErrorFilter` con las mismas cabeceras |
| `audit:tests` | ✅ | **870 unitarias** con la base apagada (eran 823) + **465 de integración: 460 en verde y 5 saltadas con motivo** (INC-016; eran 400) |

Evidencia de los checks corridos uno a uno sobre el árbol exacto que se commitea, con `costeo-api`
parado (INC-016):

```
npm run audit:types        EXIT 0
npm run audit:lint         EXIT 0
npm run audit:forbidden    OK — 45 reglas sobre 455 archivos                                   EXIT 0
npm run audit:arch         ✔ no dependency violations found (368 modules, 1608 dependencies cruised)
                           OK — reglas de capa respetadas y guardian verificado                EXIT 0
npm run audit:complexity   EXIT 0
npm run audit:duplication  Found 0 clones.                                                     EXIT 0
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS                         EXIT 0
npm run audit:deadcode     EXIT 0   (knip: solo «configuration hints»)
npm run audit:secrets      EXIT 0
npm run audit:deps         OK — sin vulnerabilidades altas fuera de las 4 aceptadas            EXIT 0
npm run audit:sec-headers  Test Files 2 passed | 30 skipped (32) · Tests 19 passed | 446 skipped (465)

npm run test:unit         --workspace @costeo/api   Test Files 62 passed (62) · Tests 870 passed (870)
npm run test:integration  --workspace @costeo/api   Test Files 32 passed (32)
                                                    Tests 460 passed | 5 skipped (465) · 177,23 s
```

Y la salida de `npm run audit` completo, sobre el árbol del commit:

```
audit:forbidden  OK — 45 reglas sobre 455 archivos
✔ no dependency violations found (368 modules, 1608 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 16 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 30 skipped (32)
      Tests  19 passed | 446 skipped (465)
 Test Files  62 passed (62)
      Tests  870 passed (870)
 Test Files  32 passed (32)
      Tests  460 passed | 5 skipped (465)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0

(Líneas de resultado de cada check, sin códigos de color. Corrida sobre el árbol exacto del commit, con `costeo-api` parado por INC-016. La primera pareja `2 passed | 30 skipped` es `audit:sec-headers`, que filtra por nombre; las 5 saltadas de integración son las de rendimiento que solo se exigen en CI. El `statusCode 500` que aparece en el log de la corrida lo provoca a propósito la prueba que hace fallar el INSERT en `email_outbox` para demostrar que la invitación se revierte con él.)
```

### El guardián de la regla nueva (sabotaje → captura → reversión)

`403-de-integracion-sin-su-code` nació del tercer hallazgo de la revisión de la etapa 1: desde este
paquete **hay dos 403 distintos**, y `CsrfGuard` corre **antes** que `PermisosGuard`, así que a una
mutación a la que se le olvide la cabecera le basta el 403 equivocado para dejar en verde una prueba
de autorización que no llegó a ejercitar ningún permiso — incluidas 🔴 de aislamiento y de
confidencialidad de CLAUDE.md §7.

Sabotaje: un archivo temporal `apps/api/test/integracion/sabotaje-guardian.spec.ts` con dos
aserciones de 403 sin `code`, una con constante con nombre y otra con el literal, que es como están
escritas las 26 reales:

```
audit:forbidden  FALLO — 2 infraccion(es)

  [403-de-integracion-sin-su-code]  Una asercion de 403 en las pruebas de integracion que no comprueba tambien el `code`
     por que: DESDE P16-A2 HAY DOS 403 DISTINTOS: `PERMISO_DENEGADO` y `CSRF_INVALIDO`, y `CsrfGuard` corre
     ANTES que `PermisosGuard`. Una mutacion a la que se le olvide `X-CSRF-Token` responde 403 y deja en verde
     una prueba de autorizacion que no llego a ejercitar ningun permiso — incluidas las 🔴 de aislamiento y
     confidencialidad de CLAUDE.md §7 [...]
     norma:   CLAUDE.md §7 · ADR-021 · docs/pasos/P16-A2/CONSTRUCCION.md
     apps/api/test/integracion/sabotaje-guardian.spec.ts:8   expect(respuesta.status).toBe(PROHIBIDO);
     apps/api/test/integracion/sabotaje-guardian.spec.ts:13  expect(respuesta.status).toBe(403);

(revertido: el archivo se borra)
audit:forbidden  OK — 45 reglas sobre 455 archivos
```

**Captura las dos formas de escribirlo**, que era el requisito: la regla no busca un literal sino
`toBe(PROHIBIDO)` o `toBe(403)`, y recorre el cuerpo del `it` **por sangría** —no por una ventana de
N líneas— hasta el `});` que lo cierra. Con ventana fija, un comentario de dos líneas en medio la
desbordaba (falso positivo) y N+1 líneas más abajo se colaba el `code` de la prueba **siguiente**,
que es peor: aprobaba una prueba que no comprueba nada. Durante la etapa se comprobó además al revés,
borrando a mano el `code` de una de las 26 reales y viendo la regla fallar.

---

## La migración, verificada contra bases reales

```
npm run migrate:deploy
16 migrations found in prisma/migrations
No pending migrations to apply.

npm run migrate:verify
[migrate:verify] preparando bases limpias
[migrate:verify] 1/4  ida completa
[migrate:verify] 2/4  escalera: ida y vuelta entera
  OK  el down deshace exactamente lo que hizo el up
[migrate:verify] 3/4  repeticion: up -> down -> up
  OK  up -> down -> up es idempotente
[migrate:verify] 4/4  sin deriva entre las migraciones y schema.prisma
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY

[migrate:verify] las migraciones son reversibles, verificado contra bases reales.
```

`20260910202336_p16a2_csrf` — `session.csrf_token` y `backoffice_session.csrf_token`, **nullable**,
con un `CHECK` de longitud (`NULL` o 32–128) cada una, y `session_lookup` rehecha.

**Lo que la migración tuvo que hacer con cuidado, y por qué está escrito en su bloque `MANUAL`:**
`session_lookup` cambia el **tipo de retorno** (13 → 14 columnas) y `CREATE OR REPLACE` no sirve para
eso, así que va `DROP` + `CREATE` — y una función nueva **nace sin los privilegios de la anterior**,
de modo que el `REVOKE … FROM PUBLIC` y el `GRANT … TO costeo_app` se repiten explícitamente.
`down.sql` es el espejo exacto: devuelve la función a la firma de P15 con su propio `DROP` + `CREATE`
y su `REVOKE`/`GRANT`, suelta las dos restricciones por nombre y deja que el DDL de Prisma quite las
columnas.

**Ningún `GRANT` nuevo hacía falta**: `costeo_app` ya tiene `INSERT`/`UPDATE` sobre `session` desde
P1 (líneas 570 y 574 de su migración) y una columna nueva la cubren los privilegios de tabla. **M6 no
aplica** —no hay tabla nueva— y la lista de exenciones sigue **vacía**.

---

## Consultas del camino crítico — `EXPLAIN ANALYZE`

Medidas con el rol **dueño** (`MIGRATION_DATABASE_URL`) dentro de `BEGIN … ROLLBACK`, sobre la base
de desarrollo con volumen: **53.949 ítems, 38.476 artículos de compra, 24.648 productos, 72 grupos**
y las 10 unidades.

```
=== listarUnidades()  GET /catalogo/unidades ===
Sort  (cost=1.27..1.29 rows=10 width=22) (actual time=0.040..0.042 rows=10.00 loops=1)
  Sort Key: dimension, factor_to_base
  ->  Seq Scan on unit  (cost=0.00..1.10 rows=10) (actual time=0.006..0.006 rows=10.00 loops=1)
Execution Time: 0.065 ms

=== buscarItem()  ficha del ítem, lectura 1 ===
Limit  ->  Index Scan using item_pkey on item   (actual time=0.563..0.564 rows=1.00 loops=1)
  Index Cond: (id = '01a08dd0-7024-…'::uuid)
  Filter: (company_id = '01a08dd0-6468-…'::uuid)
Execution Time: 0.611 ms

=== buscarGrupo()  ficha del ítem, lectura 2 (en Promise.all con la 3) ===
Limit  ->  Seq Scan on item_group   (actual time=0.011..0.012 rows=1.00 loops=1)
  Filter: ((id = …) AND (company_id = …))   Rows Removed by Filter: 35
Execution Time: 0.049 ms

=== listarArticulos(itemId)  ficha del ítem, lectura 3 ===
Sort  ->  Index Scan using purchase_article_company_id_item_id_idx   (actual time=0.010..0.011 rows=1.00)
  Index Cond: ((company_id = …) AND (item_id = …))
Execution Time: 0.036 ms        · con el ítem de más artículos del sistema (3): 0.078 ms

=== buscarArticulo()  ficha del artículo, lectura 1 ===
Limit  ->  Index Scan using purchase_article_id_item_id_key   (actual time=0.407..0.407 rows=1.00)
Execution Time: 0.423 ms

=== listarProductos()  la ÚNICA consulta nueva del paquete (GET /analitica/ventas) ===
Index Scan using product_company_id_name_key on product
  (cost=0.41..274.31 rows=200) (actual time=0.052..0.633 rows=200.00 loops=1)
  Index Cond: (company_id = '01a08d3f-7da5-…'::uuid)   Buffers: shared hit=30 read=6
Execution Time: 0.667 ms        · sobre la company de 200 productos, que es el volumen del bench

=== buscarItem() con el id de OTRA company: el 404 cuesta lo mismo que el 200 ===
Limit  ->  Index Scan using item_pkey on item   (actual time=0.402..0.402 rows=0.00 loops=1)
  Filter: (company_id = …)   Rows Removed by Filter: 1
Execution Time: 0.420 ms

=== session_lookup()  el camino de TODA petición, ahora con csrf_token ===
Function Scan on session_lookup   (actual time=2.713..2.714 rows=0.00 loops=1)
Execution Time: 2.760 ms        · sin fila: es el coste del cuerpo de la función, no del token
```

Lo que hay que leer de aquí, sin adornos:

- **Una sola consulta nueva en todo el paquete**, y es la más barata que se puede pedir: un
  `Index Scan` por `(company_id, name)` sobre `product`, **0,667 ms con 200 productos**, y va en
  `Promise.all` con la lectura de ventas, así que no añade latencia serie. El balance para la
  pantalla es **muy favorable**: hasta ahora pedía `GET /costeo` —costear la carta entera: recetas,
  cascada de subpreparaciones, precios vigentes— únicamente para traducir identificadores en texto.
- **El token CSRF no añade ninguna.** Viaja en `session_lookup`, que ya corría una vez por petición
  autenticada, y sale de la misma fila (`s."csrf_token"`): sin JOIN nuevo, sin índice nuevo, sin
  segunda lectura. Lo que sí añade son **dos SHA-256 sobre 43 bytes** por petición mutante, dentro
  del guard: microsegundos frente a los milisegundos de cualquier consulta, y la alternativa
  —comparar cadenas— habría sido más rápida y con canal de tiempo.
- **Las dos fichas no tocan el repositorio para leer**: componen lecturas que ya existían y estaban
  probadas. Tres lecturas la del ítem (dos en paralelo, y el grupo solo si lo tiene), dos la del
  artículo, todas con `company_id` **en el WHERE**.
- **`buscarGrupo` es un `Seq Scan` de 36 filas y está bien así**: el planificador tiene razón con
  una tabla de 72 filas, y forzar un índice ahí sería un índice sin consulta que lo justifique
  (CLAUDE.md §5).
- **El 404 de un recurso ajeno cuesta lo mismo que el 200** —0,420 contra 0,611 ms, el mismo plan con
  `Rows Removed by Filter: 1`—, que es la otra mitad de que los dos mensajes sean idénticos: sin eso,
  el tiempo sería el oráculo que el texto se cuidó de no ser.
- **`GET /catalogo/unidades` quita trabajo**: diez filas de una tabla global, 0,065 ms, y a cambio la
  pantalla deja de mandar unidades inventadas que morían en una clave foránea con un 500.

---

## `npm run bench` — el presupuesto de §5

Se ejecutó porque el paquete añade una consulta al camino de lectura (AUDITORIA.md I8). Base propia
(`costeo_bench`, que el script crea y borra): 200 productos, 700 ítems, 14.000 líneas de receta,
48.000 ventas, 219.000 movimientos. p95 de 30 corridas.

| Medición | P15 | P16-A1 (en reposo) | **P16-A2** | Límite |
|---|---|---|---|---|
| suelo del entorno (validar sesión) | 4,5 ms | 6,5 ms | **8,1 ms** | — |
| costeo de la carta (200 productos, 1.400 líneas) | 75,3 | 89,6 | **120,9** ✅ | 400 |
| inventario valorizado (500 ítems) | 110,2 | 146,2 | **193,9** ✅ | 300 |
| **consolidado de company (10 ubicaciones)** | 677,5 | 940,9 | **944,0** ❌ | 800 |
| guardar una receta (con validación de ciclos) | 51,8 | 87,4 | **95,7** ✅ | 150 |

**No es regresión de este paquete, y se puede enseñar en vez de pedir que se crea.** El consolidado
pasa de 940,9 a 944,0 ms: **+0,3 %**, ruido. Mientras tanto el **suelo del entorno** —que es «validar
sesión», lo único del bench que este paquete sí toca, con una columna más en `session_lookup`— sube
de 6,5 a 8,1 ms. Normalizado a ese suelo, el consolidado cuesta hoy **116,5 «suelos»** frente a
**144,8** en P16-A1 y **150,6** en P15: relativamente, el mejor de los tres. Los otros tres
presupuestos suben en la misma proporción que el suelo y los tres siguen dentro.

**Y aun así el check tiene razón: 944 ms de 800 es rojo, y el umbral no se sube.** Es la misma deuda
que P16-A1 dejó abierta —las vistas materializadas de períodos cerrados, diseñadas en ADR-012 §7—,
sigue siendo **decisión del usuario** y sigue anotada como duda abierta en `ESTADO.md`, ahora con
estos números. Se repite lo que P16-A1 dijo en voz alta y sigue siendo verdad: **CI no ejecuta el
bench**, así que ese presupuesto no lo vigila nadie automáticamente.

## `npm run medir-bundle` — el presupuesto de I9

El paquete toca `apps/web` (seis archivos), así que I9 aplica. Tras `npm run build --workspace @costeo/web`:

```
medir-bundle  build OzWy0pTCqkRIUvRi7AuxN
  presupuesto: piso 200 KiB · pantalla 350 KiB, en gzip

  ok      126.9 KiB gzip    428.6 KiB bruto  (piso, comun a todas)
  ok      138.4 KiB gzip    463.4 KiB bruto  /costeo
  ok      133.8 KiB gzip    450.0 KiB bruto  /entrar
  ok      138.7 KiB gzip    464.7 KiB bruto  /inventario
  ok      138.7 KiB gzip    464.0 KiB bruto  /menu
  ok      130.8 KiB gzip    443.3 KiB bruto  /
  ok      133.8 KiB gzip    450.2 KiB bruto  /sucursal
  ok      138.4 KiB gzip    463.0 KiB bruto  /ventas

medir-bundle  OK
```

El piso queda en **126,9 KiB** contra los 127 del commit 0: `lib/csrf.ts` son cuarenta líneas sin
dependencias, y `/menu` **perdió** el `Promise.all` con `/costeo` y el `Map` de nombres.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | **A1**: las piezas nuevas de dominio —`shared/infrastructure/http/csrf.ts` (que no es dominio, pero solo usa `node:crypto` y `node:http`), `shared/domain/errors/valor-en-mensaje.ts` y `catalog/domain/catalogo-de-unidades.ts`— no importan framework, ORM ni `process.env`; las tres clases de error que pasan a `ErrorDeDominio` son **dominio importando dominio**, sin una dependencia nueva hacia afuera. **A2**: `LeerFichaDeItem`, `LeerFichaDeArticulo` y `ListarUnidades` reciben el puerto por constructor y no conocen Prisma. **A3**: el repositorio no decide nada — traduce el `P2002` a la unión del puerto y el 409 lo construye el caso de uso; `rescate-de-choque.ts` es infraestructura genérica y se prueba con la base apagada. **A4**: los cinco casos de uso nuevos, por constructor. **A5**: `catalog` sigue siendo el único que escribe ítems, artículos, grupos y unidades; `ConsultarVentas` **no** hace `JOIN` a `product`: se lo pide a `recipes` con `ListarProductos` (D-16.83, ADR-011). **A6**: el motor de costeo no se tocó y sus pruebas siguen corriendo con la base apagada. `audit:arch`: **368 módulos, 0 violaciones** |
| **B · Código** | **B1–B3** por los checks: cero `any`, `@ts-ignore` y `eslint-disable`. **B4–B6**: `audit:complexity` forzó dos extracciones reales (`GestionDeItems`, `UnidadesController`). **B7**: `CABECERA_DE_CSRF`, `METODOS_SEGUROS`, `LARGO_MAXIMO_DEL_VALOR`, los dos códigos de carácter de control con nombre, `CLAVES_QUE_SE_NOMBRAN`, `MAX_AGE_DEL_PREFLIGHT`; ningún literal suelto. **B8**: `CompanyId`, `ItemId`, `PurchaseArticleId`, `ItemGroupId`, `UnidadDeUso`, `Ratio`, `Quantity` en todo lo nuevo; **ninguna tarifa, cantidad ni importe como `number`**, y el `factorABase` **no se publica** precisamente para no serializar el interior del tipo decimal (D-16.88). **B9**: `CsrfInvalidoError` (código nuevo `CSRF_INVALIDO`, mapeado en el `Record` exhaustivo de `error.filter.ts`), `PeriodoSinDatosError` con código propio, `EntradaDeCatalogoInvalidaError`, y las tres del borde pasando a `ErrorDeDominio`. **B10**: ningún `catch` nuevo traga; el de `aPruebaDeChoques` **relanza** el error original si la relectura no encuentra nada (D-16.94). **B11**: sin código comentado; los tres comentarios que afirmaban que el token no hacía falta se **reescriben con el porqué**, no se borran. **B12**: los ocho `CONSULTA_*` pasan a `.strict()`, que era el hueco; la validación de seguridad sigue **en el campo** (INC-008) |
| **C · Seguridad** | **C1–C3**: ninguna tabla nueva; las dos columnas van en tablas que ya tienen `company_id` (`session`) o que no lo llevan por diseño (`backoffice_session`), las dos con RLS `ENABLE + FORCE` desde su migración. El `company_id` sigue saliendo de la sesión: **`GET /auth/sesion` NO lo publica**, y hay una 🔴 que lo comprueba. **C4 (IDOR)**: la pertenencia va **en el WHERE** de las cuatro lecturas de las fichas, nunca en un `if` posterior; un recurso de otra company es **404 con el mismo texto** que uno inventado, comparado carácter a carácter por una prueba, y el `EXPLAIN` de arriba enseña que también **cuesta lo mismo**. **C5–C6 (§4.3)**: dos 🔴 nuevas sobre el cuerpo crudo de `BODEGA` en las dos fichas, y —tras la revisión— ya no son del molde que INC-007 denuncia: fijan las **claves exactas** de los tres niveles con `toEqual` y comparan el cuerpo de `BODEGA` con el de `ADMIN`, lo que atrapa también el fallo contrario (la proyección mutilada). Verificadas **en rojo** con un `stockTeorico` y un `puntoDeReorden` de mentira. **C7/C15**: sin SQL concatenado; nada nuevo con `$queryRaw`. **C10/C16**: sin cambio (ADR-026). **C11**: sin secretos nuevos. **C13**: el motivo del fallo de CSRF (`ausente` / `no_coincide`) **no sale al cliente** —prueba unitaria— y el `detalle` de todo 4xx de dominio va al log en nivel `debug` (D-16.85). **C14**: `X-CSRF-Token` entra en `redact` **derivado de `CABECERA_DE_CSRF`** para que un renombrado no lo deje atrás, con `logger.options.spec.ts` clavando la lista entera; la fila C14 de `AUDITORIA.md` pasa a nombrar las cuatro cabeceras y a exigir que todo secreto nuevo entre ahí en el mismo paquete. Verificado: 34 líneas de la salida de integración traían el token vivo antes del arreglo, **0 después**. **C18**: los ocho `CONSULTA_*` a `.strict()`; el mensaje de claves sobrantes se escribe aquí y no se hereda de Zod (D-16.86), porque el de la librería es un eco sin recorte. **C19**: sin cambio; `audit:sec-headers` 19/19. **C20**: la rotación de sesión al login sigue como estaba, y **volver a entrar NO cierra las anteriores** (D-16.73), corregido en la documentación que decía lo contrario. **C23**: `timingSafeEqual` sobre los SHA-256 de los dos lados, **una sola vez en el repositorio** (D-16.71). **C24**: `FichaDeItem`, `FichaDeArticulo`, `UnidadLeida` y `SesionPublicada` son DTO explícitos; `alcance` conserva la unión discriminada y no se aplana. **C27**: `cors.spec.ts`, `frontera-http.spec.ts`, el bloque «token anti-CSRF» de `autenticacion-y-autorizacion.spec.ts` y las dos de `backoffice-interfaz.spec.ts`, en verde. **C28**: **el paquete no introduce ningún evento de auditoría** —un 403 de CSRF no es un evento del catálogo de §10— y por eso no hay fila nueva en `audit_event_type`. **C8, C9, C12, C17, C21, C22, C25, C26, C29, C30: sin cambio en este paquete** |
| **D · Base de datos** | **D1**: una migración con `down.sql` en espejo, `migrate:verify` **4/4**. **D2**: dos `CHECK` nuevos (`session_csrf_acotado`, `backoffice_session_csrf_acotado`); la columna es **nullable a propósito** y el porqué está escrito en tres sitios. **D3**: sin clave foránea nueva. **D4**: sin dinero ni fechas nuevas. **D5**: sin enum nativo. **D6–D7**: **ningún índice nuevo, y no es un olvido** — el token nunca se busca, se lee de la fila que `session(token_hash)` ya traía; un índice ahí sería un índice sin consulta que lo justifique. **D8**: `EXPLAIN ANALYZE` de las siete consultas, arriba, con el rol dueño dentro de `BEGIN … ROLLBACK`. **D9**: sin N+1 — las dos lecturas paralelas de la ficha del ítem son dos, no una por artículo. **D10**: sin `SELECT *` (los `select:` de Prisma son explícitos; el `*` del `EXPLAIN` es del medidor, no del código). **D11–D12**: sin paginación nueva; el filtro y el orden de `listarUnidades` van en SQL. **D13**: ninguna llamada externa dentro de transacción. **D14 (M11)**: sección `20260910202336_p16a2_csrf` en `guardas-de-dominio.md` con las dos restricciones y su categoría, **más dos filas nuevas en la sección de P2** —la clave foránea de la unidad y los dos índices únicos— y una sección nueva, «Los tipos del borde», para las tres guardas que **no** tienen `CHECK` detrás. Y la regla de mantenimiento del documento cambia: **cada fila 🔴 cita desde ahora su archivo de prueba** (D-16.99) |
| **E · Reglas de negocio** | **E1–E3 (R1)**: aislamiento en verde; `GET /auth/sesion` no publica `companyId` y ningún endpoint nuevo lo acepta; las fichas llevan el tenant en el WHERE. **E12 (R8)**: dos 🔴 nuevas sobre respuesta cruda, que ahora miden claves exactas. **E22**: sin punto flotante en nada de lo nuevo. Las **460 de integración** pasan con los cambios, **incluida la conciliación R7 (E11)** y las de aislamiento entre companies y entre ubicaciones. **El resto de las reglas no las toca este paquete**: no hay cambio en el motor de costeo, en el libro, en los precios ni en las recetas |
| **F · Frontend** | Aplica: el paquete toca seis archivos de `apps/web`. **F1–F4**: ni un color, tamaño ni fuente nuevos — `lib/csrf.ts` y `lib/api.ts` no pintan nada, y en `menu` y `ventas` lo que se hizo fue **borrar** estado y llamadas. **F5**: lo que el backend no manda no llega; las dos fichas nuevas no las consume todavía ninguna pantalla. **F6**: los estados de carga, error y vacío de las cuatro pantallas existentes no se tocaron y siguen en pie. **F8**: la validación del servidor no se relajó en ningún sitio; al contrario, ocho esquemas se volvieron estrictos. **F7 y F9 (360 px, teclado, foco)**: **sin cambio y sin verificar en esta pasada** — no hay pantalla nueva; la verificación completa es del armazón de P16. **I9** en verde, arriba |
| **G · Pruebas** | **G1**: 870 + 460 (5 saltadas con motivo, INC-016). **G2–G3**: **+47 unitarias** (823 → 870), **todas con la base apagada**. Cinco archivos nuevos —y los cinco son dominio o infraestructura pura, sin base—: `csrf.spec.ts` (11), `valor-en-mensaje.spec.ts` (6), `logger.options.spec.ts` (2), `rescate-de-choque.spec.ts` (5), `catalogo-de-unidades.spec.ts` (6); el resto son añadidos a `error.filter.spec.ts`, `nucleo.spec.ts`, `esquema.pipe.spec.ts`, `iniciar-sesion.spec.ts` y `validar-sesion.spec.ts`. **G4**: aislamiento entre companies y entre ubicaciones en verde, más la prueba que sin ella todas las demás valdrían menos: *un nombre que solo usa otra company **no** da 409*, porque el índice es `(company_id, name)` y no `(name)`. **G5**: sobre la respuesta cruda, en `catalogo.spec.ts`. **G6**: `casos-conocidos.md` **sin cambio** — el paquete no toca ninguna fórmula. **G7**: datos sintéticos con sufijo aleatorio; ningún dato real. **Y la disciplina de INC-007 aplicada donde tocaba:** las cuatro pruebas que la revisión reescribió se vieron **en rojo** antes de darlas por buenas, y la salida de ese rojo está en `CONSTRUCCION.md` |
| **H · Documentación** | **H1**: `CONSTRUCCION.md` con las tres etapas, sus revisiones y el cierre del paquete. **H2**: los tres endpoints nuevos (`GET /auth/sesion`, `GET /catalogo/unidades`, las dos fichas) y **todos los contratos cambiados** en `docs/apis/app-cliente.md`: la cabecera como requisito de toda mutación, `CSRF_INVALIDO`, `PERIODO_SIN_DATOS`, los tres 400, `.strict()` en los ocho **y las cinco rutas que no lo son**, CORS, el `nombre` en ventas y en menú, el 409 de renombrar, y la unidad que tiene que existir. `docs/apis/back-office.md` gana el suyo. **H3**: `FUNCIONAMIENTO.md` con la sección de la sesión y el `sequenceDiagram` del flujo con CSRF. **H4**: `modelo-datos.md` con el bloque de P16-A2, su fila en «Entidades por paquete», y la cabecera corregida (decía «Estado: P2» con ocho paquetes dentro). **H5**: `configuracion.md` **sin cambio y con razón**: el paquete no añade ni una variable de entorno. **H6**: ADR-021 con su fila en el índice. **H7**: `runbooks/puesta-en-marcha.md` gana el mensaje del 409 de los lotes en su tabla de errores del archivo real. **H8**: entrada de cierre en `CHANGELOG.md` con los números medidos. **H9**: sin cambio. **H10–H12**: ninguna incidencia nueva; **INC-007 sube a 11** y **INC-012 a 3**, las dos con su sección en la ficha y su fila en el índice, y la prevención que el umbral de tres obliga **hecha en este mismo paquete** (las pruebas que faltaban y la regla nueva de `guardas-de-dominio.md`). Los dos hallazgos automatizables se convirtieron en verificación: `logger.options.spec.ts` y la regla 45. **H13**: abajo, en «Lo que queda dicho». **H14**: este archivo |
| **I · Optimización** | **I1–I3** por los checks (0 clones, tras extraer dos que el propio cambio creó). **I4**: sin abstracción nueva de una sola implementación; `rescate-de-choque.ts` es una función, no una interfaz. **I5**: dos SHA-256 de 43 bytes por mutación es todo lo que el paquete añade al proceso HTTP. **I6**: el único `Promise.all` nuevo son **dos** lecturas de la ficha del ítem, acotado por construcción. **I7**: sin caché nuevo. **I8**: medido, arriba; tres de cuatro en verde y el consolidado fuera por la razón que se demuestra. **I9**: bundle en verde, arriba. **I10**: la optimización con antes/después que sí hubo es **negativa en trabajo**: `/menu` deja de pedir `GET /costeo` —costear la carta entera— para traducir ids a texto, y `menu-engineering` publica el nombre **sin una sola consulta nueva** porque ya estaba en el contexto cargado; `/ventas` paga una consulta de 0,667 ms a cambio de la misma llamada cara |

---

## Lo que queda dicho, no escondido

- **La verificación de `Origin`/`Referer` no se implementó** (D-16.69), y no es un descuido:
  `docs/SEGURIDAD.md` §4.2 la pide como «capa extra» y ahora dice allí mismo que no está, con las
  cuatro razones y la señal para reabrirla. La fila «CSRF» del mapa de amenazas de §12 se cumple en
  sus dos primeros términos y **no** en el tercero, y así está escrita.
- **Un volcado de la tabla `session` revela tokens CSRF vivos.** No habilitan nada sin la cookie —el
  razonamiento completo está en ADR-021—, pero es información que antes no estaba ahí. Ese
  razonamiento vale para la tabla y **no** se extiende a los logs, donde la cabecera va en `redact`.
- **El despliegue de este paquete cierra todas las sesiones abiertas** (D-16.67). Se acepta porque el
  sistema todavía no tiene piloto; el día que lo tenga, esto sería un aviso previo.
- **El back office conserva sus dos analizadores de cuerpo** (D-16.75). Su `NestFactory.create` vive
  en un archivo que ninguna suite monta, así que cambiarlo sería código de producción sin prueba. La
  señal para reabrirlo está escrita: que se publique fuera de loopback, o que su lanzador entre en
  una suite.
- **Los 16 `@Param` siguen sin `ParseUUIDPipe`.** Dan 400 desde la etapa 2 —que es lo que el plan
  pedía— pero el 400 lo produce el constructor del tipo **dentro del manejador**: la petición ya pasó
  por guards y pipes. Cortar antes es estrictamente mejor y toca ocho controladores de seis módulos;
  va a P16-B/C, que ya los abre.
- **Las cinco lecturas con `@Query('x')` crudo no son `.strict()`** —`GET /precios`,
  `/precios/costo/:itemId`, `/catalogo/articulos`, `/catalogo/items` y
  `/recetas/propagacion/previsualizacion`—, así que un parámetro de más ahí se sigue descartando en
  silencio con un 200. La deuda estaba anotada y **negada** en `docs/apis/app-cliente.md`; ahora las
  cinco están nombradas una a una en el documento que lee quien integra.
- **`GET /precios/costo/:itemId?fecha=basura` devuelve un 404 mentiroso** («ese ítem no tiene precio a
  esa fecha») en vez de un 400: `new Date('basura')` da `Invalid Date` y toda comparación da `false`.
  No es un 500, así que no entraba en la etapa que cazaba 500.
- **El consolidado no cabe en su presupuesto** (944 de 800). Se demuestra arriba que no es de este
  paquete y **no se sube el umbral**; la decisión —pagar las vistas materializadas de ADR-012 §7— es
  del usuario y sigue como duda abierta en `ESTADO.md`. **CI no ejecuta el bench.**
- **F7 y F9 (360 px, teclado, foco visible) no se verificaron en esta pasada**, y no se declaran
  verdes por omisión: el paquete no añade pantalla, y esa verificación es del armazón de P16.
- **No se automatizó «toda fila 🔴 de `guardas-de-dominio.md` cita una prueba»** (D-16.99): exige
  reescribir las 45 filas anteriores, que es un paquete y no una corrección de revisión. Las filas se
  completan a medida que se tocan, y el motivo está en la ficha de INC-012.
- **El índice de ADR salta del 012 al 021**: los ADR-013…019 existen en la carpeta y no tienen fila en
  `docs/decisiones/README.md`. Heredado de P16-A1 y no tocado aquí, porque meterlo mezclaría dos cosas
  en un commit. Los números **020, 022 y 023 están reservados** por el plan (armazón y kit, lecturas
  del frontend, concurrencia) y por eso este ADR es el 021 y no el siguiente libre.
- **Tres revisiones adversariales, catorce hallazgos, cinco 🔴**, todos atendidos y ninguno rebajado.
  Dos de ellos —el token en el log y los 26 403 ciegos— se convirtieron en **verificación automática
  en el mismo paquete**, que es lo que CLAUDE.md §8 exige en vez de una ficha; los demás quedaron
  cubiertos por la prueba que los reproduce.
