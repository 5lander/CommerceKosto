# P16-C — Documento de construcción

**Paquete:** P16-C — API · inventario + usuarios/roles/sucursales + `period.version` · **Inicio:** 2026-09-12 · **Estado:** ✅ auditado (`npm run audit` exit 0) · commit de cierre del paquete

> Cuarto y último paquete de API de la pasada P16 → P20 (`docs/pasos/P16/PLAN.md`, sección P16-C).
> Las decisiones cerradas están en `ESTADO.md` → «Pasada P16 → P20»; las de este paquete son
> D-16.121…, abajo y en la misma sección. Se construye sin agentes.

---

## Resumen

Lo que les falta a las pantallas 17–33 del backend, y la concurrencia del mes:

1. **`period.version`** (D-16.11, D-16.13): la carga de ventas —y la de costos fijos, que también es
   un reemplazo total— exige la versión leída; 409 `CONFLICTO_DE_VERSION` si otro guardó.
2. **Libro**: `GET /inventario/movimientos/:id` (pantalla 19, corrección) y el filtro `?tipo=`.
3. **Consolidado**: `estadoDelPeriodo` sale del período de verdad, no de si hubo conteo.
4. **Organización**: `GET /usuarios` (con roles, estado, caducidad de la invitación y estado del
   correo), `GET /roles` y `PUT /ubicaciones/:id`.
5. **Deuda de P16-A2/B**: los 22 `@Param` sin `ParseUUIDPipe`.

## Objetivo del paquete

Criterio de aceptación: las rutas de la sección P16-C del plan construidas y documentadas; la 🔴 de
concurrencia de la carga del mes determinista (fila bloqueada, D-16.116) y vista fallar con su
guardián; `estadoDelPeriodo` correcto en un mes **reabierto con conteo**; `BODEGA` y el alcance de
`GERENTE_LOCAL` probados sobre respuesta cruda en las lecturas nuevas; una migración reversible con
`migrate:verify` 4/4 y `down` sobre base sembrada; `npm run audit` en verde; `npm run bench`
ejecutado (el paquete toca el camino de lectura del consolidado).

---

## Plan (Fase PLAN, modo autónomo)

### Lo que la lectura del código cambió respecto del plan

| Hallazgo | Consecuencia |
|---|---|
| **La pantalla `/ventas` manda solo las filas que cambiaron** a un endpoint que **reemplaza el mes entero**: guardar tres cambios borra las otras 45 ventas del mes | Es la pérdida de datos que D-16.1 anticipaba. Como `period.version` obliga a tocar la pantalla, se arregla aquí: manda la versión y **todas las filas con valor** |
| `POST /analitica/costos-fijos` también es un reemplazo total, y el plan solo nombra las ventas | D-16.11 cubre «reemplazos totales»: los costos fijos llevan la misma versión (D-16.121) |
| `PUT /conteos/:id/lineas` también reemplaza la hoja entera, y D-16.13 no le dio columna | **No se construye** y se sube como duda al usuario (D-16.129): dos personas contando la misma hoja se pisan, y una versión les daría un 409 que les haría perder lo contado |
| `estadoDelPeriodo` del consolidado es `conteo === null ? 'ABIERTO' : 'CERRADO'` | Un mes **reabierto** que conserva su conteo sale «CERRADO» mientras `GET /periodos` dice «ABIERTO». Se toma de `period.status` (D-16.124) |
| `desglose` en el libro ya existe desde P16-A1 | Fuera del plan de este paquete |
| `location_type.vende` / `almacena` y `location_status = INACTIVE` **no los lee ningún código** | `PUT /ubicaciones/:id` edita nombre y tipo; archivar no se construye porque hoy no significaría nada (D-16.127) |
| `email_outbox` ya concede a `costeo_app` `SELECT` por columnas **sin `datos`**, preparado en P16-A1 «para P16-C» | `correoInvitacion` se lee sin tocar privilegios; ni un rol comprometido podría traer el token |
| `audit_event_type` no tiene `location.updated` | Entra en la migración |

### Decisiones de este paquete

