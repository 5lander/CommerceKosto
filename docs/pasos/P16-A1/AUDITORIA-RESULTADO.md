# P16-A1 — Resultado de la auditoría

**Fecha:** 2026-09-10 · **Paquete:** P16-A1 — API · IVA de compra en dos niveles + correo transaccional + límite de tasa + IP tras el proxy
**Veredicto provisional:** los ocho checks de código en verde sobre el árbol completo, 823 unitarias y 395 + 5 de integración en verde, dos migraciones verificadas; **la salida de `npm run audit` completo la pega el orquestador** en el bloque marcado abajo, y hasta entonces el paquete está 🟡 «construido, pendiente de auditoría final y commit».

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api`, la interfaz del back office, `tools` y `apps/web`, modo estricto máximo. Código 0 |
| `audit:lint` | ✅ | `eslint . --max-warnings=0 --no-inline-config`. Código 0 |
| `audit:forbidden` | ✅ | **44 reglas sobre 433 archivos** (eran 40 sobre 361 al cerrar el commit 0 de P16). Las cuatro nuevas están en `tools/audit/rules/correo.rules.mjs`: `conexion-del-despachador-solo-en-correo`, `cadena-del-despachador-solo-en-correo`, `correo-no-lo-monta-la-app`, `despachador-sin-ganchos-de-nest`. Guardián ejecutado (sabotaje, captura, reversión): abajo |
| `audit:arch` | ✅ | **351 módulos, 1529 dependencias**, sin violaciones. Dos reglas nuevas en `.dependency-cruiser.cjs`: `correo-inalcanzable-desde-la-app`, `correo-no-entra-desde-otros-modulos`; `despachador.ts` en la lista de entradas que no entran en `modules/backoffice` |
| `audit:deadcode` | ✅ | knip, código 0. `src/despachador.ts` y `scripts/despachador.mjs` declarados como entradas |
| `audit:complexity` | ✅ | complejidad ≤ 10, profundidad ≤ 3, funciones ≤ 40 líneas, ≤ 3 parámetros. Paró tres veces durante el paquete (`RegistrarMovimiento.ejecutar`, `resolverUno`, `LimitadorGlobalGuard` con un cuarto parámetro) y las tres veces se arregló el código |
| `audit:duplication` | ✅ | **0 clones**. Paró cuatro clones durante el paquete (`rol-despachador.mjs`, `DespachadorConnection`, `CUERPO_DE_RESTABLECIMIENTO`, el esquema de entorno del despachador) y los cuatro se extrajeron |
| `audit:migrations` | ✅ | M1–M11 · **15 migraciones** reversibles y con RLS (eran 13). Las dos nuevas con bloques `MANUAL`, `ENABLE + FORCE`, políticas, `GRANT` explícitos y su sección en `guardas-de-dominio.md` |
| `audit:secrets` | ✅ | secretlint sobre todo el árbol. Paró dos veces durante el paquete (una cadena de conexión de ejemplo en un spec y otra en este documento) y las dos se reescribieron |
| `audit:deps` | ✅ | `audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas`. | Sin dependencia nueva en el paquete (Resend va por `fetch`, sin SDK: OPTIMIZACION.md §1) |
| `audit:sec-headers` | ✅ | 19 pruebas en verde (381 saltadas por `--testNamePattern`, que es como funciona el check). | Las 18 pruebas de cabeceras no se tocaron; el 429 nuevo sale por el mismo `ErrorFilter` con las mismas cabeceras |
| `audit:tests` | ✅ | **823 unitarias** (con la base apagada; eran 585) + **400 de integración: 395 en verde, 5 saltadas con motivo** (INC-016; eran 313) |

Líneas de resultado de `npm run audit` sobre el árbol exacto del commit, sin los códigos de color
(la salida completa de vitest son ~3.000 líneas). Con `costeo-api` parado, INC-016:

```
audit:forbidden  OK — 44 reglas sobre 433 archivos
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 15 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 28 skipped (30)
      Tests  19 passed | 381 skipped (400)
 Test Files  57 passed (57)
      Tests  823 passed (823)
 Test Files  30 passed (30)
      Tests  395 passed | 5 skipped (400)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

