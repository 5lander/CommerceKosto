# P16-C — Resultado de la auditoría

**Fecha:** 2026-09-12 · **Paquete:** P16-C — API · inventario + usuarios/roles/sucursales + `period.version`
**Veredicto:** `npm run audit` **exit 0** sobre el árbol que se commitea, **891 unitarias** y **536 + 5 de integración** en verde, **una migración verificada 4/4**, **ocho guardianes** en rojo con su sabotaje, bundle de `apps/web` dentro de presupuesto, `npm run bench` ejecutado y **la prueba de `DELETE /usuarios/roles` a través de Caddy sin ejecutar**, con el motivo y la forma de cerrarla abajo.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | Código 0 en los cuatro proyectos |
| `audit:lint` | ✅ | Código 0. Paró una vez: el `ParseUUIDPipe` que se quedó importado en `usuarios.controller.ts` |
| `audit:forbidden` | ✅ | **47 reglas sobre 483 archivos** (eran 46 / 477). La nueva es `ensayo-local-con-las-variables-obligatorias` (INC-017, recurrencia 2), con su rojo capturado antes del arreglo — ver la sección de Caddy |
| `audit:arch` | ✅ | **390 módulos, 1751 dependencias**, 0 violaciones (eran 386 / 1712) |
| `audit:deadcode` | ✅ | knip, código 0; solo los 8 «configuration hints» de siempre |
| `audit:complexity` | ✅ | Paró con `componer` en 41 líneas → `elMes(piezas)` |
| `audit:duplication` | ✅ | **Found 0 clones.** Paró con el bloque de imports de `fichas-de-producto` y `productos`, idéntico tras añadir el pipe |
| `audit:migrations` | ✅ | M1–M11 · **18 migraciones** reversibles y con RLS. M11 paró la migración hasta que tuvo su sección en `guardas-de-dominio.md` |
| `audit:secrets` | ✅ | Código 0 |
| `audit:deps` | ✅ | Las 4 aceptadas. **Sin dependencia nueva** |
| `audit:sec-headers` | ✅ | **19 pruebas** en verde (522 saltadas por `--testNamePattern`). Las cabeceras no se tocaron |
| `audit:tests` | ✅ | **891 unitarias** (eran 889) + **541 de integración: 536 en verde y 5 saltadas con motivo** (INC-016; eran 515 + 5) |

```
npm run audit        (costeo-api parado, INC-016)
> audit:types        EXIT 0
> audit:lint         EXIT 0
> audit:forbidden    audit:forbidden  OK — 47 reglas sobre 483 archivos
> audit:arch         ✔ no dependency violations found (390 modules, 1751 dependencies cruised)
                     audit:arch  OK — reglas de capa respetadas y guardian verificado
> audit:deadcode     EXIT 0   (knip: Configuration hints (8))
> audit:complexity   EXIT 0
> audit:duplication  Found 0 clones.
> audit:migrations   audit:migrations  OK — 18 migracion(es) reversibles y con RLS
> audit:secrets      EXIT 0
> audit:deps         audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
> audit:sec-headers  Test Files  2 passed | 31 skipped (33) · Tests  19 passed | 522 skipped (541)
> audit:tests        Test Files  66 passed (66) · Tests  891 passed (891)
                     Test Files  33 passed (33) · Tests  536 passed | 5 skipped (541)
                     audit:tests  OK — unitarias (sin base) e integracion en verde
EXIT 0
```

### Los guardianes (INC-007)

Mismo método que P16-B: un script muta, corre solo la prueba afectada y restaura; el `git diff --stat`
de `apps/api/src` es idéntico antes y después.