| # | Decisión | Razón |
|---|---|---|
| **D-16.121** | **`period.version`** (`integer NOT NULL DEFAULT 1`, `CHECK >= 1`). La suben **solo las dos cargas del mes** —ventas y costos fijos—, que comparten el testigo; ni los movimientos (que crean el período), ni el cierre, ni la reapertura, ni el conteo. La condición va en el `WHERE` del `UPDATE` (ADR-023, decisión 2), en la misma transacción que el reemplazo | La versión dice «cuántas veces se guardó la carga del mes». Compartirla entre ventas y costos fijos puede dar un 409 espurio si dos personas cargan las dos cosas del mismo mes a la vez: la misma deuda aceptada que D-16.20, con la misma señal |
| **D-16.122** | **Un mes sin fila de período se lee con `version: 1`**: la que tendrá la fila al crearse. `POST` con `1` sobre un mes sin abrir lo crea y escribe; dos a la vez → uno escribe y el otro 409 | Evita un `null` con semántica propia en el cuerpo, y un movimiento que abra el mes entre la lectura y la escritura no provoca un conflicto que nadie causó |
| **D-16.123** | `GET /analitica/ventas` → `{ version, ventas }`; `GET /analitica/costos-fijos` → `{ version, costos }`. Los `POST` exigen `version` y responden **200 `{ version }`** | El patrón de P16-B. Cambia la forma de dos lecturas: `/ventas` se actualiza en este paquete y costos fijos no tiene pantalla todavía |
| **D-16.124** | `estadoDelPeriodo` (y `cerradas`/`abiertas`) salen de `period.status` | Medían «hubo conteo», no el estado del mes |
| **D-16.125** | `GET /inventario/movimientos/:id` (`inventory.read`; la ubicación del movimiento tiene que estar en el alcance; ajeno o inexistente, el mismo 404) y `?tipo=` sobre los siete tipos del catálogo | Pantalla 19 y el libro filtrado de la 17 |
| **D-16.126** | **`GET /usuarios`** (`user.read`) → `[{ id, email, estado, roles: [{ rol, locationId }], invitacionCaducaEn, correoInvitacion }]`. **Por alcance**: con alcance de company, todos; con alcance de ubicaciones, solo quien tiene un rol en ellas y solo esas asignaciones. `correoInvitacion` = `{ estado, error? }` del **último** correo `INVITACION` del usuario, solo si está `INVITED`; `null` si nunca se encoló (invitados antes de P16-A1) o si ya activó. **Nunca `datos`** | D-16.27(b). El alcance, por la misma regla que D-16.113: un gerente de local no lista a toda la company |
| **D-16.127** | **`PUT /ubicaciones/:id`** (`location.update`): `{ nombre, tipo }` → 200 con la ubicación. Sin `estado`: `INACTIVE` no tiene hoy ningún efecto en el sistema y un interruptor que no hace nada engaña. **Sin versión** (D-16.13; señal: el primer cambio perdido). Nombre repetido → 409 con el nombre. **De otra company, 403** —no 404—, como toda ruta por ubicación desde P15. Evento `location.updated` | U6 «editar sucursal» |
| **D-16.128** | **`GET /roles`** (`user.read`) → `[{ codigo, requiereUbicacion, permisos: string[] }]`, ordenado | La pantalla 32 asigna roles y tiene que saber cuáles piden ubicación |
| **D-16.129** | **La hoja de conteo sigue sin versión**, y es una duda para el usuario, no una deuda aceptada | Ver hallazgos |
| **D-16.130** | **Un pipe propio, `IdentificadorDeRuta`, en los 24 `@Param` de la aplicación**, que lanza el error del dominio. No `ParseUUIDPipe`: respondía `BAD_REQUEST` donde el contrato dice `ENTRADA_INVALIDA` | Deuda de P16-A2 y P16-B, sin cambiar el contrato documentado; el que usaba `ParseUUIDPipe` pasa al mismo `code` |

### Lo que se construye, por capa

**Migración** `p16c_version_del_periodo`: `period.version` con su `CHECK`; `audit_event_type`
`location.updated`. Sección en `guardas-de-dominio.md`.

**Aplicación:** `RegistrarVentas`/`RegistrarCostosFijos` con versión; `ConsultarVentas`/
`ConsultarCostosFijos` con versión; `ConsultarMovimiento`; `ListarMovimientos` con `tipo`;
`contexto` con el estado del período; `ListarUsuarios`, `ListarRoles`, `ActualizarUbicacion`.