Evidencia de los ocho checks de código, corridos uno a uno sobre el árbol completo al cerrar la documentación:

```
audit:types        EXIT 0
audit:lint         EXIT 0
audit:forbidden    OK — 44 reglas sobre 433 archivos                      EXIT 0
audit:arch         ✔ no dependency violations found (351 modules, 1529 dependencies cruised)
                   OK — reglas de capa respetadas y guardian verificado  EXIT 0
audit:complexity   EXIT 0
audit:duplication  Found 0 clones.                                        EXIT 0
audit:migrations   OK — 15 migracion(es) reversibles y con RLS            EXIT 0
audit:deadcode     EXIT 0
migrate:deploy     15 migrations found · No pending migrations to apply.  EXIT 0
```

### El guardián de las reglas nuevas (sabotaje → captura → reversión)

Un archivo temporal `apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts` que importa `CorreoModule` y `DespachadorConnection` y lee `DESPACHADOR_DATABASE_URL`, y un segundo desde la raíz de `src/`:

```
audit:forbidden  FALLO — 5 infraccion(es)
  [conexion-del-despachador-solo-en-correo]  Nombrar `DespachadorConnection` fuera del modulo de correo
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:2
  [cadena-del-despachador-solo-en-correo]  Leer `DESPACHADOR_DATABASE_URL` fuera del modulo de correo
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:3
  [correo-no-lo-monta-la-app]  Importar `CorreoModule` desde el arbol de la aplicacion cliente
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:1
  [correo-no-lo-monta-la-app]  apps/api/src/sabotaje-guardian-2.ts:1
audit:arch (con el sabotaje)
  error correo-no-entra-desde-otros-modulos: …/iam/infrastructure/sabotaje-guardian.ts → …/correo/infrastructure/despachador-connection.ts
  error correo-no-entra-desde-otros-modulos: …/iam/infrastructure/sabotaje-guardian.ts → …/correo/infrastructure/correo.module.ts
  x 2 dependency violations (2 errors, 0 warnings). 340 modules, 1479 dependencies cruised.
(revertido)
audit:forbidden  OK — 43 reglas sobre 419 archivos
audit:arch  OK — reglas de capa respetadas y guardian verificado
```

La cuarta regla, `despachador-sin-ganchos-de-nest`, nació de un hallazgo de la revisión adversarial (el cierre ordenado que no ocurría) y se verificó con el binario real: `SIGTERM` a los tres segundos, «se termina la pasada en curso y se sale», `exit 0` (antes: muerte por `process.kill` sin `exit`, código 1).

---

## Las dos migraciones, verificadas contra bases reales