| # | Sabotaje | Salida |
|---|---|---|
| G11 | La carga del mes sin la versión en el `WHERE` | 2 × `expected 200 to be 409` · `Tests 2 failed \| 22 skipped` |
| G12 | Leer-comparar-escribir la versión del período, contra la prueba de la fila bloqueada | `expected [ 200, 200, 200, 200, 200 ] to deeply equal [ 200, 409, 409, 409, 409 ]` |
| G13 | `estadoDelPeriodo` deducido del conteo | `expected 'CERRADO' to be 'ABIERTO'` |
| G14 | `ListarUsuarios` con `'todas'` para cualquier alcance | `expected [ …(4) ] to not include '01a09783-…'` |
| G15 | El primer correo de invitación en vez del último | `expected { estado: 'ENVIADO' } to deeply equal { estado: 'FALLIDO', …(1) }` |
| G16 | Sin traducir el `P2002` del nombre de ubicación | `expected 500 to be 409` |
| G17 | `ConsultarMovimiento` sin alcance | `expected 200 to be 403` |
| G18 | `IdentificadorDeRuta` devuelve el valor sin validar | `expected 500 to be 400` · el UUID sin pasar a minúsculas |

---

## La migración, verificada contra bases reales

```
npm run migrate:deploy
18 migrations found in prisma/migrations
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

npm run migrate:down        (sobre la base de desarrollo sembrada: 2.608 usuarios, 5.402 periodos)
[migrate:down] revirtiendo 1 migracion(es), de la mas reciente:
  <- 20260912205903_p16c_version_del_periodo
[migrate:down] listo.
npm run migrate:deploy
Applying migration `20260912205903_p16c_version_del_periodo`
All migrations have been successfully applied.
```

`20260912205903_p16c_version_del_periodo` — `period.version` con `period_version_positiva`, y
`location.updated` en `audit_event_type`. El `down` quita el `CHECK` y la columna y **no borra la
semilla** (M10, INC-011). Aplicada, revertida y vuelta a aplicar sobre la base de desarrollo, con más de 5.300 períodos: la columna
nace con `DEFAULT 1` en todos.

---

## Consultas del camino crítico — `EXPLAIN ANALYZE`

Sobre la base de desarrollo, como `costeo_app` con tenant. Detalle en `CONSTRUCCION.md`.

```
### listarUsuarios — usuarios de la company (33 filas)
Sort  Sort Key: email  Sort Method: quicksort  Memory: 27kB
  ->  Index Scan using app_user_company_id_status_idx on app_user  Index Cond: (company_id = '01a08d9b-…')
Execution Time: 0.151 ms

### listarUsuarios — sus roles (32 ids)
Index Scan using user_role_company_id_user_id_idx on user_role
  Index Cond: ((company_id = current_company()) AND (user_id = ANY ('{…}'::uuid[])))
Execution Time: 0.493 ms

### ultimosCorreosDeInvitacion (35 correos de 32 usuarios)
Unique  ->  Sort  Sort Key: user_id, created_at DESC
  ->  Bitmap Heap Scan on email_outbox  Filter: ((company_id = '01a08d9b-…') AND (plantilla = 'INVITACION'))
        ->  Bitmap Index Scan on email_outbox_user_id_created_at_idx  Index Cond: (user_id = ANY ('{…}'::uuid[]))
Execution Time: 0.357 ms

### conLaVersionDelMes — UPDATE period (deshecho)
Update on period  ->  Index Scan using period_id_company_id_key on period
  Index Cond: ((id = '01a08d3e-…') AND (company_id = '01a08d3e-…'))  Filter: (version = 1)
Execution Time: 1.624 ms
```

---

## `npm run bench` — el presupuesto de §5

Se ejecutó porque el paquete toca el contexto del consolidado (AUDITORIA.md I8). **Desde P16-B el script
compila la API antes de medir**, así que el número es del código de este paquete. p95 de 30 corridas.

| Medición | P16-B | **P16-C** | Límite |
|---|---|---|---|
| suelo del entorno (validar sesión) | 10,0 ms | **5,9 ms** | — |
| costeo de la carta (200 productos, 1.400 líneas) | 87,2 | **100,3** ✅ | 400 |
| inventario valorizado (500 ítems) | 161,0 | **160,3** ✅ | 300 |
| **consolidado de company (10 ubicaciones)** | 919,4 | **913,1** ❌ | 800 |
| guardar una receta (con validación de ciclos) | 83,7 | **81,5** ✅ | 150 |