**Infraestructura:** repositorio de analítica con la escritura condicionada del período; repositorio
de inventario con `tipo`; repositorio de organización con usuarios, roles, correo de invitación y
actualización de ubicación; controladores y DTO; `ParseUUIDPipe`; `apps/web/src/app/ventas/page.tsx`.

**Pruebas 🔴:** carga del mes: cinco escrituras paradas sobre la fila del período → una 200 y cuatro
409 (ventas) y la misma carrera en costos fijos; mes sin abrir con versión 1 → crea; versión
obligatoria; mes reabierto con conteo → `ABIERTO` en el consolidado; `GET /inventario/movimientos/:id`
inventado → 404, de otra ubicación → 403, BODEGA → 403; `GET /usuarios` sin `datos` ni token en
la respuesta cruda, gerente solo ve su ubicación, BODEGA 403; `PUT /ubicaciones/:id` nombre repetido
→ 409, otra company → 403, gerente → 403; id mal formado → 400 `ENTRADA_INVALIDA` desde el pipe.

**Documentación:** `app-cliente.md`, `modelo-datos.md`, `guardas-de-dominio.md`, `FUNCIONAMIENTO.md`
(concurrencia de la carga del mes en la sección de P16-B), `seguridad.md` (matriz), CHANGELOG, ESTADO,
este archivo y `AUDITORIA-RESULTADO.md`.

---

## Qué se construyó

### La versión de la carga del mes (D-16.121…D-16.123)

| Pieza | Dónde |
|---|---|
| `period.version` (`integer NOT NULL DEFAULT 1`, `CHECK >= 1`) y la semilla `location.updated` | migración `20260912205903_p16c_version_del_periodo` |
| `PeriodoLeido.version` | puerto y repositorio de `periods` |
| `conLaVersionDelMes`: `escribirConVersion` sobre `period` (versión en el `WHERE`) y, solo si escribió, el reemplazo, **en la misma transacción** | `prisma-analitica.repositorio.ts`; el puerto pasa de «solo sus dos tablas» a «sus dos tablas y `period.version`», y lo dice |
| `RegistrarVentas` / `RegistrarCostosFijos` reciben `version` y devuelven la nueva; `versionDelMes` traduce el desenlace (409, o un 500 honesto si el período desapareciera) | `analytics/application/casos-de-uso/carga.ts` |
| `ConsultarVentas` → `{ version, ventas }`, `ConsultarCostosFijos` → `{ version, costos }`; `VERSION_INICIAL_DEL_MES = 1` para el mes sin fila | ídem |
| `POST` → 200 `{ version }`; `version` obligatoria en los dos cuerpos | `analitica.controller.ts`, `analitica.dto.ts` |
| `ConflictoDeVersionError('carga del mes')`, y el mensaje con su artículo (`LO_QUE_CAMBIO`): la receta salía como «este receta» | `shared/domain/errors/conflicto-de-version.ts` |
| **`/ventas` manda la versión y TODAS las filas con valor** —también las de productos inactivos que ya tenían ventas— y guarda la versión que vuelve | `apps/web/src/app/ventas/page.tsx` |

### Libro (D-16.125)

`ConsultarMovimiento` (`buscarMovimiento` + alcance por la ubicación del movimiento) y
`GET /inventario/movimientos/:id`; `tipo` en `ConsultaDelLibro`, en el filtro del repositorio y en el
esquema de la consulta (los siete tipos).

### Consolidado (D-16.124)

`ContextoDelPeriodo.estadoDelPeriodo` sale de `periodo.estado`, y `aporteDe` lo usa en lugar de
`conteo === null`. `elMes(piezas)` agrupa lo que identifica al contexto (lo pidió `complexity`).

### Organización (D-16.126…D-16.128)