```
npm run migrate:verify
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

Y porque `verify` solo corre sobre bases limpias (INC-011), **`down` + `deploy` sobre la base de desarrollo sembrada**: 108.471 artículos, 29 grupos, **16.123.203 movimientos (8.082.570 `COMPRA`)**. El `down` de la migración del IVA destruye el desglose de las 116 compras y las 89 tarifas corregidas —es lo que hace soltar una columna, y por eso el runbook pide respaldo antes de migrar— y al volver a aplicar todos los artículos quedan en la semilla 0.15; sobre 16 M de filas, segundos, porque las columnas nuevas son anulables o con `DEFAULT` constante. La del correo se re-aplicó con `down` + `deploy` tras la corrección de la revisión adversarial (`SELECT` por columnas) y quedó verificada: `has_column_privilege(rol, 'email_outbox', 'datos', 'SELECT')` → `costeo_app` **f**, `costeo_backoffice` **f**, `costeo_despachador` t.

**Dos tropiezos que dejaron rastro.** `ADD COLUMN … NOT NULL` generado por Prisma sobre una tabla con filas (se movió al bloque `MANUAL` con `DEFAULT 0.15` + `DROP DEFAULT`; 4/4 confirma que el estado final es el del esquema), y `$queryRaw` sobre una función `RETURNS void` («Failed to deserialize column of type 'void'»; se pide `::text` y se valida la tupla). Los dos en «Problemas» de `CONSTRUCCION.md`.

---

## Consultas del camino crítico — `EXPLAIN ANALYZE`

Medidas con la dueña dentro de una transacción con `ROLLBACK`, sobre siembras de tamaño realista (detalle y planes completos en `CONSTRUCCION.md`, «Consultas del camino crítico»):

```
tomarPendientes()  SELECT … FOR UPDATE SKIP LOCKED LIMIT 20      Bitmap Index Scan (estado) + Sort   9,96 ms   60.000 correos, 3.000 PENDIENTE
golpear()          ORDER BY at DESC LIMIT 11                       Index Only Scan, 11 entradas        0,07 ms   38.000 golpes, 18.000 de la clave
hitsDesde() (retirada)  sin LIMIT                                  Bitmap Heap Scan, 3.618 filas       1,35 ms   la razón del tope golpesQueDeciden
purgarLimites()    DELETE … WHERE at < ahora − 24 h                Seq Scan                            4,30 ms   38.000 filas (un día de golpes como mucho)
buscarArticulo     Index Scan purchase_article_id_item_id_key      rows=1                                        108.402 artículos
buscarGrupo        Seq Scan item_group                             rows=20                             0,07 ms   veinte filas: el planificador acierta
```

Lo que se dice sin adornos: el `sort` de `tomarPendientes` es lineal en las pendientes (el `OR` sobre `siguiente_intento_en` impide servir el `ORDER BY` desde el índice) y la purga es `Seq Scan`; con una cola sana y un día de golpes son milisegundos, y los dos quedan en «Deuda» con su arreglo si aparecen en las consultas caras. No hay consulta nueva sobre el camino crítico de costeo; **`npm run bench` sí se ejecutó**, aunque el paquete no añada consultas al camino de lectura: `pricing/domain/cadena-de-costo.ts` —que costea la carta entera— pasó a delegar el neteo en `shared/domain/iva/neteo.ts`, y eso basta para que I8 lo exija. Los resultados y lo que destaparon, en la sección siguiente.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | A1–A4: `shared/domain/iva`, `shared/domain/acceso`, `shared/domain/limite-de-tasa`, `inventory/domain/compra`, `pricing/domain/preparacion` y `modules/correo/domain` no importan nada de fuera de `domain`; los casos de uso nuevos (`TarifasDeIva`, `ReenviarInvitacion`, `SolicitarRestablecimiento`, `RestablecerContrasena`, `DespacharCorreo`, `LimitadorDeTasa`, `LeerSaludDelCorreo`) reciben sus puertos por constructor (`DespacharCorreo` se prueba con cola, mailer y reloj en memoria). A5: `PUT /catalogo/articulos/:id` y `PUT /catalogo/grupos/:id` viven en `catalog`; `inventory` y `pricing` leen la tarifa por `TarifasDeIva`, exportado por `CatalogModule`. A6: `cadena-de-costo.spec.ts` sigue en verde, con la base apagada, tras delegar en `netear`. `audit:arch`: 351 módulos sin violación, con dos reglas nuevas que aíslan `modules/correo` en los dos sentidos |
| **B · Código** | B1–B3 por los checks. B4–B6: `audit:complexity` paró tres veces y se extrajo (`filaDe`, `conTarifa`, la configuración del guard por propiedad). B7: `MINUTOS_DE_RESERVA`, `ESPERA_TRAS_EL_PRIMER_FALLO`…, `INTENTOS_MAXIMOS`, `HORAS_DE_LIMITE_QUE_SE_CONSERVAN`, `LARGO_MAXIMO_DEL_ERROR`, `IP_DE_CONTRASENA_POR_HORA`… B8: `Money`/`Ratio` en el neteo, cadenas decimales en las fronteras, `numeric(24,12)` en la base; ninguna tarifa ni importe como `number`. B9: `TarifaDeIvaDesconocidaError`, `CompraSinDesgloseError`, `PreparacionConIvaError`, `TokenDeRestablecimientoInvalidoError`, `LimiteDeSolicitudesError` (código nuevo `LIMITE_DE_SOLICITUDES`, mapeado en `error.filter.ts`). B10: el único `catch` que traga es el del `.env` ausente en `despachador.ts`, con el porqué escrito. B12: `.strict()` en los cuerpos nuevos; `fraccion` **en el campo** y probado acompañado de otro error (INC-008); el esquema del despachador verifica el rol en el campo y lo prueba acompañado de `CORREO_LOTE` inválido |
| **C · Seguridad** | C1–C2: `email_outbox` con `company_id` y política por tenant; `password_reset_token` y `rate_limit_hit` sin tenant por razón escrita (la segunda registrada como exención de ámbito en `SEGURIDAD.md` §2.1; M6 sigue vacía); las tres con `ENABLE + FORCE` en la migración que las crea. C3: `company_id` del outbox lo pone la app desde la sesión o la definer desde `app_user`; nunca la petición. C4: `TarifasDeIva` valida artículo→ítem (400) y company (404); el reenvío es 404 para un invitado de otra company. C5–C6: `iva-de-compra.spec.ts` verifica sobre la respuesta cruda de `BODEGA` que no aparecen `totalBruto`, `ivaTarifaAplicada`, `ivaRecuperableAplicado`, `desglose`, `costoTotal` ni `cantidad`, y 403 en el libro; `/correo/salud` crudo sin `datos`, `@` ni `token`. C7/C15: `$queryRaw` etiquetado sin `Prisma.raw` en la cola y en las definer; sin `ORDER BY` dinámico. C8: Argon2id en el restablecimiento; el token nunca en logs ni en `audit_log` (probado con el rol que sí ve el log). C10/C16: los cuatro endpoints con límite por IP **y** por destinatario, y bajo concurrencia. C11: `RESEND_API_KEY` y `COSTEO_DESPACHADOR_PASSWORD` en el `.env` y en `ci.yml` como secretos desechables. C13: `ResendError` lleva el estado y nunca el cuerpo de la respuesta; el error guardado se acota a 500. C14: las claves de `rate_limit_hit` son hashes; `system.ratelimit.exceeded` sin el correo ni su hash. C17: `/olvido` responde igual y hace el mismo trabajo en Node; el residuo de la base se reconoce, se acota y se mide (medianas < 50 ms). C18: `.strict()` en `CUERPO_DE_OLVIDO`, `CUERPO_DE_RESTABLECIMIENTO`, los `PUT` nuevos. C20: restablecer revoca **todas** las sesiones. C24: `MovimientoDto` es una unión discriminada; `SaludDelCorreo` tres campos. C25: `AbortSignal.timeout(10 s)` en Resend; `statement_timeout` en el rol del despachador. C27: `correo-transaccional`, `correo-despachador`, `backoffice-correo`, `limite-de-tasa`, `ip-tras-el-proxy` en verde. C28: `catalog.group.updated`, `auth.password.reset_requested` (con IP), `auth.password.reset_completed`, `user.invitation_resent`, `system.ratelimit.exceeded` (de transición) sembrados y escritos. C30: el back office lee `/correo/salud` **sin** fila en `backoffice_access_log`, y está dicho por qué (contadores sin dato de ningún tenant). **C9, C12, C19 (CSP), C21, C22, C23, C26, C29: sin cambio en este paquete** |
| **D · Base de datos** | D1: dos migraciones con `down.sql`, `migrate:verify` 4/4 y `down` + `deploy` sobre la base sembrada. D2: doce `CHECK` nuevos (cuatro del IVA, seis del correo, uno de tokens, uno de `kind`); `NOT NULL` y `UNIQUE (token_hash)`. D3: tres claves foráneas con `ON DELETE RESTRICT`. D4: `numeric(24,12)` y `timestamptz`. D5: los estados y plantillas van en `CHECK` y no en `enum` nativo (en la línea de las tablas de P1: no se creó tabla de catálogo para tres valores fijados por el código). D6–D7: `email_outbox(estado, siguiente_intento_en, created_at)`, `email_outbox(user_id, created_at DESC)`, `password_reset_token(token_hash)`, `password_reset_token(user_id, created_at DESC)`, `rate_limit_hit(kind, clave, at DESC)`, cada uno con su consulta en `modelo-datos.md`; ninguno empieza por `company_id` porque ninguna de las consultas filtra por tenant (la cola la lee un rol sin tenant, el token no lo tiene, los golpes tampoco). D8: `EXPLAIN ANALYZE` de las tres consultas nuevas, arriba. D9: los lotes de movimientos y precios leen grupos una vez por lote; el despachador marca fila a fila **a propósito** (un fallo por correo no puede arrastrar al lote). D10–D12: sin `SELECT *`; `count`/`_max` en SQL para la salud. D13: el envío a Resend ocurre **fuera** de la transacción, y por eso existe la reserva (ADR-025, decisión 6). D14: cada `CHECK` con su guarda de dominio y mensaje en `guardas-de-dominio.md` (M11), y la única que no puede tener CHECK detrás —«COMPRA nueva ⇒ desglose»— con guarda de aplicación y su limitación escrita (ADR-024, decisión 4) |
| **E · Reglas de negocio** | E1–E3: aislamiento en verde (`aislamiento-entre-companies`, `pentest`); la definer pone el `company_id` que la app no sabe; `rate_limit_hit` y `password_reset_token` no llevan tenant por razón escrita. E5: la corrección de una compra con desglose **copia los cuatro campos** y Σ(COMPRA) = 0 en bruto y en neto; sin `UPDATE`/`DELETE` sobre el libro (`audit:forbidden`). E8–E9 (R5): los precios de preparaciones existentes con tarifa ≠ 0 **no se reescriben** (D-16.51). E12 (R8): sobre la respuesta cruda de `BODEGA`, con los campos nuevos. E20 (R13): sigue en verde en `precios.spec.ts`; la recuperabilidad sigue siendo de la company y ahora es **foto del momento** en el libro (D-16.42). E22: sin punto flotante; CC-IVA-01..04 calculados a mano y en verde. Las 400 de integración pasan con los cambios, incluida la conciliación R7 (E11) |
| **F · Frontend** | — no aplica: el paquete no toca `apps/web` |
| **G · Pruebas** | G1: 823 + 395 (5 saltadas con motivo). G2–G3: 238 unitarias nuevas, todas con la base apagada, incluidas las del despachador (cola, mailer y reloj en memoria) y las 71 del parseo de IP. G4: aislamiento entre companies con el rol del despachador (dos companies encolan, una pasada envía los dos, y su rol recibe `42501` en todo lo demás). G5: sobre la respuesta cruda, en `iva-de-compra.spec.ts` y `backoffice-interfaz.spec.ts`. G6: CC-IVA-01..04 nuevos en `casos-conocidos.md`, con el resultado calculado a mano antes que el código. G7: correos `@snacklab.ec` y `@ejemplo.test`, IP de los rangos de documentación (`203.0.113.0/24`, `198.51.100.0/24`); ningún dato real |
| **H · Documentación** | H1: `CONSTRUCCION.md` con todas sus secciones (resumen, plan, qué se construyó por capa y por etapa, decisiones, consultas con `EXPLAIN`, pruebas con cantidades, problemas, deuda, cómo probar, incidencias). H2: los cinco endpoints nuevos en `app-cliente.md` (`/auth/password/olvido`, `/auth/password/restablecimiento`, `/usuarios/:id/reenvio-de-invitacion`, `PUT /catalogo/articulos/:id`, `PUT /catalogo/grupos/:id`) y `/correo/salud` en `back-office.md`. H3: `FUNCIONAMIENTO.md` con la sección del correo y dos `sequenceDiagram`, el grafo de la petición con el guard nuevo y la composición de `shared` al día. H4: `modelo-datos.md` con los dos bloques de P16-A1 (columnas del IVA; las tres tablas con erDiagram, privilegios, restricciones e índices) y la nota de las cinco definer. H5: `configuracion.md` al día con `environment.ts`, `entorno-del-despachador.ts` y `.env.example`. H6: ADR-024, ADR-025, ADR-026 con sus filas en el índice. H7: `despliegue.md`, `puesta-en-marcha.md`, `rotacion-secretos.md`. H8: entrada de cierre en `CHANGELOG.md`. H9: CC-IVA-01..04. H10–H12: INC-022 con ficha, fila en el índice y prevención automatizada (tres suites); cero recurrencias. H13: tres frases que describían lo planeado se corrigieron al cerrar (`modelo-datos.md` «ninguna tabla nueva», `configuracion.md` «`costeo_backoffice` no existe todavía», la entrada provisional del CHANGELOG). H14: este archivo |
| **I · Optimización** | I1–I3 por los checks (0 clones tras extraer cuatro). I4: `ColaDeCorreo`, `RegistroDeLimites`, `Enlaces` son puertos con una implementación real y una en memoria para las pruebas; `ConexionConRolPropio` tiene dos implementaciones (back office y despachador). I5: nada de CPU pesada en la API; el envío HTTP vive en el tercer proceso. I6: el despachador envía **en serie** a propósito (un proveedor con límite de tasa propio y una reserva que se renueva por fila); `RegistrarMovimiento` hace dos lecturas en paralelo, acotadas. I7: sin caché nuevo. **I8: se midió, y el consolidado no cabe en su presupuesto en esta máquina** — sección propia abajo; no es regresión del paquete (normalizado al suelo del entorno es idéntico a P15) pero **no se declara verde**. I9: no toca `apps/web`. I10: `golpesQueDeciden` (3.618 filas → 11; 1,35 ms → 0,07 ms) y las lecturas de grupos una vez por lote, con antes/después en `CONSTRUCCION.md` |

---

## `npm run bench` — el presupuesto de §5, y las dos cosas que destapó

**Ejecutarlo era el requisito (AUDITORIA.md I8) y ejecutarlo fue el hallazgo.**

### 1. Llevaba dos paquetes sin poder arrancar

```
· Sembrando el volumen sintetico (tarda; son ~220.000 movimientos)
psql:<stdin>:43: ERROR:  column "max_locations" of relation "company" does not exist
LINE 1: INSERT INTO company (id, name, status, max_locations)
```

P11 borró `company.max_locations` y puso el límite en la tabla `plan`; `scripts/lib/volumen.sql`
—escrito por P15 dos días antes— se quedó insertándola. **Nada lo veía**: no es TypeScript (knip no
lo mira), no es una migración (M1–M11 no la miran) y la regla `script-de-package-json-apunta-a-nada`
solo comprueba que `scripts/bench.mjs` exista. Es la **primera recurrencia de INC-017**, registrada
en su ficha con lo que añade: el SQL suelto que acompaña a un script no lo verifica ninguna
herramienta, y la única prevención es ejecutarlo.

Arreglado con `plan_code = 'PROFESIONAL'` —el volumen que el propio archivo siembra (10 ubicaciones,
500 ítems, 200 productos) **no cabe en `BASICO`**, que permite 300 productos— y de paso el informe
de consultas dejó de escribirse en `docs/pasos/P15/`, donde estaba clavado: la primera corrida de
este paquete **pisó la evidencia ya commiteada de P15**. Ahora es `npm run bench -- --informe=<carpeta>`
y sin la bandera no escribe nada.

### 2. El consolidado no cabe en su presupuesto en esta máquina

Tres corridas, la primera con la interfaz y otros procesos encima y las dos últimas con la máquina
en reposo:

| Medición | P15 (`c4450e7`) | P16-A1 con carga | P16-A1 en reposo | P16-A1 en reposo (2ª) |
|---|---|---|---|---|
| suelo del entorno (validar sesión) | 4,5 ms | 22,8 ms | 6,6 ms | 6,5 ms |
| costeo de la carta (200 productos) | 75,3 / 400 | 195,0 | 110,6 | **89,6** ✅ |
| inventario valorizado (500 ítems) | 110,2 / 300 | 287,8 | 140,0 | **146,2** ✅ |
| **consolidado (10 ubicaciones)** | **677,5 / 800** | 1929,1 | 962,6 | **940,9** ❌ |
| guardar una receta | 51,8 / 150 | 102,0 | 88,6 | **87,4** ✅ |

**No es una regresión de P16-A1, y se puede demostrar sin creerlo:**

1. **Las consultas son las mismas y se llaman las mismas veces.** El informe de
   `pg_stat_statements` trae la misma lista que P15 con los mismos recuentos (561, 396, 99, 396…).
   No hay consulta nueva, no hay N+1, no hay una llamada de más. La única diferencia estructural es
   una columna más en el `SELECT` de `purchase_article` (`iva_tarifa`), que es exactamente lo que el
   paquete añade.
2. **El suelo del entorno subió con todo lo demás.** Ese suelo es «validar sesión», que este paquete
   no toca: 4,5 → 6,5 ms. Normalizado, el consolidado cuesta **143,7 suelos** hoy y costaba **149,6**
   en P15 — es decir, relativamente **igual o algo mejor**.
3. La máquina no es la de P15: la base de desarrollo pasó de 12 MB (recién reseteada) a **5,7 GB** en
   el mismo clúster, compitiendo por los 2 GB del contenedor.

**Y aun así el check tiene razón: 940,9 ms de 800 es rojo, y no se sube el umbral** (AUDITORIA.md I8).
Lo que esto destapa es la **deuda técnica #2 de `ESTADO.md`** —las vistas materializadas para períodos
cerrados, diseñadas en ADR-012 §7— cuya condición de pago era «cuando aparezca una company con más de
diez ubicaciones **o cuando el número de CI se acerque al techo**». P9 midió 734/800, P15 midió
677,5/800 y hoy no cabe. **Es una decisión del usuario, no de este paquete**, y está en `ESTADO.md`
como duda abierta con estos números.

**Lo que además queda dicho:** `npm run bench` **no lo ejecuta CI** (`ci.yml` corre `npm run audit` y
`migrate:verify`, no el bench). El presupuesto del consolidado no lo vigila nadie automáticamente, que
es exactamente el riesgo que la propia fila I8 declaraba en voz alta.

---

## Lo que queda dicho, no escondido

- **El envío real por Resend no se ha ejercitado.** El adaptador está probado contra un `fetch`
  falso (2xx, 5xx, 401, timeout, fallo de red); la cuenta, el dominio y DKIM/SPF/DMARC dependen del
  usuario, y el runbook de puesta en marcha (Paso 6b) dice qué evidencia hay que guardar.
- **D-16.51 (una preparación no lleva IVA de compra) está pendiente de ratificación del usuario**
  antes del commit; si la rechaza, se revierte `pricing/domain/preparacion.ts`, sus dos llamadas y
  la prueba.
- **La imagen de producción con el servicio `correo` no se ha construido**, y el ensayo completo
  de despliegue con la subred fija y la IP de Caddy tampoco: `docker compose config` valida los dos
  archivos y `dist/despachador.js` compila, pero INC-018/019/020 enseñaron que hay una clase de
  fallo que solo aparece levantando la pila entera. Es el paso 0 del runbook de puesta en marcha.
- **`ci.yml` no se ejecutaba de verdad desde P11** (faltaban las variables del back office; ahora
  están, con las dos del despachador). La primera corrida tras el commit es la que lo confirma.
- **Cuatro revisiones adversariales, 19 hallazgos, uno crítico** (el límite que no limitaba bajo
  concurrencia: 30 de 30 aceptadas). Todos atendidos con prueba que los reproduce; el crítico no
  se registró como incidencia nueva porque queda en INC-022 como corrección y en ADR-026 como
  principio, y su prevención es la 🔴 en paralelo.
- **`tomarPendientes` hace un `sort` de todas las pendientes y la purga es `Seq Scan`**: con una
  cola sana y un día de golpes son milisegundos, y está escrito dónde mirar y qué índice poner si
  dejan de serlo.