**Sin regresión**: el consolidado baja 6 ms, y `estadoDelPeriodo` no añade ninguna consulta —el período ya
estaba en el contexto—. El costeo de la carta sube 13 ms con el suelo bajando a la mitad: es variación del
entorno sobre una ruta que este paquete no toca. **Y el consolidado sigue rojo**: la deuda de P16-A1 y
decisión del usuario, con el umbral sin subir.

---

## `npm run medir-bundle` — el presupuesto de I9

El paquete toca `apps/web/src/app/ventas/page.tsx`. Tras `npm run build --workspace @costeo/web` (EXIT 0):

```
  ok      126.9 KiB gzip    428.6 KiB bruto  (piso, comun a todas)
  ok      138.4 KiB gzip    463.1 KiB bruto  /costeo
  ok      133.8 KiB gzip    450.0 KiB bruto  /entrar
  ok      138.7 KiB gzip    464.7 KiB bruto  /inventario
  ok      138.6 KiB gzip    463.8 KiB bruto  /menu
  ok      130.8 KiB gzip    443.3 KiB bruto  /
  ok      133.8 KiB gzip    450.2 KiB bruto  /sucursal
  ok      138.5 KiB gzip    463.1 KiB bruto  /ventas

medir-bundle  OK
```

---

## `DELETE /usuarios/roles` a través de Caddy, en modo producción

**NO SE EJECUTÓ, y se dice aquí para que nadie la dé por hecha.** El plan la pide como 🔴 común de P16-C.

Lo que pasó al intentarlo:

1. El comando del paso 0 de `puesta-en-marcha.md` **no arrancaba**: `error while interpolating
   services.api.environment.APP_URL: required variable APP_URL is missing a value`. P16-A1 añadió tres
   variables obligatorias al compose de producción y el runbook se quedó sin ellas. **INC-017,
   recurrencia 2**; arreglado, y con la regla `ensayo-local-con-las-variables-obligatorias`, cuyo rojo se
   capturó antes del arreglo:

   ```
   audit:forbidden  FALLO — 3 infraccion(es)
     [ensayo-local-con-las-variables-obligatorias]
        docs/runbooks/puesta-en-marcha.md  el ensayo local no pone APP_URL, y docker-compose.prod.yml la exige
        docs/runbooks/puesta-en-marcha.md  el ensayo local no pone PROXY_DE_CONFIANZA, y docker-compose.prod.yml la exige
        docs/runbooks/puesta-en-marcha.md  el ensayo local no pone MAIL_ADAPTER, y docker-compose.prod.yml la exige
   ```

2. Con las variables, `up -d --build api` **construyó la imagen del árbol actual** (`costeo-api:local`) y
   después intentó recrear la red —el override fija la subred—: paró `api` y `db` y falló con `network
   costeo-saas_default has active endpoints` (`caddy`, `web`, `pgbouncer`). La base de desarrollo quedó
   parada; se levantó con `docker compose up -d db`, con el esquema al día y los datos intactos.

3. Seguir exigía `down` de la pila local que está en uso. **No se hace sin preguntar.**