| Pieza | Notas |
|---|---|
| `listarUsuarios` | Una lectura de usuarios con sus roles (filtrados por alcance en la propia consulta) y **una** de correos: `ultimosCorreosDeInvitacion`, `distinct` por usuario con `created_at DESC`, que no nombra `datos` |
| `listarRoles` | El catálogo con sus permisos, ordenado |
| `actualizarUbicacion` | `updateMany` con el tenant en el `WHERE`; `P2002` → `nombre_en_uso` |
| `ListarUsuarios`, `ListarRoles` | `application/casos-de-uso/lecturas-de-organizacion.ts`; el alcance se decide aquí |
| `ActualizarUbicacion` | `exigirUbicacionEnAlcance` primero; evento `location.updated`; devuelve la ubicación releída |
| `UbicacionNoEncontradaError`, `NombreDeUbicacionEnUsoError` | `iam/domain/errores.ts` |
| `LecturasDeOrganizacionController` | `GET /usuarios` y `GET /roles`, aparte de `UsuariosController` por el límite de tres dependencias |

### Los `:id` de ruta (D-16.130)

**`IdentificadorDeRuta`**, un pipe propio en `shared/infrastructure/http/`, sobre los **24** `@Param` de
la aplicación (los 22 que validaban dentro del manejador, el de `reenvio-de-invitacion` y el nuevo del
libro). Lanza el `IdentificadorInvalidoError` del dominio vía `identificadorDeEntrada`. El back office
conserva `ParseUUIDPipe`: es otra superficie con su propio contrato.

---

## Consultas del camino crítico

Medidas con `EXPLAIN (ANALYZE, BUFFERS)` sobre la base de desarrollo —2.531 usuarios, 1.407
asignaciones, 1.548 correos y 5.390 períodos de las suites, así que los filtros son selectivos— como
`costeo_app` y con el tenant fijado (el `One-Time Filter: current_company()` de RLS aparece en cada
plan). La company medida es la que más invitados con correo tiene: 33 usuarios, 32 invitados.

| Consulta | Plan | Tiempo |
|---|---|---|
| Usuarios de la company, por correo | `Index Scan using app_user_company_id_status_idx` → `quicksort` de 33 filas | 0,151 ms |
| Sus roles (la carga de la relación, 32 ids) | `Index Scan using user_role_company_id_user_id_idx`, con `company_id = current_company()` en el `Index Cond` | 0,493 ms |
| El último correo de invitación por usuario | `Bitmap Index Scan on email_outbox_user_id_created_at_idx` → `Sort` + `Unique` de 35 filas | 0,357 ms |
| `UPDATE period … WHERE id AND company_id AND version` | `Index Scan using period_id_company_id_key`, `Filter: version = 1` | 1,624 ms (con la escritura) |

**Ningún índice nuevo.** El de correos lo creó P16-A1 «para `GET /usuarios` con `correoInvitacion`,
P16-C», y el plan lo usa. El filtro de `tipo` del libro entra como condición sobre el índice
`(company_id, location_id, item_id, occurred_at)` que ya usaba la paginación: acota, no añade una
consulta. `estadoDelPeriodo` no cuesta nada: el período ya estaba cargado en el contexto.

---

## Pruebas

**Unitarias:** **891** en verde, 66 archivos, con la base apagada (eran 889; +2:
`identificador-de-ruta.pipe.spec.ts`, el UUID que pasa en minúsculas y el mal formado que sale como
`ENTRADA_INVALIDA` a través de `errorResponseFor`).

**Integración:** **541 casos, 536 en verde y 5 saltadas con motivo** (INC-016), 33 archivos (eran 515 + 5).

| Suite | Casos nuevos | 🔴 |
|---|---|---|
| `analitica.spec.ts` | 6 | Mes sin abrir con versión 1 → crea y devuelve 2 · dos cargas con la misma versión → 409 sin la versión dentro y las ventas de la primera · ventas y costos comparten la versión · un movimiento abre el mes y **no** la sube · versión obligatoria · **cinco cargas paradas sobre la fila bloqueada del período → una 200 y cuatro 409** |
| `consolidado.spec.ts` | 1 | **Cerrado con su conteo → `CERRADO`; reabierto por el OWNER, con el conteo aún `CONFIRMADO` → `ABIERTO`**, con `cerradas`/`abiertas` coherentes |
| `inventario.spec.ts` | 5 | La fila por id es exactamente la del libro · inventado 404 y mal formado 400 · **gerente de otra ubicación → 403 y sin el ítem en el cuerpo** · **BODEGA → 403 sin ningún campo prohibido** · `?tipo=MERMA` solo trae mermas y un tipo inventado es 400 |
| `autenticacion-y-autorizacion.spec.ts` | 9 | ADMIN lista su company con claves exactas y sin la otra (R1) · **gerente de bodega solo ve a quien tiene rol en su ubicación y solo esas asignaciones** · **BODEGA 403** · **invitado con dos correos: sale el último (FALLIDO con su error) y la respuesta cruda no contiene `token=`, `secreto` ni `datos`** · activo sin correo ni caducidad · `GET /roles` · renombrar → 200 · **nombre repetido → 409 con el nombre, no 500** · **ubicación de otra company → 403 y sin tocarla; gerente → 403** |
| `analitica`, `consolidado`, `frontera-http`, `correo-transaccional` | — | Actualizadas: la versión en las cargas, la forma nueva de `GET /analitica/ventas`, y `ENTRADA_INVALIDA` en `reenvio-de-invitacion` |

### Guardianes (INC-007)

| # | Sabotaje | Salida |
|---|---|---|
| G11 | La carga sin la versión en el `WHERE` | 2 × `expected 200 to be 409` (misma versión; ventas y costos) |
| G12 | Leer-comparar-escribir la versión del período | `expected [ 200, 200, 200, 200, 200 ] to deeply equal [ 200, 409, 409, 409, 409 ]` |
| G13 | `estadoDelPeriodo` deducido del conteo, como antes | `expected 'CERRADO' to be 'ABIERTO'` |
| G14 | `ListarUsuarios` sin alcance | `expected [ …(4) ] to not include '01a09783-…'` |
| G15 | El PRIMER correo en vez del último | `expected { estado: 'ENVIADO' } to deeply equal { estado: 'FALLIDO', … }` |
| G16 | Sin traducir el `P2002` del nombre | `expected 500 to be 409` |
| G17 | `ConsultarMovimiento` sin alcance | `expected 200 to be 403` |
| G18 | El pipe devuelve el valor sin validar | `expected 500 to be 400` (y el UUID sin pasar a minúsculas) |

Ocho de ocho en rojo con el sabotaje puesto, restaurados (`36 files changed, 668 insertions(+), 128
deletions(-)` antes y después).

---

## Problemas encontrados y cómo se resolvieron

1. **La pantalla de ventas borraba lo que no se tocaba.** Mandaba solo las filas cambiadas a un
   reemplazo total. Se vio leyendo el código para añadir la versión, no por un fallo: ninguna prueba
   ejercita `apps/web`. Arreglado en el mismo paquete (D-16.123).

2. **`ParseUUIDPipe` y el constructor del dominio respondían distinto al mismo error**: `BAD_REQUEST` en
   una ruta y `ENTRADA_INVALIDA` en veintidós. Aplicar el pipe de Nest a las 22, como decía la deuda,
   habría cambiado el contrato documentado. Se escribió `IdentificadorDeRuta`, que lanza el error del
   dominio, y se aplicó también a la que usaba el de Nest.

3. **La ubicación de otra company da 403, no 404**, y la primera versión de la prueba esperaba 404.
   `exigirUbicacionEnAlcance` lo decide así para toda ruta por ubicación desde P15 (lo pidió el pentest);
   un 404 solo en `PUT /ubicaciones/:id` sería un segundo contrato. Se corrigió la prueba y la decisión.

4. **Una aserción sobre `audit_log` desde la dueña de la base contaba cero**: `costeo_migrator` no tiene
   política de `SELECT` sobre esa tabla y RLS devuelve vacío sin error. Se quitó en vez de maquillarla.

5. **Las pruebas de usuarios dependían del residuo de la suite**: otras le asignan a `uno.gerente` un
   `LECTURA` de company, y su alcance deja de ser de ubicaciones. Se hicieron con usuarios propios.

6. **El comando del ensayo local del runbook ya no arrancaba.** Para probar `DELETE /usuarios/roles` a
   través de Caddy se copió el paso 0 de `puesta-en-marcha.md`, y `docker compose` se paró con «falta
   APP_URL»: P16-A1 añadió tres variables obligatorias al compose de producción y el paso 0 se quedó sin
   ellas. **INC-017, recurrencia 2**, con su regla nueva de `audit:forbidden`
   (`ensayo-local-con-las-variables-obligatorias`), escrita antes del arreglo y vista en rojo.