**Cómo se cierra, en el ensayo previo al piloto:** con la pila de producción en local, una sesión de
`ADMIN` y su token, `DELETE https://localhost/api/usuarios/roles` con un cuerpo válido → **204**, y sin
cuerpo → **400 `ENTRADA_INVALIDA`**. La diferencia demuestra que el cuerpo del `DELETE` atraviesa Caddy.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | **A1**: sin dominio nuevo salvo dos errores de `iam` y `identificadorDeEntrada`, que es dominio importando dominio. **A2–A4**: `ListarUsuarios`, `ListarRoles`, `ActualizarUbicacion`, `ConsultarMovimiento` reciben el puerto por constructor. **A3**: los repositorios traducen (`P2002` → `nombre_en_uso`, cero filas → `no_encontrada`/`conflicto_de_version`) y los casos de uso deciden. **A5**: `analytics` escribe una columna de `period` —`version`— en la misma transacción que sus dos tablas; está dicho en la cabecera de su puerto, con el porqué, y es la única. `audit:arch` en verde |
| **B · Código** | **B1–B3** por los checks. **B7**: `VERSION_INICIAL_DEL_MES`, `PLANTILLA_DE_INVITACION`, `PARAMETRO_SIN_NOMBRE`, `EN_ESPERA`. **B9**: `UbicacionNoEncontradaError`, `NombreDeUbicacionEnUsoError`; `ConflictoDeVersionError` gana su cuarto agregado y su mensaje deja de decir «este receta». **B10**: ningún `catch` que trague; el de `actualizarUbicacion` relanza todo lo que no es `P2002`. **B12**: `version` y `tipo` validados en el campo |
| **C · Seguridad** | **C1–C3**: sin tabla nueva; tenant de la sesión. **C4 (IDOR)**: el movimiento por id lleva la company en el `WHERE` y la ubicación por alcance; la ubicación de otra company es 403 y no se toca (prueba sobre la base). **C4 por ubicación**: `GET /usuarios` filtra por alcance en la propia consulta. **C5–C6 (§4.3)**: `BODEGA` → 403 en `GET /usuarios` y en el movimiento por id, este último con los campos prohibidos buscados en la respuesta cruda. **C11/C13**: `correoInvitacion` no puede traer `datos` —el rol no tiene `SELECT` sobre la columna— y la prueba busca `token=`, `secreto` y `datos` en la respuesta cruda. **C24**: `UsuarioDto`, `RolDto`, `VentasDelMesDto`, `CostosDelMesDto` explícitos; `error` ausente y no `null`. **C28**: `location.updated` en el catálogo; `sales.recorded` y `fixed_cost.recorded` ganan la versión en su detalle |
| **D · Base de datos** | **D1**: una migración, `down` en espejo, `migrate:verify` 4/4, aplicada sobre base sembrada. **D2**: un `CHECK`, sección en `guardas-de-dominio.md`. **D6–D7**: ningún índice nuevo, con los planes delante. **D9**: sin N+1 — usuarios, roles y correos son tres lecturas fijas. **D11**: `GET /usuarios` sin paginación: la lista es de una company y los planes llevan un límite natural de tamaño; si una company pasara de cientos de usuarios, es un cursor por correo |
| **E · Reglas de negocio** | **R1**: `GET /usuarios` sin la otra company (prueba). **D6**: la carga del mes cerrado sigue siendo 409 `CONFLICTO` antes que cualquier comparación de versión. **R7**: conciliación en verde. **ADR-010 §1**: `estadoDelPeriodo` por fin es el del período |
| **F · Frontend** | Aplica: `ventas/page.tsx`. Sin token visual nuevo; manda la versión y todas las filas con valor. **I9** en verde |
| **G · Pruebas** | **G1**: 891 + 536 (5 saltadas). **G2–G3**: +2 unitarias, sin base. **G4–G5**: aislamiento, alcance y `BODEGA` en las rutas nuevas. **INC-007**: ocho guardianes |
| **H · Documentación** | `CONSTRUCCION.md`; `app-cliente.md` (ocho contratos: `GET /usuarios`, `GET /roles`, `PUT /ubicaciones/:id`, `GET /inventario/movimientos/:id`, `?tipo=`, las dos cargas del mes con versión, `estadoDelPeriodo`, y el `code` unificado de los ids); `modelo-datos.md`; `guardas-de-dominio.md`; `FUNCIONAMIENTO.md`; `seguridad.md` (matriz); CHANGELOG; ESTADO. Sin ADR nuevo: `period.version` es la decisión 5 de ADR-023, que ya la anunciaba para P16-C |
| **I · Optimización** | **I4**: `IdentificadorDeRuta` tiene 24 consumidores. **I6**: sin `Promise.all` de cardinalidad variable. **I8**: bench arriba. **I9**: bundle arriba |

---

## Lo que queda dicho, no escondido

- **La hoja de conteo sigue siendo un reemplazo total sin versión** (D-16.129): es una duda para el
  usuario, no una deuda aceptada.
- **Ventas y costos fijos comparten la versión del mes**: un 409 espurio es posible entre dos personas
  que cargan cosas distintas del mismo mes a la vez.
- **`/ventas` no tiene prueba automatizada**; el arreglo de «solo las filas cambiadas» se sostiene con
  tipos, build y la lectura del código.
- **`PUT /ubicaciones/:id` no archiva**: `INACTIVE` no tiene efecto hoy.