7. **Y con las variables puestas, el override tumbó la base de desarrollo.** Fija la subred —Caddy tiene
   IP fija—, así que `compose` intentó recrear la red: paró `api` y `db`, no pudo borrar la red porque
   `caddy`, `web` y `pgbouncer` seguían conectados, y terminó en error. Se recuperó con
   `docker compose up -d db` (esquema al día, datos intactos) y el runbook lo advierte. **La prueba a
   través de Caddy no se ejecutó**: exigía parar la pila local que está en uso, y eso no se hace sin
   preguntar. Queda en la deuda.

8. **`complexity` y `duplication` pararon dos veces**: `componer` pasó de 40 a 41 líneas (→ `elMes`), y el
   import del pipe dejó dos bloques de imports idénticos entre `fichas-de-producto` y `productos` (→ los
   alias `aLocationId`/`aProductId` que ya usan analítica e inventario).

---

## Deuda y pendientes

| Qué | Por qué se deja | Señal / dónde |
|---|---|---|
| **La hoja de conteo (`PUT /conteos/:id/lineas`) es reemplazo total sin versión** | D-16.13 no le dio columna y una versión daría a quien cuenta un 409 que le haría perder lo contado; lo que la pantalla necesita es seguramente guardar por línea | **Duda abierta para el usuario** (D-16.129) |
| **409 espurio entre ventas y costos fijos del mismo mes** | Comparten el testigo (D-16.121) | El primer 409 entre dos personas que cargaban cosas distintas |
| **`PUT /ubicaciones/:id` sin versión ni estado** | D-16.13; `INACTIVE` no tiene efecto hoy | El primer cambio perdido; el día que haya que cerrar una sucursal |
| **`DELETE /usuarios/roles` a través de Caddy en modo producción — NO EJECUTADA** | Pedida por el plan como 🔴 común. Exige levantar el override de producción, que recrea la red y para `caddy`, `web` y `pgbouncer`, en uso en local | En el ensayo del paso 0, antes de la entrega al piloto: con sesión y token, `DELETE` con cuerpo válido → 204 y sin cuerpo → 400 demuestra que el cuerpo atraviesa Caddy |
| **`/ventas` no tiene prueba automatizada** | `apps/web` no tiene suite de pantallas; se verifica con tipos, build y bundle | Armazón de P16 |

---

## Cómo probar manualmente lo construido

```
# La carga del mes, en dos pestañas
GET  /analitica/ventas?locationId=<loc>&anio=2026&mes=9          -> { "version": 3, "ventas": [...] }
POST /analitica/ventas { ..., "version": 3, "ventas": [...] }     -> 200 { "version": 4 }
POST /analitica/costos-fijos { ..., "version": 3, "costos": [] }  -> 409 CONFLICTO_DE_VERSION

# El libro
GET  /inventario/movimientos?locationId=<loc>&tipo=MERMA
GET  /inventario/movimientos/<id>

# Usuarios, roles y sucursales
GET  /usuarios        -> estado, roles, invitacionCaducaEn, correoInvitacion
GET  /roles
PUT  /ubicaciones/<id> { "nombre": "Centro histórico", "tipo": "LOCAL" }

# Un id mal formado, en cualquier ruta
GET  /productos/no-es-un-uuid -> 400 { "code": "ENTRADA_INVALIDA", ... }
```

En `/ventas`: cambiar una casilla, guardar, y comprobar que las demás filas del mes siguen ahí.

---

## Incidencias registradas en este paquete

| Incidencia | Qué |
|---|---|
| **INC-017 → 2 recurrencias** | El paso 0 del runbook, sin las tres variables obligatorias que P16-A1 añadió al compose. Prevención: la regla `ensayo-local-con-las-variables-obligatorias`, con guardián |

Los dos casos del modo de fallo de INC-007 que aparecieron —la aserción sobre `audit_log` que contaba
cero y la prueba de alcance que dependía del residuo— se cazaron en la primera corrida, antes del commit,
y no suben su contador.
