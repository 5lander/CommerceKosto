# P16-A1 — Documento de construcción

**Paquete:** P16-A1 — API · modelo de IVA en dos niveles + correo transaccional + límite de tasa + IP tras el proxy · **Inicio:** 2026-09-09 · **Cierre de construcción:** 2026-09-10 · **Estado:** 🟡 construido, pendiente de auditoría final y commit

> Primer paquete de código de la pasada P16 → P20 (`docs/pasos/P16/PLAN.md`, sección P16-A1). Las
> decisiones cerradas por el usuario están en `ESTADO.md` → «Pasada P16 → P20»; las de este paquete,
> D-16.40…D-16.50, abajo y en la misma sección de `ESTADO.md`. El mapa literal del código que se toca
> (cuatro lecturas de solo lectura, 2.553 líneas) está en el scratchpad de la sesión
> (`mapa-p16-a1.md`); lo que de él importa para decidir está copiado aquí.

---

## Resumen

Tres cosas que el backend no sabía hacer y el producto necesita antes de la primera pantalla nueva:

1. **IVA de compra en dos niveles (Fase 1).** El bodeguero escribe el total de la factura con IVA;
   la tarifa es del artículo (o del grupo), la recuperabilidad es de la company; el libro persiste
   los cuatro importes y **nunca asume 0.15**.
2. **Correo transaccional (Fase 3).** Outbox transaccional, despachador con rol propio en proceso
   aparte, tres adaptadores (`fake` · `consola` · `resend`), invitación con enlace, reenvío, y
   restablecimiento de contraseña con dos funciones `SECURITY DEFINER` que escriben.
3. **Límite de tasa e IP tras el proxy.** `LimitadorDeTasa` por IP y por destinatario sobre
   `rate_limit_hit`, y `ipDelCliente` con `PROXY_DE_CONFIANZA` — hoy, detrás de Caddy, todo llega
   con la IP del proxy y el bloqueo por IP del login sería un bloqueo global (INC-022).

## Objetivo del paquete

Criterio de aceptación: **las 🔴 de la sección P16-A1 del plan en verde**, `npm run audit` en verde,
dos migraciones reversibles verificadas con `migrate:verify` y con el `down` sobre la base sembrada,
y la documentación del paquete completa (ADR-024, ADR-025, ADR-026, INC-022, SPEC §11/§12, APIs,
modelo de datos, configuración, seguridad, runbooks).

---

## Plan aprobado (Fase PLAN, modo autónomo)

### Hallazgos de la lectura que cambian el diseño del plan

| Hallazgo | Consecuencia |
|---|---|
| `password_reset_consume` devolviendo solo `user_id` no basta: `guardarHashDeContrasena` y `revocarSesionesDe` van por `TenantTransaction.run(companyId)` | La definer devuelve `(user_id, company_id)` — D-16.47 |
| `InvitarUsuario` envía el correo **fuera** de la transacción de `organizacion.invitar()`; el caso de uso no ve el `tx` | El encolado lo hace el repositorio, dentro de su transacción — D-16.48 |
| `evaluarIntentos` vive en `iam/domain` y `shared` no puede importar de un módulo | La política se generaliza y se muda a `shared/domain` — D-16.50 |
| El `ThrottlerGuard` global usa su propio rastreador de IP, no `ipDe` | Gana `getTracker` con `ipDelCliente`: si no, 300 req/min compartidos por todos — D-16.49 |
| `MAIL_ADAPTER=real` lanza; no hay `fetch` saliente probado ni fake timers | `resend` recibe el `fetch` por constructor y se prueba con uno falso; el tiempo va por el puerto `Reloj` |
| `company_settings.iva_compra` es el default de `SugerirPrecio` | Deja de leerse (D-16.43); la columna queda hasta P16-B |
| El CSV de `MOVIMIENTOS` nunca trae artículo; el de `ARTICULOS` no trae IVA y la columna nace `NOT NULL` | Los dos ganan columna opcional `ivaTarifa` con la precedencia por fila — D-16.44 |
| `SPEC.md` no contiene «R13»: el parámetro está en §11 y la fórmula en §12 | Se reescriben §11 y §12; `CLAUDE.md` R13 no se toca (sigue siendo cierto) |
| No existe `apps/api/test/soporte/` con helpers de app/login: cada suite copia su bloque | Las suites nuevas copian el bloque de `catalogo.spec.ts`, como las 24 existentes |
| `ADR-019` ya existe (capa visual) | Los ADR de la pasada corren uno: IVA = **ADR-024**, correo = **ADR-025**, límite e IP = **ADR-026** |

### Decisiones de este paquete

| # | Decisión | Razón |
|---|---|---|
| **D-16.40** | La fórmula de neteo vive **una sola vez** en `shared/domain/iva/neteo.ts` (`netear({bruto, tarifa, recuperable})`, SPEC §12 literal) y `pricing/domain/cadena-de-costo.ts` la llama; la precedencia `elegirTarifa({cuerpo, articulo, grupo})` y el error `TarifaDeIvaDesconocidaError` (`ENTRADA_INVALIDA` → 400) viven al lado | Dos módulos con la misma fórmula son dos oportunidades de que difieran (decisión 16 de P5) |
| **D-16.41** | `total_cost` pasa a ser el **neto** solo en las `COMPRA` nuevas; `PRODUCCION` y el resto no cambian. `desglose_conocido` solo puede ser `true` en `COMPRA`; la **corrección copia los cuatro campos** del original, así Σ(COMPRA) se cancela sola y la corrección no queda «sin desglose». CHECK `inventory_movement_desglose_coherente` | El plan no distinguía tipo; la corrección conserva el tipo (decisión 20 de P6) |
| **D-16.42** | `iva_recuperable_aplicado` e `iva_tarifa_aplicada` son la **foto del momento de la compra**; cambiar el ajuste después no reescribe el libro. `compras_del_mes` (SPEC §16) sigue sumando `total_cost`: en filas nuevas es neto, coherente con `costo_neto_uso`; en filas «sin desglose» es lo que se tecleó. La discontinuidad queda dicha en ADR-024 y en la pantalla del libro (P16-C) | D-16.18: no se rellena; el libro es append-only |
| **D-16.43** | `company_settings.iva_compra` **deja de leerse** como default de `SugerirPrecio` y del lote de precios: la precedencia es cuerpo > artículo > grupo → 400. La columna y su CHECK quedan hasta P16-B, que toca `ajustes` | D-16.9: dos niveles, ninguno es la company |
| **D-16.44** | Los CSV `MOVIMIENTOS` y `ARTICULOS` ganan la columna opcional `ivaTarifa` (alias «iva», «tarifa iva», «iva compra»); la precedencia por fila es fila > artículo (si la fila resuelve uno) > grupo del ítem; sin tarifa, la fila se **rechaza en el análisis** con su número, como una unidad desconocida (P14b). `PRECIOS` conserva `ivaCompra` opcional con la misma cadena | «Nunca 0.15» vale también para el importador |
| **D-16.45** | `PUT /catalogo/articulos/:id` y `PUT /catalogo/grupos/:id` se construyen **aquí**, no en A2: sin ellos la semilla `0.15` de los artículos existentes no se puede corregir. `GET /catalogo/articulos` y `/grupos` devuelven `ivaTarifa` | La pantalla 8 la quiere precargada |
| **D-16.46** | `email_outbox` gana `siguiente_intento_en timestamptz NULL` (no estaba en el plan): sin ella, cinco reintentos serían cinco pasadas seguidas. Espera 1 → 2 → 4 → 8 min; al quinto fallo, `FALLIDO` y `datos` saneado. Estados `PENDIENTE` · `ENVIADO` · `FALLIDO` con CHECK; `ENVIADO ⇔ sent_at`. Plantillas `INVITACION` · `RESTABLECIMIENTO` con CHECK. `costeo_app` solo `SELECT, INSERT` bajo su tenant; `costeo_despachador` `SELECT, UPDATE` con política permisiva; `costeo_backoffice` `SELECT` para la salud | D-16.19, D-16.27, D-16.34 |
| **D-16.47** | `password_reset_request(p_email, p_token_hash, p_expires_at, p_datos jsonb) RETURNS void` busca el usuario **activo**, inserta el token y encola el correo (con `company_id` y `user_id` del usuario) en una sola función; sin usuario, no hace nada y devuelve igual. `password_reset_consume(p_token_hash, p_ahora) RETURNS TABLE(user_id, company_id)` marca `used_at` si no estaba usado ni caducado y devuelve la fila (vacío si no). Son `VOLATILE` y las dos únicas definer que escriben; `password_reset_token` solo tiene política `_migrator` (deny para la app) | D-16.26, D-16.31; el `company_id` faltaba |
| **D-16.48** | `RepositorioDeOrganizacion.invitar()` recibe el correo a encolar y lo inserta **en la misma transacción** que la invitación (`shared/infrastructure/persistence/outbox.ts`, helper de escritura). `InvitarUsuario` ya no llama a `send`. `ReenviarInvitacion` (`POST /usuarios/:id/reenvio-de-invitacion`, mismo permiso que invitar) genera token nuevo, invalida el anterior y encola. Los correos llevan **enlace** (`APP_URL/activacion?token=…`, `APP_URL/restablecer?token=…`) y su caducidad; `DIAS_DE_INVITACION` sigue siendo constante (7); `HORAS_DE_RESTABLECIMIENTO` es variable de entorno (1) | Outbox transaccional; D-16.34 |
| **D-16.49** | `ipDelCliente(peticion, proxies)` en `shared/infrastructure/http/ip-del-cliente.ts`: toma el **último salto** de `X-Forwarded-For` solo si `socket.remoteAddress` está en `PROXY_DE_CONFIANZA` (IP exacta o CIDR v4; v6 exacta), y devuelve la IP del socket si la cabecera no parsea como IP (`login_attempt.ip` es `INET`). Lo usan el login, el back office, el limitador **y el `ThrottlerGuard` global** (subclase con `getTracker`). Producción: la red de compose gana subred fija `172.28.0.0/24` y `PROXY_DE_CONFIANZA=172.28.0.0/24` en la plantilla del `.env`; desarrollo, vacío = socket | D-16.36; la red sin subred fija haría silencioso el fallo |
| **D-16.50** | `evaluarIntentos` se **generaliza** con una `PoliticaDeIntentos {umbral, ventanaDeDisparoMs, ventanaDeEscaladaMs, escalaDeBloqueoMinutos}` y se muda a `shared/domain/acceso/politica-de-intentos.ts`; `iam/domain` conserva sus constantes (cuenta 5 / IP 25) y reexporta. `LimitadorDeTasa` (`shared/application/limite-de-tasa/`) aplica por `kind` sus políticas: `password.olvido` IP 10/h · destinatario 3/h; `password.restablecimiento` IP 10/h; `usuario.invitar` y `usuario.reenvio` IP 30/h · destinatario 3/h. `rate_limit_hit(kind, clave, at)` con `clave = ip:<ip>` o `correo:<sha256>` (minimización: no se guardan correos de desconocidos). 429 `LIMITE_DE_SOLICITUDES` con `Retry-After` y el minuto en el mensaje | D-16.17, D-16.24, D-16.28; SEGURIDAD.md §2.1 |

### Lo que se construye, por capa

**Migraciones (dos, reversibles, M1–M11):**

1. `p16a1_iva_de_compra`: `purchase_article.iva_tarifa numeric(24,12) NOT NULL` (semilla `0.15` por `DEFAULT` + `DROP DEFAULT`, dicho en `-- MANUAL:`), CHECK `0..1`; `item_group.iva_tarifa numeric(24,12) NULL` + CHECK; `inventory_movement`: `total_bruto numeric(24,12) NULL`, `iva_tarifa_aplicada numeric(24,12) NULL`, `iva_recuperable_aplicado boolean NULL`, `desglose_conocido boolean NOT NULL DEFAULT false` + CHECK de coherencia (D-16.41). Sección en `guardas-de-dominio.md`.
2. `p16a1_correo_y_limite_de_tasa`: guarda `RAISE EXCEPTION` si falta `costeo_despachador`; `email_outbox`, `password_reset_token`, `rate_limit_hit` con RLS (ENABLE + FORCE + políticas; lista M6 vacía); GRANTs tabla por tabla (`GRANT USAGE ON SCHEMA public TO costeo_despachador` primero); las dos definer con `REVOKE … FROM PUBLIC` + `GRANT … TO costeo_app`; `audit_event_type` nuevos (`auth.password.reset_requested` si falta, `auth.password.reset_completed`, `user.invitation_resent`, `system.ratelimit.exceeded` si falta) con `ON CONFLICT DO NOTHING` (no se borran en el down). Sección en `guardas-de-dominio.md`.

**Dominio (puro, con sus `*.spec.ts` al lado):** `shared/domain/iva/{neteo,precedencia,errores}.ts` · `shared/domain/acceso/politica-de-intentos.ts` (generalizada) · `shared/domain/limite-de-tasa/politicas.ts` (kinds y umbrales) · `modules/correo/domain/{reintentos,saneado}.ts` · `iam/domain` reexporta la política con sus constantes.

**Aplicación:** `catalog`: `TarifasDeIva` (artículo y grupo de un ítem), `ActualizarArticulo`, `ActualizarGrupo` · `inventory`: `RegistrarMovimiento` y `RegistrarMovimientosEnLote` con la precedencia y los cuatro importes; `CorregirMovimiento` copia los cuatro · `pricing`: `SugerirPrecio` y lote con la precedencia; `cadena-de-costo` llama a `netear` · `imports`: descriptores y traducción con `ivaTarifa` · `iam`: `InvitarUsuario` encola, `ReenviarInvitacion`, `SolicitarRestablecimiento`, `RestablecerContrasena` · `shared/application/correo/{plantillas,correo-a-encolar}.ts` · `shared/application/limite-de-tasa/limitador.ts` + puerto `RegistroDeLimites` · `modules/correo/application/despachar-correo.ts` + puerto `ColaDeCorreo`.

**Infraestructura:** repositorios Prisma ampliados (`catalog`, `inventory`, `pricing`, `iam`: `invitar` con outbox, `reenviar`, definer por `$queryRaw` con esquema zod) · `shared/infrastructure/persistence/{outbox,prisma-registro-de-limites}.ts` · `shared/infrastructure/http/{ip-del-cliente,limitador-global.guard}.ts`; `error.filter.ts` emite `Retry-After` si el error lo trae · `shared/infrastructure/correo/{mailer.provider,consola-mailer,resend-mailer}.ts` · `modules/correo/infrastructure/{despachador-connection,prisma-cola-de-correo,correo.module}.ts` + `src/despachador.ts` + `scripts/despachador.mjs` (`npm run correo:despachar`) · `scripts/rol-despachador.mjs` (`npm run rol:despachador`), `roles.sql`, `10-bootstrap.sh` · `environment.ts`: `MAIL_ADAPTER fake|consola|resend`, `RESEND_API_KEY`, `RESEND_REMITENTE`, `APP_URL`, `HORAS_DE_RESTABLECIMIENTO`, `PROXY_DE_CONFIANZA`; `despachador` con su propio esquema (`DESPACHADOR_DATABASE_URL` con rol verificado, `MAIL_ADAPTER`, `RESEND_*`, `CORREO_INTERVALO_MS`) · backoffice: `GET /correo/salud` y tarjeta en `cartera`, `CORREO_MINUTOS_DE_ALERTA` · compose: servicio `correo` (misma imagen que `api`, `command` propio, `restart: unless-stopped`, latido como healthcheck), `COSTEO_DESPACHADOR_PASSWORD`, subred fija en producción · `desplegar.sh` y `preparar.sh` al día · reglas: `correo.rules.mjs` (tres, espejo de las del back office), `tenant.rules.mjs` exime `despachador-connection.ts`, dependency-cruiser en los dos sentidos y `despachador.ts` en la lista de entradas · controladores: `POST /auth/password/olvido` (202 siempre), `POST /auth/password/restablecimiento`, `POST /usuarios/:id/reenvio-de-invitacion`, `PUT /catalogo/articulos/:id`, `PUT /catalogo/grupos/:id`; `ivaTarifa` en artículo/grupo/movimiento; `desglose` en `MovimientoDto`.

**Pruebas 🔴 (integración salvo que se diga):** CC-IVA-01..04 (unitarias, `shared/domain/iva`) y la cadena completa `POST /inventario/movimientos` con los cuatro importes y `desglose_conocido = true`; sin tarifa → 400; corrección con desglose; BODEGA sobre respuesta cruda del libro con los campos nuevos; `SugerirPrecio` sin tarifa → 400; E20 sigue; outbox transaccional (invitación → fila `PENDIENTE` en la misma transacción; `datos` con `token=`); dos companies → el despachador envía los dos (`createApplicationContext` del módulo de correo, patrón de `backoffice.spec.ts`); `costeo_despachador` no lee otras tablas (`permission denied`, patrón `roles-de-base-de-datos.spec.ts`); tras `ENVIADO`, `datos` no contiene `token=`; reintentos y tope con `Simulation.failNext`; `/olvido` y `/restablecimiento` sin sesión; token dos veces → 400; caducado → 400 (moviendo `expires_at` con la dueña); restablecer revoca sesiones; respuesta de `/olvido` idéntica exista o no el correo; límite por endpoint, por IP y por destinatario (app levantada con `rateLimit.max` alto); purga de `rate_limit_hit`; cabecera `X-Forwarded-For` falseada con par no confiable (clave = socket) y con par confiable (`PROXY_DE_CONFIANZA` con `127.0.0.1`); `/correo/salud` crudo sin `datos`; `resend` con `fetch` falso (2xx, 5xx, timeout); `migrate:verify` y `down` sobre la base sembrada (evidencia pegada aquí).

**Documentación:** ADR-024, ADR-025, ADR-026, INC-022, SPEC §11/§12, `docs/apis/app-cliente.md`, `modelo-datos.md`, `configuracion.md`, `seguridad.md` + `SEGURIDAD.md`, `guardas-de-dominio.md`, `casos-conocidos.md`, runbooks `despliegue.md` y `puesta-en-marcha.md`, CHANGELOG, ESTADO (tablero), este archivo y `AUDITORIA-RESULTADO.md`.

**Fuera de este paquete, a propósito:** `GET /usuarios` con `correoInvitacion` (P16-C), CSRF (P16-A2), `import_job.sha256` (P20), el envío real manual (depende de la cuenta de Resend del usuario; queda en el runbook).

---

## Qué se construyó

### Inventario por capa (lo que hay en el árbol al cerrar; el detalle por etapa, debajo)

| Capa | Fase 1 — IVA | Fase 3 — correo y restablecimiento | Límite de tasa e IP |
|---|---|---|---|
| **Migraciones** | `20260910012847_p16a1_iva_de_compra` (+6 columnas, 4 CHECK, 1 evento) | `20260910042649_p16a1_correo_y_limite_de_tasa` (3 tablas, RLS, GRANT por columnas, 2 definer, 4 eventos) | la misma: `rate_limit_hit` y su CHECK |
| **Dominio** (puro, con spec al lado) | `shared/domain/iva/{neteo,precedencia,tarifa,errores}` · `inventory/domain/compra` · `pricing/domain/preparacion` · `motivoDeTarifaInvalida` en los tres `lote.ts` | `modules/correo/domain/{reintentos,saneado}` · `shared/application/correo/{plantillas,correo-a-encolar}` | `shared/domain/acceso/politica-de-intentos` (generalizada; `iam/domain` delega) · `shared/domain/limite-de-tasa/politicas` (+ `LimiteDeSolicitudesError`) |
| **Aplicación** | `catalog`: `TarifasDeIva`, `ActualizarArticulo`, `ActualizarGrupo` · `inventory`: `RegistrarMovimiento[EnLote]`, `CorregirMovimiento` · `pricing`: `SugerirPrecio[sEnLote]` sin default · `imports`: `ivaTarifa` en descriptores | `iam`: `InvitarUsuario` (encola), `ReenviarInvitacion`, `SolicitarRestablecimiento`, `RestablecerContrasena`, `IniciarSesion` (encola `BLOQUEO`) · `correo`: `DespacharCorreo` + puerto `ColaDeCorreo` · `backoffice`: `LeerSaludDelCorreo` | `shared/application/limite-de-tasa/limitador` + puerto `RegistroDeLimites` (`golpear`); los cuatro casos de uso lo llaman primero |
| **Infraestructura** | repositorios Prisma de `catalog`, `inventory` (`comoFila` con `exigirDesgloseEnCompra`), `pricing`; DTOs; controladores (`PUT` de artículos y grupos) | `persistence/outbox` · `prisma-organizacion` (invitar + reenviar) · `prisma-autenticacion` (definer por `$queryRaw`, `encolarCorreo`) · `correo/{mailer.provider,consola-mailer,resend-mailer,entorno-de-correo}` · `modules/correo/infrastructure/{despachador-connection,prisma-cola-de-correo,correo.module,bucle,entorno-del-despachador}` · `persistence/conexion-con-rol-propio` · `enlaces-de-la-app` · controladores `/auth/password/*`, reenvío, `/correo/salud` | `http/{ip-del-cliente,limitador-global.guard}` · `persistence/prisma-registro-de-limites` · `error.filter` (`Retry-After`, 429 nuevo) · `environment.ts` (`PROXY_DE_CONFIANZA`, `APP_URL`, `HORAS_DE_RESTABLECIMIENTO`, `MAIL_ADAPTER`, `RESEND_*`) · `backoffice/proxies-de-confianza` |
| **Procesos y despliegue** | — | `src/despachador.ts` · `scripts/despachador.mjs` · `scripts/rol-despachador.mjs` + `scripts/lib/rol-de-base.mjs` · `roles.sql`, `10-bootstrap.sh` · servicio `correo` en compose · `desplegar.sh` 5/8 · `preparar.sh` · `ci.yml` | subred fija y `caddy` con IP fija en `docker-compose.prod.yml` |
| **Reglas de auditoría** | — | `tools/audit/rules/correo.rules.mjs` (4 reglas) · `tenant.rules.mjs` (exención) · `.dependency-cruiser.cjs` (2 reglas) · `knip.json` (entrada) | — |
| **Pruebas** | 30 unitarias · `iva-de-compra.spec.ts` (25) · 10 suites existentes al día | 73 unitarias · `correo-transaccional` (22) · `correo-despachador` (12) · `backoffice-correo` (3) · `backoffice-interfaz` (+2) · `autenticacion-y-autorizacion` (helper) | 135 unitarias · `limite-de-tasa` (14) · `ip-tras-el-proxy` (3) · `limitador` (+1) · `backoffice-correo` (+1) |
| **Documentación** | ADR-024 · SPEC §11/§12 · `casos-conocidos.md` (CC-IVA-01..04) · `guardas-de-dominio.md` · `app-cliente.md` · `modelo-datos.md` | ADR-025 · `modelo-datos.md` · `configuracion.md` · `seguridad.md` · `SEGURIDAD.md` · `FUNCIONAMIENTO.md` · `guardas-de-dominio.md` · `app-cliente.md` · `back-office.md` · runbooks `despliegue`, `puesta-en-marcha`, `rotacion-secretos` | ADR-026 · INC-022 · `configuracion.md` · `seguridad.md` · `SEGURIDAD.md` §2.1 · `despliegue.md` |

### Fase 1 — el IVA de compra en dos niveles (D-16.9, D-16.10, D-16.18, D-16.25, D-16.40…D-16.45)

**Migración `20260910012847_p16a1_iva_de_compra`** (reversible, M0–M11 en verde, `migrate:verify` 4/4 + catálogo RLS en verde — evidencia abajo). `purchase_article.iva_tarifa numeric(24,12) NOT NULL` sembrada con `DEFAULT 0.15` y `DROP DEFAULT` en la misma migración (el comentario dice «semilla, no verdad»); `item_group.iva_tarifa numeric(24,12) NULL`; `inventory_movement.total_bruto`, `iva_tarifa_aplicada`, `iva_recuperable_aplicado` (NULL) y `desglose_conocido boolean NOT NULL DEFAULT false`. CHECKs: `purchase_article_iva_tarifa_es_fraccion`, `item_group_iva_tarifa_es_fraccion`, `inventory_movement_desglose_coherente` (D-16.41: todo o nada, y solo en `COMPRA`) e `inventory_movement_desglose_en_rango`. Semilla `audit_event_type` `catalog.group.updated` (`catalog.article.updated` ya existía desde P2). Sección en `docs/sistema/guardas-de-dominio.md`. La línea `ADD COLUMN … NOT NULL` que Prisma generó para `purchase_article` se movió al bloque MANUAL con la semilla: sobre una tabla con filas fallaba, y el estado final es idéntico al del esquema (lo comprueba 4/4).

**Dominio (`shared/domain/iva/`, puro, con sus specs al lado):** `neteo.ts` (`netear({bruto, tarifa, recuperable})`, SPEC §12 literal, escala `DIVISION`) · `precedencia.ts` (`elegirTarifa({cuerpo, articulo, grupo})` → cadena o `null`) · `tarifa.ts` (`exigirTarifaValida`, la guarda 🔴 de los dos CHECK de fracción) · `errores.ts` (`TarifaDeIvaDesconocidaError` con los tres sitios donde ponerla, `TarifaDeIvaInvalidaError`; los dos `ENTRADA_INVALIDA`, sin código nuevo). `pricing/domain/cadena-de-costo.ts` llama a `netear` y sus pruebas siguen iguales. `inventory/domain/compra.ts`: `desglosarCompra({bruto, tarifa, recuperable})` → `{costoTotal (neto), desglose: {totalBruto, ivaTarifaAplicada, ivaRecuperableAplicado}}`, la única forma de construir un desglose (por eso el CHECK de coherencia es ⚪). Errores nuevos en `inventory/domain/errores.ts`: `CompraSinImporteError`, `CompraConImporteInvalidoError`.

**`catalog`:** `TarifasDeIva` (exportado; dada la sesión, `itemId` y `purchaseArticleId | null`, devuelve `{articulo, grupo}` validando que el artículo sea del ítem —400— y de la company —404—), `ActualizarArticulo` + `PUT /catalogo/articulos/:id` (nombre, marca, proveedor, tarifa, estado; presentación/unidad/factor inmutables, dicho en el DTO), `ActualizarGrupo` + `PUT /catalogo/grupos/:id`, `CrearGrupo` pasa a recibir `{nombre, ivaTarifa}`; `ivaTarifa` obligatoria en `POST /catalogo/articulos` (campo `fraccion`, validado EN EL CAMPO: `0`, `0.xx` o `1`) y opcional/anulable en `POST /catalogo/grupos` (`default(null)` para no romper a los clientes que ya lo llaman); `ArticuloLeido.ivaTarifa` y `GrupoLeido.ivaTarifa` en las listas. Puerto: `buscarArticulo`, `buscarGrupo`, `actualizarArticulo`, `actualizarGrupo` (`ResultadoDeCambio`: `actualizado | no_encontrado | nombre_en_uso`, con `intentarCambio` compartido). `CrearArticulosEnLote` resuelve fila > grupo con una lectura de grupos para todo el lote y rechaza la fila con su número. Controlador con `GestionDeArticulos` y `GestionDeGrupos` (tres deps cada uno). `CatalogModule` exporta además `ListarGrupos`.

**`inventory`:** `RegistrarMovimiento` (COMPRA) resuelve la tarifa con `TarifasDeIva` + `elegirTarifa`, lee `ivaCompraRecuperable` por `LeerAjustes` (exportado ya por `pricing`), netea con `desglosarCompra` y persiste los cuatro importes; sin tarifa → 400. `RegistrarMovimientosEnLote` igual con fila > grupo y tres lecturas para todo el lote (ítems, grupos, ajuste). `CorregirMovimiento` copia `desglose` entero. `MovimientoParaGuardar.desglose` / `MovimientoLeido.desglose` (`DesgloseDeCompra | null`; `desglose_conocido = desglose !== null` lo escribe el repositorio). `MovimientoDto` es una unión: `{desglose: 'SIN_DESGLOSE'}` o `{desglose: 'CONOCIDO', totalBruto, ivaTarifaAplicada, ivaRecuperableAplicado}` — los importes solo existen cuando hay desglose. `CUERPO_DE_MOVIMIENTO.ivaTarifa` opcional (`fraccion.nullable().default(null)`) y un tercer `.refine()` de coherencia (solo en COMPRA). `PRODUCCION`, transferencias y consumo escriben `desglose: null`.

**`pricing`:** `SugerirPrecio` y `SugerirPreciosEnLote` con cuerpo > artículo > grupo y sin el default de company: `ivaDeLaCompany` desapareció (D-16.43); `DependenciasDePrecios` gana `tarifasDeIva` y el lote `listarGrupos`. El CSV `PRECIOS` conserva `ivaCompra` opcional.

**`imports`:** `MOVIMIENTOS` y `ARTICULOS` ganan la columna opcional `ivaTarifa` con alias `iva`, `tarifa iva`, `iva compra`, `tarifa de iva` (`ALIAS_DE_IVA`); `comoMovimiento` y `comoArticulo` la traducen.

**Corrección tras la revisión adversarial de la Fase 1 (hallazgos 1–6):**

- **La fracción se valida en el dominio de los tres lotes, con su fila** (hallazgo 4). `motivoDeTarifaInvalida` en `shared/domain/iva/tarifa.ts` es la regla «0.15, no 15» como motivo; la usan `catalog/domain/lote.ts` (que tenía su copia local), `inventory/domain/lote.ts` y `pricing/domain/lote.ts`, que solo comprobaban `DECIMAL` sin techo. `exigirTarifaValida` la lee también y queda como última línea en los casos de uso. Un CSV con `iva=15` en la fila 2 sale ahora como «fila 2: … 0.15, no 15», con los demás problemas del archivo.
- **Una preparación no lleva IVA de compra — D-16.51** (hallazgo 6). `pricing/domain/preparacion.ts`: `tarifaDePreparacion` (lanza `PreparacionConIvaError`, 400) y `motivoDeIvaEnPreparacion` (motivo con fila). `SugerirPrecio` y `SugerirPreciosEnLote` ignoran artículo y grupo para un `PRODUCIDO`: nace con `0`, y cualquier otra tarifa en el cuerpo o la fila se rechaza. La prueba «una preparación sin grupo y sin tarifa: 400» pasa a «nace con tarifa 0 aunque su grupo diga 0.15». Detalle y alternativa descartada en ADR-024, decisión 5.
- **«Toda COMPRA nueva nace con desglose» tiene guarda** (hallazgo 3). `exigirDesgloseEnCompra` en `inventory/domain/compra.ts` → `CompraSinDesgloseError` (400), llamada en `comoFila`, la única función del repositorio por la que entra toda fila del libro; exime solo la corrección de una compra anterior a P16-A1. La base no puede distinguir vieja de nueva y el trigger con `recorded_at` se descartó (rompería tres siembras SQL y la prueba de la fila vieja); todo está dicho en `guardas-de-dominio.md` y en ADR-024, decisión 4.
- **SPEC §11 vuelve a ser una tabla** (hallazgo 5): el bloque sobre la tarifa se movió debajo de la tabla de parámetros, que había quedado partida.
- **La documentación que faltaba «en el mismo commit»** (hallazgo 1): sección «Lo que cambia P16-A1» en `modelo-datos.md` (ER de las columnas nuevas, los cuatro CHECK, lo que la base no garantiza) más nota en la sección de P3 y fila en «Entidades por paquete»; **ADR-024** (dos niveles, discontinuidad de `total_cost`, semilla 0.15, guarda de aplicación, IVA cero de las preparaciones) con su fila en el índice; entrada de **CHANGELOG** para P16-A1 (en curso; las otras fases se añaden a la misma); la columna `iva` y sus alias por archivo en `runbooks/puesta-en-marcha.md` (Paso 7) y `runbooks/despliegue.md`; `app-cliente.md` (`POST /precios`: preparación = `0`); `guardas-de-dominio.md` (fila del CHECK de coherencia y las guardas sin CHECK detrás); `ESTADO.md` (D-16.51).

**Documentación:** SPEC §11 (la tarifa NO es parámetro de company) y §12 (de dónde salen `iva_compra` e `iva_recuperable`, y los cuatro importes del libro), `docs/apis/app-cliente.md` (artículos, grupos, precios, movimientos, corrección), `docs/pruebas/casos-conocidos.md` (CC-IVA-01..04 calculados a mano), `docs/sistema/guardas-de-dominio.md`. Las siembras SQL de `scripts/lib/volumen.sql` y de las suites de rendimiento llevan `iva_tarifa`.

### Fase 3, etapa 1 — la base del correo transaccional (D-16.12, D-16.19, D-16.26, D-16.31, D-16.34, D-16.46, D-16.47, D-16.48)

Sin el despachador, sin los adaptadores `consola`/`resend`, sin el back office y sin el límite de tasa: eso es de las etapas siguientes. Lo que queda construido es todo lo que la API hace por su cuenta: **encolar** y las dos escrituras sin sesión.

**El rol `costeo_despachador`** en `docker/postgres/initdb/sql/roles.sql` (`NOBYPASSRLS`, `CONNECTION LIMIT 2`, `30s / 10s / 3s`) y en `10-bootstrap.sh` (`COSTEO_DESPACHADOR_PASSWORD`, en LF); `scripts/rol-despachador.mjs` + `npm run rol:despachador`. El ritual común con `rol-backoffice.mjs` —comprobar, crear sin rotar la contraseña, `GRANT CONNECT`— se extrajo a `scripts/lib/rol-de-base.mjs` porque el segundo script era un clon del primero (jscpd); cada script conserva solo su bloque `CREATE ROLE`, que sigue siendo el mismo que el de `roles.sql`. `.env.example`, `docker-compose.yml` (variable del servicio `db`) y el `.env` local al día; el rol se creó en el cluster local con el script antes de migrar.

**Migración `20260910042649_p16a1_correo_y_limite_de_tasa`** (reversible, M0–M11 en verde, `migrate:verify` 4/4 — evidencia abajo). Guarda `RAISE EXCEPTION` si falta el rol (patrón de P11). Tres tablas: `email_outbox` (D-16.46, con `siguiente_intento_en`; CHECKs de forma del destinatario, plantilla, estado, intentos ≥ 0 y `ENVIADO ⇔ sent_at`; índices `(estado, siguiente_intento_en, created_at)` y `(user_id, created_at DESC)`; FK a `company` y a `app_user`), `password_reset_token` (`token_hash UNIQUE`, CHECK `expires_at > created_at`, índice `(user_id, created_at DESC)`) y `rate_limit_hit` (CHECK con la lista de D-16.50; índice `(kind, clave, at DESC)`; su uso llega con la etapa del límite). RLS `ENABLE + FORCE` en las tres; `email_outbox`: `_app FOR ALL` bajo `current_company()` (INC-010), `_despachador` y `_migrator` permisivas; `password_reset_token`: **solo** `_migrator`, y `REVOKE ALL … FROM costeo_app`; `rate_limit_hit`: `_app` permisiva (precedente `login_attempt`), `_despachador`, `_migrator`. `GRANT USAGE ON SCHEMA public TO costeo_despachador` antes de los de tabla; `GRANT SELECT, UPDATE ON email_outbox` y `DELETE ON rate_limit_hit` al despachador; `GRANT SELECT ON email_outbox TO costeo_backoffice`; `REVOKE UPDATE, DELETE, …` explícito a la app en las dos tablas que sí ve. Las dos definer de D-16.47 —`password_reset_request(p_email, p_token_hash, p_expires_at, p_datos jsonb) RETURNS void` (plpgsql; solo usuarios `ACTIVE`; inserta token y correo con el `company_id` del usuario) y `password_reset_consume(p_token_hash, p_ahora) RETURNS TABLE(user_id, company_id)` (sql; `UPDATE … RETURNING` en CTE; solo si `used_at IS NULL AND expires_at > p_ahora`)—, las dos `VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public`, con `COMMENT`, `REVOKE EXECUTE FROM PUBLIC` y `GRANT EXECUTE TO costeo_app`. Semillas de `audit_event_type` con `ON CONFLICT DO NOTHING`, sin borrado en el down. Sección en `guardas-de-dominio.md`.

**`shared/application/correo/`:** `correo-a-encolar.ts` (`PlantillaDeCorreo`, `DatosDeEnlace {enlace, caducaEn}`, `CorreoAEncolar`) y `plantillas.ts` (`renderizar(plantilla, datos, nombreDelProducto) → {subject, body}`, texto plano, enlace en línea propia, caducidad hasta los minutos en UTC, sin contraseñas ni datos de negocio) con `plantillas.spec.ts`. **`shared/infrastructure/persistence/outbox.ts`:** `escribirEnOutbox(tx, {companyId, userId, correo})`, `createMany`, copia `datos` campo a campo, estado `PENDIENTE`; lo llaman los repositorios dentro de su transacción.

**`iam`:** `InvitarUsuario` ya no llama a `send`: `prepararInvitacion` construye token, caducidad y `CorreoAEncolar` con el enlace `APP_URL/activacion?token=…` y se lo pasa a `organizacion.invitar()`, que lo encola en la misma transacción que crea al invitado (D-16.48). `ReenviarInvitacion` (`invitadoPendiente` → token nuevo → `reinvitar` con `status = INVITED` en el WHERE, que invalida el anterior → encola → `user.invitation_resent`) y `POST /usuarios/:id/reenvio-de-invitacion` (`user.invite`, 202; 404 si no está invitado en la company; `ParseUUIDPipe` → 400 con un id mal formado). `SolicitarRestablecimiento` (`POST /auth/password/olvido`, `@Publico()`, 202 siempre y el mismo trabajo: token, `expires_at = ahora + HORAS_DE_RESTABLECIMIENTO`, enlace `APP_URL/restablecer?token=…` en `p_datos`; evento `auth.password.reset_requested` sin company, `ANONYMOUS`) y `RestablecerContrasena` (`POST /auth/password/restablecimiento`, `@Publico()`, 204: consume → lee el correo bajo tenant → política → hash → **revoca todas las sesiones** bajo `TenantTransaction.run(companyId)` → `auth.password.reset_completed`). `TokenDeRestablecimientoInvalidoError` (`ENTRADA_INVALIDA`, 400, un solo mensaje para vacío/inexistente/usado/caducado). Las dos definer van por `runWithoutTenant` con esquema zod (`RESULTADO_DE_SOLICITUD`, `RESTABLECIMIENTOS`) como `invitation_lookup`. Puerto `Enlaces` (`iam/application/ports/enlaces.port.ts`) con `EnlacesDeLaApp` sobre `APP_URL`; `DependenciasDeIam` gana `enlaces` y `horasDeRestablecimiento` (getter sobre `CONFIGURATION`, sin exponer la configuración entera). Agrupadores `InvitacionesDeUsuario` y `Restablecimiento` para no pasar de tres parámetros en los controladores. `CUERPO_DE_OLVIDO` y `CUERPO_DE_RESTABLECIMIENTO` (= `CUERPO_DE_ACTIVACION`, a propósito) en `auth.dto.ts`.

**`environment.ts`:** `MAIL_ADAPTER: z.enum(['fake','consola','resend'])`; `APP_URL` (`z.url()` sin barra final, `http://localhost:3001` en desarrollo, obligatoria en producción por el `superRefine` del objeto, junto a la regla de las credenciales de migración); `HORAS_DE_RESTABLECIMIENTO` (entero 1–24, por defecto 1). `shared.module.ts`: `consola` y `resend` lanzan `AdapterNotImplementedError` (ahora con el valor en el mensaje) hasta la etapa siguiente. `configuracion.md` y `.env.example` al día.

**Pruebas:** `test/integracion/correo-transaccional.spec.ts` (una app, 18 casos, abajo) y `autenticacion-y-autorizacion.spec.ts` con `tokenDelCorreo` leyendo el enlace de `email_outbox.datos` con la dueña (ya no existe `FakeMailer.sent` para la invitación). **Documentación:** `docs/apis/app-cliente.md` (los tres endpoints, y `POST /usuarios` dice ahora «encola»), `docs/sistema/guardas-de-dominio.md`, `docs/sistema/configuracion.md`.

**Corrección tras la revisión adversarial de la etapa «Correo base» (cinco hallazgos, los cinco atendidos):**

- **`email_outbox.datos` solo lo lee el despachador** (hallazgo 1). La migración revoca el `SELECT` de tabla a `costeo_app` y `costeo_backoffice` y concede `SELECT` **por columnas**, todas menos `datos`: mientras el correo está en vuelo, esa columna lleva el enlace con el token en claro, que vale lo mismo que la fila de `password_reset_token` que a la app se le niega entera. El `createMany` no emite `RETURNING`, así que el `INSERT` de la app no necesita la columna (dicho en `outbox.ts`). Pruebas: `SELECT datos` → `42501` con `costeo_app` (`correo-transaccional.spec.ts`) y con `costeo_backoffice` (`backoffice-correo.spec.ts`), con control positivo en las dos.
- **El canal de tiempo de `/olvido` se reconoce y se acota, no se finge** (hallazgo 2, opción b). Con usuario, la definer hace dos `INSERT` más; sin usuario, solo el `SELECT`: un residuo de milisegundos que no se disimula. Escribir también en el ramal vacío (opción a) mezclaría el limitador con la definer y no cerraría el canal del todo. Queda dicho en la migración, en `restablecer-contrasena.ts`, en `app-cliente.md` y en `docs/sistema/seguridad.md` (para ADR-025 cuando se escriba); lo acota el límite de tasa de la etapa siguiente (10/h·IP, 3/h·destinatario), y una prueba mide 15 muestras intercaladas por ramal y exige que la diferencia de **medianas** quede por debajo de 50 ms: la escala de un `INSERT`, nunca la de un Argon2id, que es lo que un cambio descuidado metería en un solo ramal.
- **Las 🔴 que faltaban** (hallazgo 3): (a) la otra dirección de la atomicidad —con la dueña se cierra el outbox a invitaciones (`CHECK … NOT VALID` temporal en `try/finally`), `POST /usuarios` sale 500 `INTERNAL_ERROR`, **no queda fila en `app_user`** y la siguiente invitación entra entera—; (b) el token en claro **no está en `audit_log`** por ninguna de las tres rutas (invitar, reenviar, `/olvido`), leído con el rol del back office y con control positivo, porque el migrator solo tiene política de `INSERT` sobre `audit_log` y un `count(*)` suyo daría 0 aunque el token estuviera dentro (INC-007) — la verificación manual del revisor con la dueña era, por eso mismo, un verde falso; (c) `costeo_app`: `UPDATE`/`DELETE` sobre `email_outbox` e `INSERT` en `password_reset_token` → `42501`.
- **CI conoce las variables de P11 y de esta etapa** (hallazgo 4): `COSTEO_BACKOFFICE_PASSWORD`, `COSTEO_DESPACHADOR_PASSWORD`, `BACKOFFICE_DATABASE_URL` y `DESPACHADOR_DATABASE_URL` en el `env` de `ci.yml`, con credenciales desechables como las demás. Deuda heredada registrada en «Problemas».
- **El aviso de bloqueo del login también se encola** (hallazgo 5). `IniciarSesion` ya no recibe `MailerPort`: al quinto fallo llama a `RepositorioDeAutenticacion.encolarCorreo` (bajo `TenantTransaction.run(companyId)` de la cuenta, por `escribirEnOutbox`) con la plantilla `BLOQUEO` y `datos = {}`. `ContenidoDeCorreo` pasa a ser una unión discriminada —`INVITACION`/`RESTABLECIMIENTO` con `DatosDeEnlace`, `BLOQUEO` sin datos— y `datosParaGuardar` es la única lista de lo que va a la columna (la comparten `outbox.ts` y la llamada a `password_reset_request`); `renderizar(contenido, producto)` recibe la unión; el CHECK de plantillas y `guardas-de-dominio.md` conocen la tercera. Con esto la afirmación de `.env.example` y `configuracion.md` («la API solo encola») pasa a ser cierta: `DependenciasDeIam` ya no inyecta `MAILER_PORT` (sigue cableado en `SharedModule` para el despachador). Pruebas: unitarias del aviso reescritas sobre el repositorio doble (+ `renderizar` sin URLs), `plantillas.spec.ts` con `BLOQUEO`, e integración: cinco fallos → fila `BLOQUEO` bajo la company y el usuario, `enlace` nulo, `datos = {}`, y el sexto intento 429.

### Fase 3, etapa 2 — el despachador y los adaptadores reales (D-16.15, D-16.16, D-16.23, D-16.27, D-16.28, D-16.34, D-16.46)

Lo que faltaba para que un correo encolado **llegue**: el tercer binario, su módulo con su rol, los dos adaptadores que no son el falso, la salud en el back office y la cadena de despliegue.

**`modules/correo/`** (nuevo módulo; `AppModule` no lo importa y tres cosas lo hacen cumplir). `domain/reintentos.ts`: `decidirReintento({intentos, ahora})` → `{estado: 'PENDIENTE', intentos, siguienteIntentoEn}` con espera 1 → 2 → 4 → 8 min (constantes con nombre por escalón, como la escalera de bloqueo de P1) o `{estado: 'FALLIDO', intentos, siguienteIntentoEn: null}` al quinto; `INTENTOS_MAXIMOS = 5`. `domain/saneado.ts`: `datosSaneados(plantilla, destinatario)` es la **única** lista de lo que sobrevive en `datos` al cerrar un correo (D-16.34). `application/ports/cola-de-correo.port.ts`: `tomarPendientes(ahora, lote)` · `renovarReserva(correo, ahora)` · `marcarEnviado(id, ahora, datos)` · `marcarFallo(id, {error, decision, datosSaneados})` · `purgarLimites(antesDe)` — cinco operaciones que caben exactamente en los privilegios del rol (`SELECT`, `UPDATE`, `DELETE ON rate_limit_hit`). `application/despachar-correo.ts`: `DespacharCorreo.ejecutar()` toma, renderiza con `shared/application/correo/plantillas`, renueva la reserva de cada fila justo antes de enviarla (si otra instancia se la quedó, la **cede**: ni envía ni marca), envía por `MailerPort`, marca (un fallo de envío por correo no para la pasada; un fallo al marcar un correo ya aceptado sube **sin pasar por `marcarFallo`**, en un `try` aparte del envío), y al final purga `rate_limit_hit` anterior a 24 h (D-16.28); devuelve `{tomados, enviados, fallidos, cedidos, purgados}`; el error guardado se acota a 500 caracteres; una fila cuyo `datos` no cuadra con su plantilla (`contenido: null`) cuenta como fallo y no bloquea la cola. `infrastructure/entorno-del-despachador.ts`: esquema **propio** (`DESPACHADOR_DATABASE_URL` con el rol verificado **en el campo**, `MAIL_ADAPTER`/`RESEND_*` con la forma compartida, `CORREO_INTERVALO_MS` 5000, `CORREO_LOTE` 20, `CORREO_LATIDO`); **no acepta `DATABASE_URL`** y en producción rechaza `fake`. `infrastructure/despachador-connection.ts`: `PrismaClient` propio sobre la cadena ya verificada, con la exención en `tenant.rules.mjs`. `infrastructure/prisma-cola-de-correo.ts`: `SELECT … FOR UPDATE SKIP LOCKED` etiquetado (sin `Prisma.raw`) **más una reserva** de cinco minutos en la misma transacción (`siguiente_intento_en`), porque el bloqueo de fila muere al confirmar y el envío ocurre fuera; `renovarReserva` vuelve a reservar UNA fila con `WHERE … AND siguiente_intento_en = <la firma con la que se tomó>` (0 filas → otra instancia la tomó), así la reserva cubre un envío y su marca y no el lote entero; filas validadas con zod; `UPDATE` con `datos` saneado al pasar a `ENVIADO` o `FALLIDO`, y `estado = 'PENDIENTE'` repetido en el `WHERE`; `DELETE FROM rate_limit_hit WHERE "at" < …`. `infrastructure/correo.module.ts`: `CorreoModule.forRoot(config)` con `DespachadorConnection`, la cola, `RelojDelSistema` y `mailerProvider`; **no importa `SharedModule`**. `infrastructure/bucle.ts`: `BucleDePasadas` (espera interrumpible por señal; `correr(pasada, intervalo)` solo resuelve con la pasada en curso terminada).

**`src/despachador.ts`** (tercer binario) + `scripts/despachador.mjs` + `npm run correo:despachar` (entrada en `knip.json`): carga `.env` como `backoffice.ts`, `createApplicationContext(CorreoModule.forRoot(config))`, bucle cada `CORREO_INTERVALO_MS` hasta `SIGTERM`/`SIGINT` (la señal solo hace `bucle.detener()`; `correr()` termina la pasada en curso, después `contexto.close()` cierra el pool y `process.exitCode = 0`; **sin `enableShutdownHooks()`**, vigilado por la regla `despachador-sin-ganchos-de-nest`), latido en `CORREO_LATIDO` tras cada pasada completa (solo si completó: la base caída deja de latir), una línea de resumen solo cuando hubo trabajo, `morirCon` al fallar el arranque.

**Adaptadores en `shared/infrastructure/correo/`:** `consola-mailer.ts` (destinatario y asunto por `stdout`; el cuerpo entero **solo fuera de producción**, porque lleva el enlace con el token), `resend-mailer.ts` (`POST https://api.resend.com/emails`, `Authorization: Bearer`, `{from, to, subject, text}`, `AbortSignal.timeout(10 s)`, no-2xx → `ResendError` con el estado y **sin el cuerpo de la respuesta**, timeout → `ResendSinRespuestaError`; el `fetch` entra por constructor con tipo `typeof fetch`), `mailer.provider.ts` (`mailerProvider({mailAdapter, resend, isProduction})` → `Provider`, extraído de `shared.module.ts` y usado por `SharedModule` y `CorreoModule`; `resend` sin `RESEND_API_KEY` o sin `RESEND_REMITENTE` lanza `ConfiguracionDeCorreoIncompletaError` al construir el módulo, no al primer envío) y `entorno-de-correo.ts` (la forma zod de `MAIL_ADAPTER`/`RESEND_*`, una sola vez para los dos esquemas). `environment.ts` gana `Configuration.resend`, y dos piezas reutilizables para que el esquema del despachador no sea un clon: `cadenaDeConexionConRol(rol, porQue)` (la comprobación en el campo, INC-008, ahora fábrica) y `validarEntorno(esquema, source)`. `shared.module.ts` ya no tiene `AdapterNotImplementedError` para el correo.

**Conexión con rol propio.** `BackofficeConnection` y `DespachadorConnection` compartían quince líneas (pool, `run`, `onModuleDestroy`): se extrajo `shared/infrastructure/persistence/conexion-con-rol-propio.ts` (clase abstracta; vive en `persistence/` porque construye el `PrismaClient`). `BackofficeConnection` conserva su verificación de cadena y su comentario; solo cambia que extiende la base.

**Reglas.** `tools/audit/rules/correo.rules.mjs`: `conexion-del-despachador-solo-en-correo`, `cadena-del-despachador-solo-en-correo`, `correo-no-lo-monta-la-app` (exención: `modules/correo/**`, `despachador.ts`, `test/integracion/correo*.spec.ts`) y `despachador-sin-ganchos-de-nest` (solo sobre `src/despachador.ts`), registradas en `forbidden.mjs` (44 reglas). `.dependency-cruiser.cjs`: `correo-inalcanzable-desde-la-app` (desde `app.module`/`main`/`bootstrap`/`cli`/`bench`/`backoffice.ts`), `correo-no-entra-desde-otros-modulos`, y `despachador.ts` en la lista de entradas que no entran en `modules/backoffice`. Guardián ejecutado (sabotaje, captura, reversión): evidencia en «Pruebas».

**Despliegue.** `docker-compose.yml`: `api` gana `image: costeo-api:local`, `APP_URL` (por defecto `http://localhost:3001`) y `HORAS_DE_RESTABLECIMIENTO`; servicio **`correo`** con la misma imagen sin `build`, `command: node apps/api/dist/despachador.js`, `restart: unless-stopped`, `DESPACHADOR_DATABASE_URL`, `MAIL_ADAPTER` (`consola` si falta), `RESEND_*`, `CORREO_*`, `CORREO_LATIDO=/tmp/costeo-correo.latido`, healthcheck sobre la edad del latido (< 60 s), `depends_on: db healthy`, sin puertos. `docker-compose.prod.yml`: `api` exige `APP_URL`; `correo` exige `MAIL_ADAPTER` y lleva 128M. `desplegar.sh` gana el paso **5/8 «dependencias y roles del cluster»**: `npm run rol:backoffice && npm run rol:despachador` (idempotentes) antes de migrar, porque `roles.sql` no vuelve a correr en un cluster que ya existía y la migración de este paquete falla en alto sin el rol; luego levanta `correo` con `api` y espera a que Docker lo dé por sano. `rol-de-base.mjs` dejó de cargar `RAIZ/.env` sin guarda (en el VPS no existe: `ENOENT`); lo carga `entorno.mjs` solo si existe. `preparar.sh`: la plantilla del `.env` gana `COSTEO_BACKOFFICE_PASSWORD`, `COSTEO_DESPACHADOR_PASSWORD`, `BACKOFFICE_DATABASE_URL`, `DESPACHADOR_DATABASE_URL`, `MAIL_ADAPTER=resend`, `RESEND_API_KEY`, `RESEND_REMITENTE`, `APP_URL`, `HORAS_DE_RESTABLECIMIENTO`, `CORREO_MINUTOS_DE_ALERTA`. El Dockerfile no cambia: `despachador.ts` solo importa de `src/` (regla `dockerfile-no-copia-lo-que-el-codigo-importa` en verde) y `tsconfig.build.json` ya lo compila a `dist/despachador.js`. `.env.example` y `.env` local: `MAIL_ADAPTER=consola` en desarrollo y las variables nuevas.

**Back office (D-16.27c).** `GET /correo/salud` → `{pendientesAntiguos, fallidos, ultimoEnvio}`: puerto `saludDelCorreo(pendientesDesdeAntesDe)`, caso de uso `LeerSaludDelCorreo` (con `Reloj` y `minutosDeAlerta`), repositorio con dos `count` y un `_max` por `BackofficeConnection` (ninguno nombra `datos`), `CORREO_MINUTOS_DE_ALERTA` (15; leída a mano en `minutos-de-alerta.ts`, como `BACKOFFICE_PORT`), ruta en `LosRegistros`. **No exige motivo ni deja fila en `backoffice_access_log`** —son contadores sin dato de ningún tenant— y está dicho en el caso de uso, en el controlador y en `docs/apis/back-office.md`. Tarjeta «Cola de correo» al principio de la vista *Cartera* (`src/navegador/backoffice.ts`), en aviso si hay retrasados o fallidos.

**Documentación:** `docs/apis/back-office.md` (la ruta de salud), `docs/sistema/configuracion.md` (adaptadores, `RESEND_*`, `CORREO_*`, el tercer binario), `.env.example`.

### Fase 3, etapa 3 — el límite de tasa y la IP del cliente tras el proxy (D-16.17, D-16.24, D-16.28, D-16.36, D-16.49, D-16.50)

Lo último que faltaba de la Fase 3: que los cuatro endpoints que escriben sin sesión o mandan correo tengan límite, y que «por IP» signifique la IP del cliente y no la del proxy. La tabla `rate_limit_hit`, su CHECK de `kind`, la purga del despachador y las cuatro rutas ya existían de las etapas anteriores; aquí se cablea todo y se cierra INC-022.

**Dominio.** `shared/domain/acceso/politica-de-intentos.ts`: `evaluarIntentos({fallos, ahora, politica})` con `PoliticaDeIntentos {umbral, ventanaDeDisparoMs, ventanaDeEscaladaMs, escalaDeBloqueoMinutos}` (tupla no vacía), `bloqueoEfectivo`, `DecisionDeAcceso` y `MINUTO_MS`; es la regla del login de P1 con los números fuera, y la lógica no cambió una línea (el bloqueo cuenta desde el último fallo, dos ventanas, la última escala se repite). `iam/domain/politica-de-intentos.ts` conserva `POLITICA_DE_LOGIN` (cuenta 5 / IP 25, ventanas 15 y 60, escala 1 → 5 → 15 → 60) como `Record<EjeDeConteo, PoliticaDeIntentos>`, su `evaluarIntentos({fallos, ahora, eje})` que delega, `VENTANA_A_CONSULTAR_MS`, `cruzaUmbralDeBloqueo`, y reexporta `bloqueoEfectivo` y `DecisionDeAcceso`: **sus 23 pruebas siguen en verde sin tocar una aserción**, que es lo que demuestra que generalizar no movió nada. `shared/domain/limite-de-tasa/politicas.ts`: `KindDeLimite` (los cuatro de la lista del CHECK), `POLITICAS_DE_LIMITE` por eje (`password.olvido` IP 10/h · destinatario 3/h; `password.restablecimiento` IP 10/h; `usuario.invitar` y `usuario.reenvio` IP 30/h · destinatario 3/h; ventana de una hora y un solo escalón de 60 minutos), `VENTANA_DE_LIMITE_MS` y `LimiteDeSolicitudesError` (código nuevo `LIMITE_DE_SOLICITUDES` → 429 en `error.filter.ts`, con `reintentarEnSegundos` nunca menor que 1 y el mensaje «Vuelve a intentarlo en N minuto(s)»).

**Aplicación.** `shared/application/ports/registro-de-limites.port.ts` (`hitsDesde(kind, clave, desde)`, `registrar(kind, clave, at)`; sin borrado: la purga es del despachador). `shared/application/limite-de-tasa/limitador.ts`: `LimitadorDeTasa.exigir({kind, ip, destinatario?, ahora})` evalúa cada eje presente con la política del `kind`, **registra el golpe siempre** (permitido o bloqueado, así insistir alarga la espera y «diez por hora» son diez de verdad), y si algún eje bloquea deja `system.ratelimit.exceeded` en `audit_log` (actor `SYSTEM`, sin company, con la IP en su columna y en `detail` solo `kind`, `ejes` y `bloqueadoHasta`: ni el correo ni su hash) y lanza el 429. Claves `ip:<ip>` y `correo:<sha256 hex del correo recortado y en minúsculas>` (`claveDeIp`, `claveDeCorreo`). Sin IP no hay eje de IP; un `kind` sin destinatario ignora el que venga. Los cuatro casos de uso lo llaman **antes de hacer nada**: `SolicitarRestablecimiento.ejecutar({email, ip})` (y ahora audita `auth.password.reset_requested` con la IP), `RestablecerContrasena.ejecutar({token, contrasena, ip})` (antes de gastar el token), `InvitarUsuario.ejecutar(sesion, {email, ip})`, `ReenviarInvitacion.ejecutar(sesion, {objetivo, ip})` (busca al invitado, exige con `destinatario: invitado?.email ?? null` —la IP cuenta aunque el usuario no exista— y solo después 404). `DependenciasDeIam` gana `limitador`.

**Infraestructura.** `shared/infrastructure/persistence/prisma-registro-de-limites.ts` por `TenantTransaction.runWithoutTenant` con motivo, como `login_attempt` (`findMany` con `select: {at}` sobre el índice `(kind, clave, at DESC)`; `createMany`). `SharedModule` provee `REGISTRO_DE_LIMITES` y construye `LimitadorDeTasa` con `useFactory` (dos puertos), y lo exporta. `error.filter.ts`: `ESTADO_POR_CODIGO` con `LIMITE_DE_SOLICITUDES`, `errorResponseFor` devuelve además `cabeceras` y emite `Retry-After` para **cualquier** `ErrorDeDominio` que traiga `reintentarEnSegundos` entero positivo (mira la forma, no la clase); el filtro las escribe. `shared/infrastructure/http/ip-del-cliente.ts`: `ipDelCliente(peticion, proxiesDeConfianza)` —el último salto de `X-Forwarded-For` solo si el socket normalizado está en la lista (IPv4 exacta, CIDR v4, IPv6 exacta); si la cabecera no parsea como IP (puerto, `for=`, zona, vacío tras la coma) cae al socket; `::ffff:a.b.c.d` → `a.b.c.d`; IPv6 a forma canónica—, `normalizarIp`, `esProxyDeConfianzaValido` y el tipo estructural `PeticionConOrigen` (para fabricar peticiones en las pruebas sin `as`). Las **dos copias de `ipDe`** (`auth.controller.ts`, `backoffice.controller.ts`) desaparecieron; el comentario de cabecera de `auth.controller.ts` dice ahora lo contrario de lo que decía, con la fecha en que dejó de ser cierto. `shared/infrastructure/http/limitador-global.guard.ts`: `LimitadorGlobalGuard extends ThrottlerGuard` con `getTracker` sobre `ipDelCliente` (la configuración por inyección de propiedad; sin constructor propio, Nest resuelve los tres del guard base por sus metadatos, que es el patrón que la librería documenta) y `app.module.ts` lo registra como `APP_GUARD` en vez de `ThrottlerGuard`. `environment.ts`: `PROXY_DE_CONFIANZA` (lista separada por comas, `partirLista` compartida con `CORS_ORIGENES`, **validada en el campo** con `esProxyDeConfianzaValido`, vacía por defecto) → `Configuration.proxiesDeConfianza`. Controladores: `ContrasenaController` y `UsuariosController` reciben `@Req()` y resuelven la IP con `this.config.proxiesDeConfianza`; para que `UsuariosController` no pase de tres dependencias, `AceptarInvitacion` entra en `InvitacionesDeUsuario` (invitar, reenviar, aceptar). Back office: `modules/backoffice/infrastructure/proxies-de-confianza.ts` lee `PROXY_DE_CONFIANZA` a mano (como `BACKOFFICE_PORT`, con la misma validación y el índice de la entrada mala en el error), `BackofficeModule` la provee bajo `PROXIES_DE_CONFIANZA` y `SesionDelOperador` la lleva; `peticionDe(peticion, proxies)` la usa para `backoffice_access_log.ip` y el login del operador.

**Despliegue.** `docker-compose.prod.yml`: la red por defecto gana **subred fija `172.28.0.0/24`** (con el porqué: sin ella un CIDR en el `.env` puede dejar de casar tras un `down`/`up` y el fallo sería silencioso) y `api` exige `PROXY_DE_CONFIANZA`; `docker-compose.yml` la pasa con default vacío; `scripts/vps/preparar.sh` deja `PROXY_DE_CONFIANZA=172.28.0.0/24` en la plantilla; `.env.example` la documenta vacía. `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` valida los dos archivos con la subred y la variable.

**Documentación.** `docs/apis/app-cliente.md` (el código `LIMITE_DE_SOLICITUDES` en la tabla —«los tres 429»— y el 429 en los cuatro endpoints), `docs/sistema/configuracion.md` (`PROXY_DE_CONFIANZA` y las cuatro filas de límites en «Parámetros de sesión y de bloqueo»), `docs/sistema/seguridad.md` (sección «La IP del cliente tras el proxy, y el límite de tasa»), `docs/runbooks/despliegue.md` (la variable en «Los secretos», el `down` + `up` al cambiar la subred, y la fila en «Solución de problemas conocidos»), **INC-022** con su fila en el índice y en «Áreas frecuentes», y el comentario de `limitador.spec.ts` que decía que solo había dos mecanismos con 429.

**Corrección tras la revisión adversarial de la etapa «Límite e IP» (cuatro hallazgos: una crítica, tres medias; los cuatro atendidos):**

- **Contar y anotar son un solo acto por clave** (hallazgo 1, crítica). El puerto `RegistroDeLimites` pasa de dos operaciones (`hitsDesde` + `registrar`, cada una en su `runWithoutTenant`) a **una**: `golpear({kind, clave, at, desde, maximo}) → readonly Date[]`, que anota el golpe y devuelve los anteriores. `PrismaRegistroDeLimites.golpear` abre una transacción, toma `SELECT pg_advisory_xact_lock(hashtext(kind), hashtext(clave))::text` (el `::text` por la misma razón que `password_reset_request`: `void` no se deserializa), lee con `orderBy at DESC, take: maximo` y hace el `createMany`. El bloqueo consultivo serializa solo a las peticiones de la misma clave y muere al confirmar; con `READ COMMITTED` la lectura que sigue ve lo que la anterior confirmó. Cuatro transacciones por petición pasan a dos (una por eje). Se reprodujo antes de corregir: `Promise.all` de 30 `/olvido` desde una IP → **30 de 30 aceptadas**; después, exactamente 10. La 🔴 que faltaba está en `limite-de-tasa.spec.ts` («en PARALELO»): doce al mismo buzón desde doce IP → tres 202 y nueve 429 con doce golpes de la clave; treinta desde la misma IP → diez 202, veinte 429, treinta golpes. `estadosDe` en serie sigue existiendo para los casos que miden el orden, no la carrera.
- **La lectura va acotada** (hallazgo 2). `golpesQueDeciden(politica) = umbral × escalones + 1` en `shared/domain/acceso/politica-de-intentos.ts`: es todo lo que `evaluarIntentos` necesita para decidir lo mismo que con la hora entera (ronda y escalón salen del recuento, «hasta cuándo» del más reciente), y el `+ 1` es lo que permite a `abreBloqueo` distinguir un recuento exacto de uno truncado. El limitador lo pasa como `maximo`; unitaria de equivalencia con 40 golpes frente a los 5 más recientes, y otra en el limitador con 200 golpes bloqueados que sigue contando desde el último. `EXPLAIN ANALYZE` con 18.000 golpes de una clave en «Consultas del camino crítico».
- **La auditoría es de transición** (hallazgo 3). `abreBloqueo(fallosPrevios, politica) = fallosPrevios > 0 && fallosPrevios % umbral === 0`, el espejo de `cruzaUmbralDeBloqueo` del login visto desde el golpe rechazado: `system.ratelimit.exceeded` queda una vez por ronda (el undécimo, el vigésimo primero…), no en cada 429. `abreAlgunBloqueo` en el limitador mira solo los ejes que bloquean. Unitarias: cinco 429 seguidos → un evento y cinco golpes; el evento nombra solo el eje que bloquea. Integración (`backoffice-correo.spec.ts`, leyendo con el rol del back office): tres 429 más tras el cuarto → sigue habiendo **una** fila `system.ratelimit.exceeded` de ese `kind`.
- **`PROXY_DE_CONFIANZA` es la IP de Caddy, no la subred** (hallazgo 4). Verificado: `docker-compose.yml` publica `api` en `127.0.0.1:3000`, así que la pasarela `172.28.0.1` es un origen real dentro del `/24`, y `web`, `correo`, `pgbouncer` y `db` también. `docker-compose.prod.yml`: `caddy` gana `networks.default.ipv4_address: 172.28.0.10` (la subred sigue fija para que esa dirección no cambie tras `down`/`up`); `preparar.sh` deja `PROXY_DE_CONFIANZA=172.28.0.10`; comentarios de `environment.ts`, `ip-del-cliente.ts`, `.env.example` y compose, y `despliegue.md` (con la comprobación `docker inspect costeo-caddy`), `configuracion.md`, `seguridad.md`, INC-022 (el porqué), CHANGELOG y `ESTADO.md` (D-16.49) al día. `docker compose … config` renderiza `ipv4_address: 172.28.0.10` bajo `caddy`.

### Cierre — la documentación del paquete, sobre el código ya construido

Escrita al final, leyendo el árbol y no el plan (AUDITORIA.md H13): **ADR-025** (outbox
transaccional; rol y proceso aparte, con la alternativa descartada del rol de la app con bypass; las
dos definer que escriben, por qué son las únicas y qué las acota; el token en vuelo y el cifrado del
campo descartado con su señal —más de un operador con acceso a la base—; Resend como proveedor único;
`siguiente_intento_en`, la reserva junto a `SKIP LOCKED` y el cierre ordenado;
`HORAS_DE_RESTABLECIMIENTO = 1`) y **ADR-026** (`ipDelCliente` y la confianza en el proxy; la subred
fija y la IP de Caddy; la generalización de `evaluarIntentos`; los `kind` y umbrales;
`rate_limit_hit` como exención de ámbito con M6 vacía; contar-y-anotar bajo `pg_advisory_xact_lock`
con sus alternativas; la purga por el despachador; el 429 propio frente a los otros dos), con sus
filas en `docs/decisiones/README.md`. `modelo-datos.md`: bloque «Lo que añade P16-A1 — la cola de
correo…» (erDiagram de las tres tablas, privilegios rol por rol, las seis restricciones, los cinco
índices con su consulta y lo que el `EXPLAIN` enseñó), la nota «desde P16-A1 son cinco» en las
funciones sin tenant, y la fila de «Entidades por paquete» corregida (decía «ninguna tabla nueva»).
`configuracion.md`: seis filas más en «Parámetros de sesión y de bloqueo» (golpes que deciden,
reintentos, reserva, timeout de Resend, purga) y la sección de `costeo_backoffice`, que decía «no
existe todavía» desde P11. `seguridad.md`: fila de `costeo_despachador` en los roles y la tabla de
**las cinco definer** con las dos que escriben. `SEGURIDAD.md` §2.1: cómo quedó implementado (y en
qué se aparta del estándar: PostgreSQL y no Redis, sin CAPTCHA), la IP tras el proxy, el **registro
de exenciones de ámbito** (`login_attempt`, `rate_limit_hit`) y el token en vuelo. `FUNCIONAMIENTO.md`:
el guard global renombrado en el grafo de la petición, la composición de `shared` al día, y la
sección nueva con dos `sequenceDiagram` (invitación → outbox → despachador → Resend; el
restablecimiento por las dos definer). Runbooks: `despliegue.md` (los cuatro roles al arrancar,
`correo:despachar` y `rol:despachador` en el día a día, los secretos nuevos, la sección «El servicio
`correo`» —cómo mirarlo, cómo leer la cola sin `datos`, qué significa cada estado— y tres filas de
problemas conocidos), `puesta-en-marcha.md` (la cuenta de Resend como séptimo requisito, Paso 3b con
DKIM/SPF/DMARC, ocho pasos, la comprobación del servicio y de la IP de Caddy, y el **Paso 6b — el
envío real a mano con la evidencia que hay que guardar**, que depende del usuario) y
`rotacion-secretos.md` (`COSTEO_DESPACHADOR_PASSWORD`, `RESEND_API_KEY`, y los dos roles que faltaban
en la tabla). `CHANGELOG.md` con la entrada de cierre, `AUDITORIA-RESULTADO.md`, y `ESTADO.md`
(tablero, D-16.52…D-16.64, checks). Los cinco endpoints nuevos ya estaban en `app-cliente.md` y
`/correo/salud` en `back-office.md`; se verificó que ninguno describe algo que el código no hace.

## Decisiones técnicas tomadas

*(Las D-16.40…D-16.50 de arriba, más las que la construcción destape. Las destapadas por las etapas
llevan número desde el cierre —**D-16.52…D-16.64** en `ESTADO.md`— para que sobrevivan a una
compactación; aquí quedan con su razón entera.)*

**Fase 1, destapadas al construir:**

- **`shared/domain/iva/tarifa.ts` además de los tres archivos del plan.** Los dos CHECK de fracción son 🔴 (los alcanza cualquier `POST`/`PUT` de artículo o grupo y el CSV), y M11 exige una guarda de dominio con mensaje. `exigirTarifaValida` es esa guarda y la comparten `catalog`, `inventory` y `pricing`; el esquema Zod la repite **en el campo** con el patrón `fraccion` (INC-008).
- **Lo editable de un artículo por `PUT`: nombre, marca, proveedor, tarifa y estado.** La presentación, su unidad y el factor de conversión quedan inmutables (misma razón que el tipo y la unidad de uso de un ítem): reescribirían el costo de meses cerrados. Si hace falta, es otro artículo. Opción más conservadora; queda dicho en el DTO y en la API.
- **`ivaTarifa` de `POST /catalogo/grupos` es `.nullable().default(null)`, y la de `POST /inventario/movimientos` también.** Un `PUT` exige la clave (estado completo); un `POST` que ya tenía clientes no rompe por una columna que puede ser nula.
- **`TarifasDeIva` vive en `catalog` y valida la pertenencia del artículo al ítem.** Antes, un `purchaseArticleId` de otro ítem llegaba a la clave foránea compuesta del libro y salía como 500 (INC-012); ahora es 400 con motivo, y uno de otra company es 404 (§4.4: «no existe», no «pertenece a otro»).
- **El desglose viaja como UN objeto anulable (`DesgloseDeCompra | null`) por el puerto**, no como cuatro campos sueltos: `desglose_conocido` lo deriva el repositorio de `desglose !== null`, así no existe una forma de escribirlo a medias. El DTO de salida es una unión discriminada por `desglose` para que «sin desglose» no se confunda con «cero».
- **`CrearArticulosEnLote` resuelve la tarifa fila > grupo del ítem** (el CSV de `ARTICULOS` no tiene artículo, por definición) y rechaza la fila con su número, como una unidad desconocida.
- **D-16.51 — una preparación no lleva IVA de compra.** Fuera del plan; destapada por el revisor adversarial. Opciones: (a) dejar la precedencia también para `PRODUCIDO` (subcostea los platos con subpreparaciones cuando el grupo tiene tarifa, y exige una tarifa a algo que no la tiene), (b) respetar lo que venga en el cuerpo y solo cambiar el default a 0 (acepta un plato mal costeado si alguien teclea 0.15), (c) **nace con 0 y otra tarifa es 400**. Se eligió (c) por ser la única coherente con R10 y con `produccion.ts` («PRODUCCION no se netea»), y la más conservadora para el número. Los precios existentes de preparaciones con tarifa ≠ 0 no se reescriben (R5); se corrigen sugiriendo uno nuevo. **Queda pendiente de ratificación del usuario antes del commit** (ADR-024, decisión 5; `ESTADO.md`).
- **La guarda «COMPRA nueva ⇒ desglose» va en el repositorio, no en un trigger.** Un trigger `BEFORE INSERT` con `recorded_at >= instante de la migración` habría roto `scripts/lib/volumen.sql`, las tres siembras de rendimiento y la prueba de la fila «anterior a P16-A1», que escriben `COMPRA` sin desglose como dueña. Se puso `exigirDesgloseEnCompra` en `comoFila` (toda ruta de aplicación pasa por ahí) y se dejó escrito que el SQL a mano queda fuera. Si aparece una segunda ruta SQL que escriba compras, el trigger vuelve a la mesa.
- **La re-importación de los datos de ejemplo (D-16.18) no se puede ejecutar desde el repositorio**, y se registra en vez de simularse: no hay ningún CSV versionado (los archivos de P10 eran del piloto y CLAUDE.md §7 prohíbe datos reales en desarrollo), y una segunda pasada de `MOVIMIENTOS` sobre la base actual **duplicaría** las compras, porque el libro es append-only. Lo que sí aplica quedó en `runbooks/puesta-en-marcha.md`, Paso 7: rehacer la base de ejemplo desde cero (`db:reset`, `seed:tenant`, pasadas con la columna `iva`) y revisar la semilla 0.15 de los artículos existentes por `PUT`. La evidencia sobre datos que sí está en el repositorio es el `down` + `deploy` sobre la base sembrada (abajo).
- **Las suites existentes siembran `ivaTarifa: '0'`** (o `'0'` en el cuerpo de la compra) donde sus aserciones se calcularon con bruto = neto, y `'0.15'` donde el IVA ya era parte del caso (`precios.spec`, E20). La tarifa real se prueba en `iva-de-compra.spec.ts`.

**Fase 3, etapa 1, destapadas al construir:**

- **`RestablecerContrasena` lee el correo del usuario bajo tenant después de consumir el token.** `problemaDeContrasena` necesita el correo para rechazar una contraseña que lo contenga, y `password_reset_consume` devuelve `(user_id, company_id)` tal como fija D-16.47. Se eligió una lectura por `TenantTransaction.run(companyId)` (`correoDelUsuario`) antes que ampliar el retorno de la definer: la decisión es vinculante y el coste es una consulta por clave primaria en un camino que se recorre una vez por restablecimiento. Si el tenant no ve al usuario que la definer devolvió, se cierra con el mismo error del token.
- **El token se gasta ANTES de validar la contraseña**, en el orden que lista el plan (consume → política → guarda). Una contraseña débil obliga a pedir otro enlace; la alternativa —validar primero— exigiría una lectura sin consumir (una tercera definer) o dejar vivo un token contra el que ya se falló. Queda dicho en `app-cliente.md` y lo fija una prueba.
- **`password_reset_consume` exige además `status = 'ACTIVE'` al devolver la fila.** D-16.47 lo pide para `request`; en `consume` se añadió por simetría: un usuario suspendido entre pedir y consumir no restablece nada (el token queda gastado igual).
- **`GRANT SELECT ("at")` —solo la columna— sobre `rate_limit_hit` al despachador.** D-16.23 dice «`DELETE ON rate_limit_hit`, nada más», pero un `DELETE … WHERE "at" < …` necesita leer la columna del `WHERE` y sin ese privilegio la purga fallaría en la etapa siguiente. La opción más estrecha que la hace posible es el privilegio de columna: el despachador decide qué es viejo sin poder leer una sola clave (`ip:` o `correo:`), y una prueba lo comprueba.
- **`email_outbox.user_id` lleva clave foránea a `app_user`** (el plan solo la nombraba para `company_id`). Un correo que apunta a un usuario que no existe es exactamente lo que la clave impide, y los usuarios no se borran físicamente.
- **`Prisma.$queryRaw` no sabe leer `void`**: `SELECT password_reset_request(…)` moría con «Failed to deserialize column of type 'void'». Se pide `::text AS hecho` (una cadena vacía) y se valida como tupla de una fila; la firma de la definer no cambia.
- **`CUERPO_DE_RESTABLECIMIENTO = CUERPO_DE_ACTIVACION`**, con el porqué en el DTO: son la misma entrada (credencial de un uso + contraseña nueva). Escribirlo dos veces era un clon para jscpd y una regla mantenida en dos sitios.
- **`APP_URL` obligatoria en producción va en el `superRefine` del objeto**, no en el campo: es una regla de producción de la misma familia que la de `MIGRATION_DATABASE_URL`, no un control de seguridad, así que INC-008 no aplica; el campo sí valida forma y barra final siempre.
- **`ParseUUIDPipe` en `:id` del reenvío** (patrón del back office) en vez de `userId()` a secas: un id mal formado sale como 400 `BAD_REQUEST` y no como 500 (INC-012).
- **Ana es `ADMIN` en la siembra de la suite de correo** para tener una ruta con sesión (`GET /ubicaciones`) con la que ver caer su sesión al restablecer.

**Fase 3, etapa 1, tras la revisión adversarial:**

- **Privilegio por columnas en `email_outbox` en vez de otra tabla o cifrado.** Las alternativas eran separar `datos` en una tabla propia solo del despachador (una tabla más, una FK más, el mismo efecto) o cifrar la columna con clave del despachador (la alternativa que D-16.34 ya descartó). `GRANT SELECT (columnas)` es lo más estrecho que da PostgreSQL con lo que ya existe, y el `down` no necesita nada: soltar la tabla se lleva los privilegios de columna.
- **El canal de tiempo de `/olvido`: opción (b), reconocerlo y acotarlo.** La (a) —que la definer escriba siempre, por ejemplo el golpe de `rate_limit_hit`— acopla el limitador (etapa siguiente, con su propio puerto bajo `costeo_app`) a una función `SECURITY DEFINER`, y aun así dejaría un residuo (el `INSERT` en `password_reset_token` con su índice único solo ocurre con usuario). Se prefirió la verdad medida a la simetría fingida; el margen de 50 ms de la prueba se eligió para cazar la escala de un hash, no la del proxy de Docker (INC-016 mide picos de ~300 ms solo con resultados grandes; aquí la respuesta es `{}` y se comparan medianas).
- **El aviso de bloqueo se encola en vez de documentar que la API conserva un envío directo.** La segunda opción habría dejado un correo de seguridad que en producción (`MAIL_ADAPTER=fake` en la API) existía solo en memoria del proceso: documentar un defecto no es corregirlo. `datos = {}` (y no `null`) porque la columna es `NOT NULL` y el saneado de D-16.34 escribirá igualmente `{plantilla, destinatario}`.
- **`encolarCorreo` vive en `RepositorioDeAutenticacion` y no en un puerto nuevo.** Es un paso del flujo de login (el único que lo usa) y escribe bajo el tenant que la credencial ya trae; un puerto genérico de «encolar cualquier cosa» sería la abstracción especulativa que OPTIMIZACION.md §1 prohíbe.
- **Las aserciones que necesitan el rol del back office van en `backoffice-correo.spec.ts`**, no en la suite de correo: `audit:forbidden` (`cadena-privilegiada-solo-en-backoffice`) solo deja nombrar `BACKOFFICE_DATABASE_URL` en `test/integracion/backoffice*.spec.ts`, la exención es deliberadamente estrecha y el check tiene razón; se movieron las pruebas, no la regla. Lo mismo con `sin-set-local-a-mano`: el control positivo de la lectura de `costeo_app` no fija tenant con `set_config`, comprueba que las columnas concedidas se pueden nombrar sin `42501` (el privilegio se evalúa antes que la política).

**Fase 3, etapa 2, destapadas al construir:**

- **`FOR UPDATE SKIP LOCKED` lleva una reserva al lado.** El plan nombra el bloqueo de fila, pero un bloqueo de fila dura lo que la transacción, y el envío (una llamada HTTP de hasta diez segundos) no se hace con la transacción abierta. Sin más, dos pasadas concurrentes —el contenedor viejo que aún no murió mientras arranca el nuevo— tomarían el mismo correo y lo mandarían dos veces. En la misma transacción que lee, las filas tomadas quedan con `siguiente_intento_en = ahora + 5 min`; si el proceso muere a medias, la reserva caduca y el correo vuelve solo. Es la opción conservadora: sin ella `SKIP LOCKED` sería una palabra que suena a garantía y no lo es.
- **`marcarFallo(id, {error, decision, datosSaneados})` y no `marcarFallo(id, error, decision)`.** Al pasar a `FALLIDO` hay que escribir el saneado, y el dominio de la decisión no debe cargar con datos; un cuarto parámetro rompería el techo de tres. El objeto lleva las tres cosas y el repositorio aplica el saneado solo cuando la decisión es `FALLIDO`.
- **`mailerProvider` recibe además `isProduction`.** `consola` escribe el cuerpo entero —con el enlace y el token— solo fuera de producción, y esa decisión tiene que tomarse donde se construye el adaptador.
- **`RESEND_API_KEY`/`RESEND_REMITENTE` entran también en el esquema de la API.** El `.env` es uno; si `MAIL_ADAPTER=resend` en la API exigiera la clave y no la tuviera, la alternativa era que la API con `resend` nunca arrancara. Se prefirió que los dos procesos evalúen la misma elección con las mismas variables; la API, que no envía, no usa la clave.
- **En producción el despachador rechaza `fake`.** Fuera del plan. `fake` marca `ENVIADO` lo que nadie recibió, sin un error en ningún log: en la máquina de un desarrollador es lo que se quiere para probar; en producción es la forma más silenciosa de perder invitaciones. Es la única regla del `superRefine` del objeto de ese esquema (regla de producción, como `APP_URL` en la API; INC-008 no aplica).
- **`MAIL_ADAPTER=consola` en desarrollo (`.env.example`).** Ninguna prueba dependía de que la API montara `FakeMailer` (las de integración montan el despachador con `fake` explícito), y con `consola` el despachador en el host o en compose enseña cada correo con su enlace, que es como se prueba una invitación sin buzón. Con `fake` en el `.env`, `docker compose up` habría muerto en `correo` con un mensaje claro pero sin razón útil.
- **La cadena del despachador se verifica en el esquema, no en la conexión.** `BackofficeConnection` lee `process.env` y verifica el rol porque el back office no tiene esquema; el despachador sí lo tiene (`DESPACHADOR_DATABASE_URL` con la fábrica `cadenaDeConexionConRol`, INC-008), y `DespachadorConnection` recibe la cadena ya verificada por inyección, como `PrismaConnection` con `DATABASE_URL`. Un solo sitio que decide.
- **El latido solo se escribe tras una pasada completa.** Un despachador vivo que no consigue completar una pasada (base caída, rol sin privilegios) no debe parecer sano: el healthcheck mira la edad del archivo, no si el proceso existe. Una pasada fallida se escribe en `stderr` y se espera al turno siguiente; el proceso no muere por un fallo transitorio de la base.
- **`api` gana `image: costeo-api:local` y `correo` la reutiliza sin `build`.** Dos builds del mismo Dockerfile podrían divergir por una capa cacheada; una imagen con dos comandos, no. La etiqueta `local` no es móvil, así que `sin-imagen-sin-fijar` no la marca (y una imagen local no tiene digest que fijar).
- **`APP_URL` en el compose base con valor por defecto y exigida en la superposición.** El servicio `api` corre con `NODE_ENV=production` también en `docker compose up` local, y el esquema exige `APP_URL` en producción: sin el valor por defecto, el modo local de compose habría dejado de arrancar desde la etapa anterior.
- **`GET /correo/salud` sin motivo y sin `backoffice_access_log`**, con el porqué escrito en el caso de uso y en el controlador (contadores agregados, ningún dato de ningún tenant; un motivo obligatorio se rellenaría con «salud» y enterraría los accesos que importan). Sigue exigiendo sesión.
- **El `healthcheck` de `correo` es un `node -e` sobre el `mtime` del latido**, como el de `api` sobre `/health`, y no un `stat`/`date` de shell: el `$` de la sustitución de comandos en compose exige escapado y una prueba de que funciona; el mismo intérprete que ya usa la imagen no.

## Consultas del camino crítico

**Fase 1.** No hay consulta nueva sobre el camino crítico de costeo; las dos lecturas nuevas son puntuales por clave primaria + `company_id`, dentro de la escritura de una compra:

- `buscarArticulo` → `Index Scan using purchase_article_id_item_id_key on purchase_article … rows=1` (sobre 108.402 filas de la base de desarrollo; el tiempo de la muestra lo consumen los dos `ORDER BY created_at` con que se eligió el id, no el lookup).
- `buscarGrupo` → `Seq Scan on item_group … rows=20 … Execution Time: 0.066 ms` (veinte filas: el planificador hace bien en no usar el índice).
- El lote de movimientos y el de precios leen grupos **una vez** por lote (`ListarGrupos`), no una por fila; `RegistrarMovimiento` hace las dos lecturas (`TarifasDeIva`, `LeerAjustes`) en paralelo.
- `GET /inventario/movimientos` añade tres columnas al `select`; mismo índice y mismo plan que en P6.

**Fase 3, etapa 3 — corrección (la lectura acotada de `rate_limit_hit`).** Medido con la dueña dentro de una transacción con `ROLLBACK`: 18.000 golpes de una clave (lo que deja una IP bloqueada insistiendo al tope del limitador global durante una hora) más 20.000 repartidos en 200 claves, `ANALYZE`, y las dos formas de la consulta:

```
-- lo que hace golpear(): ORDER BY at DESC LIMIT 11 (golpesQueDeciden para 10/h)
Limit  (cost=0.42..3.43 rows=11 width=8) (actual time=0.437..0.442 rows=11.00 loops=1)
  Buffers: shared hit=4
  ->  Index Only Scan using rate_limit_hit_kind_clave_at_idx on rate_limit_hit
        (cost=0.42..927.95 rows=3393 width=8) (actual time=0.435..0.439 rows=11.00 loops=1)
        Index Cond: ((kind = 'password.olvido') AND (clave = 'ip:203.0.113.99') AND (at >= (now() - '01:00:00')))
        Heap Fetches: 11
Execution Time: 0.852 ms

-- lo que hacia hitsDesde(): sin LIMIT
Bitmap Heap Scan on rate_limit_hit  (cost=167.68..647.02 rows=3393 width=8) (actual time=0.458..1.063 rows=3618.00 loops=1)
  Heap Blocks: exact=56
  Buffers: shared hit=85
  ->  Bitmap Index Scan on rate_limit_hit_kind_clave_at_idx (actual time=0.431..0.432 rows=3618.00 loops=1)
Execution Time: 1.345 ms
```

Once entradas de índice y once `Date` en Node por petición, en vez de todas las de la hora (3.618 en la muestra porque la siembra era de un golpe por segundo; 18.000 con el ritmo del limitador global). El `pg_advisory_xact_lock` va antes en la misma transacción y no aparece en el plan: es una llamada de función sin acceso a tablas.

**Cierre — las tres consultas del despachador y del limitador, medidas con la dueña al cerrar el paquete** (`MIGRATION_DATABASE_URL`, `pg` de `node_modules`, una transacción con `ROLLBACK`; el residuo de la base —474 correos, 0 golpes— quedó igual antes y después). Siembra: 60.000 correos con uno de cada veinte `PENDIENTE` (3.000) escalonados un segundo; 18.000 golpes de una clave en la última hora más 20.000 repartidos en 200 claves; `ANALYZE` de las dos tablas.

```
-- tomarPendientes(): SELECT … FOR UPDATE SKIP LOCKED, lote 20 (60.000 filas, 3.000 PENDIENTE)
Limit  (cost=1686.77..1687.02 rows=20 width=156) (actual time=9.847..9.877 rows=20.00 loops=1)
  Buffers: shared hit=1460
  ->  LockRows  (cost=1686.77..1724.55 rows=3023 width=156) (actual time=9.845..9.871 rows=20.00 loops=1)
        ->  Sort  (cost=1686.77..1694.32 rows=3023 width=156) (actual time=9.832..9.836 rows=20.00 loops=1)
              Sort Key: created_at
              Sort Method: quicksort  Memory: 637kB
              ->  Bitmap Heap Scan on email_outbox  (cost=135.85..1606.33 rows=3023 width=156) (actual time=0.937..7.064 rows=3004.00 loops=1)
                    Recheck Cond: (estado = 'PENDIENTE'::text)
                    Filter: ((siguiente_intento_en IS NULL) OR (siguiente_intento_en <= '2026-09-10 07:58:55.014+00'::timestamp with time zone))
                    Heap Blocks: exact=1403
                    ->  Bitmap Index Scan on email_outbox_estado_siguiente_intento_en_created_at_idx  (cost=0.00..135.09 rows=3024 width=0) (actual time=0.564..0.565 rows=3004.00 loops=1)
                          Index Cond: (estado = 'PENDIENTE'::text)
Planning Time: 0.960 ms
Execution Time: 9.962 ms

-- golpear(): lectura acotada ORDER BY at DESC LIMIT 11 (golpesQueDeciden para 10/h) sobre 38.000 golpes
Limit  (cost=0.41..2.87 rows=11 width=8) (actual time=0.043..0.048 rows=11.00 loops=1)
  Buffers: shared hit=5
  ->  Index Only Scan using rate_limit_hit_kind_clave_at_idx on rate_limit_hit  (cost=0.41..1091.57 rows=4893 width=8) (actual time=0.042..0.045 rows=11.00 loops=1)
        Index Cond: ((kind = 'password.olvido'::text) AND (clave = 'ip:203.0.113.99'::text) AND (at >= '2026-09-10 06:58:56.309+00'::timestamp with time zone))
        Heap Fetches: 11
Planning Time: 0.258 ms
Execution Time: 0.069 ms

-- purgarLimites(): DELETE FROM rate_limit_hit WHERE at < ahora − 24 h
Delete on rate_limit_hit  (cost=0.00..887.00 rows=0 width=0) (actual time=4.185..4.186 rows=0.00 loops=1)
  ->  Seq Scan on rate_limit_hit  (cost=0.00..887.00 rows=4 width=6) (actual time=4.182..4.183 rows=0.00 loops=1)
        Filter: (at < '2026-09-09 07:58:56.313+00'::timestamp with time zone)
        Rows Removed by Filter: 38000
Execution Time: 4.296 ms
```

Lo que enseñan, dicho tal cual: (1) **`tomarPendientes` no puede servir el `ORDER BY` desde el índice** —el `OR` sobre `siguiente_intento_en` lo impide— y hace bitmap sobre `estado = 'PENDIENTE'` más un `sort` de todas las pendientes; con 3.000 pendientes son 9,9 ms cada cinco segundos, y una cola sana tiene decenas, no miles; si algún día la cola se atasca, el coste es lineal en las pendientes, no en la tabla. (2) **`golpear` es exactamente lo que la corrección de la etapa 3 prometía**: `Index Only Scan` de 11 entradas, 0,07 ms, independiente de cuántos golpes tenga la clave. (3) **La purga es `Seq Scan`**: no hay índice que empiece por `at`; sobre lo que la tabla puede acumular —un día de golpes— son milisegundos, y queda registrado en «Deuda» como observación, con el arreglo si aparece en las consultas caras (un índice sobre `(at)` con esta consulta delante).

**Fase 3, etapa 3 (límite de tasa e IP tras el proxy), destapadas al construir:**

- **La IP entra en los casos de uso, no en el limitador desde el controlador.** `SolicitarRestablecimiento`, `RestablecerContrasena`, `InvitarUsuario` y `ReenviarInvitacion` reciben `ip` como `IniciarSesion` recibe la suya desde P1, y llaman a `LimitadorDeTasa.exigir` como primera línea. La alternativa —llamarlo desde los cuatro controladores— dejaba el reenvío sin destinatario (el correo del invitado solo se sabe tras buscarlo) y habría partido el límite en dos sitios. Consecuencia buena: `auth.password.reset_requested` y `auth.password.reset_completed` llevan ahora la IP, que el comentario de la etapa 1 dejaba «para cuando `ipDelCliente` la traiga».
- **En el reenvío la IP cuenta aunque el usuario no exista, y el límite corre entre la lectura y la escritura.** Treinta reenvíos a ids inventados desde una IP son treinta 404 y el siguiente 429: quien enumera ids no se libra por no acertar. El destinatario solo cuenta cuando hay invitado.
- **El golpe se registra antes de decidir si se lanza, y también cuando ya está bloqueado.** «Diez por hora» son diez peticiones, no diez rechazos; y contar el golpe bloqueado es lo que hace que insistir alargue la espera, como en el login. Es la opción más restrictiva de las dos posibles.
- **`Retry-After` sale para cualquier error de dominio con `reintentarEnSegundos`, no solo para `LimiteDeSolicitudesError`.** El filtro mira la forma; `AccesoBloqueadoError` (el login) no lo trae hoy y no se le añade en esta etapa —no estaba en el alcance y cambiaría un contrato de P1—, pero cuando se añada la cabecera saldrá sola.
- **`PeticionConOrigen` es un tipo estructural, no `IncomingMessage`.** Las 71 pruebas de `ipDelCliente` fabrican `{socket, headers}` a mano; con `IncomingMessage` la única forma sería `as unknown as`, que `audit:forbidden` prohíbe. `headers` es `Readonly<Record<string, string | string[] | undefined>>`, a lo que `IncomingHttpHeaders` es asignable.
- **`LimitadorGlobalGuard` no tiene constructor: la configuración entra por propiedad.** El guard base ya tiene tres parámetros y el proyecto no admite un cuarto; `@Inject(CONFIGURATION)` por propiedad deja los tres del base resolviéndose por sus metadatos (herencia de `design:paramtypes`), que es exactamente el ejemplo de `ThrottlerBehindProxyGuard` de la librería. Si la petición no es una `IncomingMessage` el guard lanza en vez de contar en una cubeta común: sería un cableado nuevo que nadie probó.
- **IPv6 se valida y canoniza con un parser propio (grupos hexadecimales, un solo `::`, IPv4 embebida al final, sin zona), no con `net.isIP`.** La misma pieza sirve para validar, para comparar con la lista y para normalizar `::ffff:a.b.c.d`; `net.isIP` habría validado pero no canonizado, y `login_attempt.ip` exige una forma que `INET` acepte (la zona `%eth0` no lo es). CIDR solo en IPv4, como dice D-16.49.
- **`AceptarInvitacion` viaja dentro de `InvitacionesDeUsuario`.** `UsuariosController` necesitaba la configuración y ya tenía tres dependencias; las tres operaciones son el ciclo de una invitación. Sin cambio de rutas ni de permisos.
- **El back office lee `PROXY_DE_CONFIANZA` a mano** (`proxies-de-confianza.ts`), como `BACKOFFICE_PORT` y `CORREO_MINUTOS_DE_ALERTA`: sigue sin esquema de entorno, y la validación es la misma función que usa el esquema de la API. La lista viaja en `SesionDelOperador` porque el controlador ya tiene sus tres dependencias.
- **Las suites que tocan los cuatro endpoints vacían `rate_limit_hit` con la dueña**, como ya vaciaban `login_attempt`: `correo-transaccional` (en `beforeAll`, en `beforeEach` y dentro de `tiempoDeOlvido`, que repite el mismo correo quince veces y el límite real es tres), `backoffice-correo`, `autenticacion-y-autorizacion` y `correo-despachador`. Las dos suites nuevas limpian al empezar y al terminar. Sin esto, la segunda corrida de la hora fallaría por una razón que no es la que mide (INC-014).
- **`host(ip)` y no `ip::text` para leer `login_attempt.ip` en las pruebas:** el texto de un `INET` escrito por Prisma sale con `/32`.
- **La línea de la etapa 2 en «Problemas» que citaba una URL de conexión de ejemplo se reescribió en palabras:** `audit:secrets` la marcaba como cadena de conexión (`secretlint-rule-database-connection-string`) y bloqueaba el commit. Es el mismo criterio que la propia línea contaba para el spec.

## Pruebas

**Fase 1 — unitarias (base apagada), 15 nuevas:** `shared/domain/iva/neteo.spec.ts` (CC-IVA-01, 02, 03 y la escala de división), `shared/domain/iva/precedencia.spec.ts` (CC-IVA-04, sin default, cero explícito, `exigirTarifaValida` en bordes, 15 y negativa), `inventory/domain/compra.spec.ts` (los cuatro importes, foto de recuperabilidad, bruto negativo). `cadena-de-costo.spec.ts` sigue en verde sin cambios tras delegar en `netear`. **Tras la corrección, 15 más:** `precedencia.spec.ts` (`motivoDeTarifaInvalida`), `inventory/domain/lote.spec.ts`, `pricing/domain/lote.spec.ts` y `catalog/domain/lote.spec.ts` (un 15 en la fila 2 sale con posición 2 junto al problema de la fila 3), `pricing/domain/preparacion.spec.ts` (D-16.51) y `compra.spec.ts` (`exigirDesgloseEnCompra`: pasa con desglose, para sin él, exime la corrección de una compra vieja). Total unitarias: **615** (eran 585 antes del paquete).

**Fase 1 — integración, `test/integracion/iva-de-compra.spec.ts`, 25 nuevas, una app HTTP:** la cadena completa `POST /inventario/movimientos` con los cuatro importes leídos con la dueña (CC-IVA-01), cuerpo > artículo (CC-IVA-04), grupo sin artículo, no recuperable como foto del momento (CC-IVA-02 / D-16.42), MERMA sin desglose; sin tarifa → 400 con `code` y el mensaje que dice dónde ponerla, grupo sin tarifa → 400, `15` rechazado en el campo **acompañado de otro campo inválido**, tarifa en MERMA → 400, artículo de otro ítem → 400, artículo de otra company → 404; corrección con los cuatro importes y Σ(COMPRA) = 0 en bruto y en neto; libro con `CONOCIDO`/`SIN_DESGLOSE` (la fila «vieja» la escribe la dueña sin desglose, D-16.18) y sin los campos en la vieja; BODEGA sobre la respuesta cruda de la escritura (ninguno de `totalBruto`, `ivaTarifaAplicada`, `ivaRecuperableAplicado`, `desglose`, `costoTotal`, `cantidad`) y 403 en el libro; `POST /catalogo/articulos` sin tarifa → 400; `PUT /catalogo/articulos/:id` (cambio + lista + la siguiente compra netea con la corregida; 400 / 404 ajeno / 409 repetido); `PUT /catalogo/grupos/:id` (pone, quita, 404 ajeno); `SugerirPrecio` sin tarifa → 400 y con artículo hereda la suya; CSV `MOVIMIENTOS` fila > grupo y rechazo «fila 2» sin tarifa (D-16.44), por `ImportarArchivo` como hace `importacion.spec`. **Tras la corrección:** una preparación en un grupo con 0.15 nace con `ivaCompra = 0` y con 0.15 en el cuerpo es 400 con «R10» en el mensaje (D-16.51); en `SugerirPreciosEnLote` la misma fila se rechaza con «fila 1» y sin tarifa se escribe con 0; el CSV con `iva=15` en la fila 2 se rechaza con «fila 2 … 0.15, no 15».

**Suites existentes actualizadas** (artículos con `ivaTarifa`, compras con tarifa `'0'` donde el importe no debe cambiar, siembras SQL con `iva_tarifa`): `analitica`, `consolidado`, `costeo`, `inventario`, `periodos-y-conteo`, `precios`, `catalogo`, `rendimiento-de-conteo`, `rendimiento-de-costeo`, `rendimiento-del-consolidado`. **E20 sigue en verde** (`precios.spec.ts`). `pricing/domain/lote.spec.ts` y `catalog/domain/lote.spec.ts` con la clave nueva en sus fixtures.

Comandos y resultado:

```
npm run test:unit --workspace @costeo/api
  Test Files 43 passed · Tests 615 passed          (tras la corrección; antes 42 / 600)
npm run test:integration --workspace @costeo/api -- test/integracion/iva-de-compra.spec.ts
  Test Files 1 passed · Tests 25 passed            (tras la corrección; antes 22)
npm run test:integration --workspace @costeo/api -- test/integracion/precios.spec.ts test/integracion/catalogo.spec.ts test/integracion/inventario.spec.ts test/integracion/importacion.spec.ts
  Test Files 4 passed · Tests 70 passed            (tras la corrección)
npm run test:integration --workspace @costeo/api -- test/integracion/analitica.spec.ts test/integracion/consolidado.spec.ts test/integracion/costeo.spec.ts test/integracion/periodos-y-conteo.spec.ts test/integracion/rendimiento-de-conteo.spec.ts test/integracion/rendimiento-de-costeo.spec.ts test/integracion/rendimiento-del-consolidado.spec.ts
  Test Files 7 passed · Tests 74 passed | 4 skipped (INC-016, con motivo)
```

Auditoría de la fase: `audit:types`, `audit:lint`, `audit:forbidden` (40 reglas / 374 archivos), `audit:arch` (301 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (14 reversibles), `audit:deadcode` — todos en verde.

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
```

**`migrate:deploy` y `down` + `deploy` sobre la base de desarrollo sembrada** (INC-011: `verify` solo corre sobre bases limpias). Recuento con la dueña antes, tras el `down` y tras volver a aplicar; la base tiene 108.471 artículos, 29 grupos y **16.123.203 movimientos, 8.082.570 de ellos `COMPRA`** (volumen sintético de `bench` más el residuo de las suites):

```
===== [1] recuento ANTES
columnas P16-A1 presentes: inventory_movement.desglose_conocido, inventory_movement.iva_recuperable_aplicado,
  inventory_movement.iva_tarifa_aplicada, inventory_movement.total_bruto, item_group.iva_tarifa, purchase_article.iva_tarifa
purchase_article: 108471 · item_group: 29 · inventory_movement: 16123203 · COMPRA: 8082570 · COMPRA con desglose: 116
purchase_article.iva_tarifa: 0.080000000000 x4 · 0.000000000000 x85 · 0.150000000000 x108382
migraciones aplicadas: 14 · última: 20260910012847_p16a1_iva_de_compra
===== [2] npm run migrate:deploy
14 migrations found in prisma/migrations
No pending migrations to apply.
===== [3] npm run migrate:down
[migrate:down] revirtiendo 1 migracion(es), de la mas reciente:
  <- 20260910012847_p16a1_iva_de_compra
[migrate:down] listo.
===== [4] recuento tras el down
columnas P16-A1 presentes: (ninguna)
purchase_article: 108471 · item_group: 29 · inventory_movement: 16123203 · COMPRA: 8082570
migraciones aplicadas: 13 · última: 20260908171210_p11_backoffice
===== [5] npm run migrate:deploy
Applying migration `20260910012847_p16a1_iva_de_compra`
All migrations have been successfully applied.
===== [6] recuento DESPUES
columnas P16-A1 presentes: (las seis)
purchase_article: 108471 · item_group: 29 · inventory_movement: 16123203 · COMPRA: 8082570 · COMPRA con desglose: 0
purchase_article.iva_tarifa: 0.150000000000 x108471
migraciones aplicadas: 14 · última: 20260910012847_p16a1_iva_de_compra
```

Lo que el recuento enseña y conviene leer: el `down` **destruye** el desglose de las 116 compras y las 89 tarifas corregidas (es lo que hace soltar una columna: por eso el runbook pide respaldo antes de migrar), y al volver a aplicar todos los artículos quedan otra vez en la semilla 0.15. Sobre 16 M de filas el `down` y el `deploy` tardaron segundos: las columnas nuevas son anulables o con `DEFAULT` constante, que en PostgreSQL 18 no reescribe la tabla.

**Fase 3, etapa 1 — unitarias (base apagada), 31 nuevas:** `shared/application/correo/plantillas.spec.ts` (9: enlace en línea propia, caducidad hasta los minutos en UTC, asunto, sin contraseñas, «una sola vez», caducidad ilegible tal cual, sin HTML), `shared/infrastructure/config/environment.spec.ts` (14: `APP_URL` con y sin barra, no URL, obligatoria en producción, default de desarrollo; `HORAS_DE_RESTABLECIMIENTO` 2 / `0`, `25`, `1.5`, `una`; `MAIL_ADAPTER` los tres valores y `real` rechazado), `iam/application/casos-de-uso/restablecer-contrasena.spec.ts` (8: token, caducidad con las horas configuradas y enlace en vez de token; mismo trabajo sin usuario; auditoría anónima sin el correo; consume → hash → revoca → audita bajo company; token desconocido, vacío, contraseña con el correo, tenant que no ve al usuario). El doble de `iniciar-sesion.spec.ts` implementa los tres métodos nuevos del puerto. Total unitarias: **646** (eran 615).

**Fase 3, etapa 1 — integración, `test/integracion/correo-transaccional.spec.ts`, 18 nuevas, una app HTTP:** invitación → fila `PENDIENTE` con `company_id`, `user_id` del invitado, `plantilla`, `intentos = 0`, `sent_at` nulo y `datos.enlace` con `token=` bajo `APP_URL/activacion`; correo en uso en otra company → 202 y **ningún** correo (misma transacción); reenvío → segunda fila con token distinto, el viejo ya no activa (401 `SESION_INVALIDA`) y el nuevo sí; reenvío a un activo → 404, a un invitado de otra company → 404 sin encolar, `GERENTE_LOCAL` → 403 `PERMISO_DENEGADO`, id no UUID → 400 `BAD_REQUEST`; `/olvido` sin sesión con correo activo → 202 `{}`, fila en `password_reset_token` (`used_at` nulo, vida = `HORAS_DE_RESTABLECIMIENTO` ± 10 s) y correo `RESTABLECIMIENTO` con el `company_id` del usuario; correo inexistente → 202 `{}` idéntico y ninguna fila; invitado sin activar → 202 y ninguna fila; clave de más → 400; `/restablecimiento` sin sesión consume, la sesión abierta cae (401), la contraseña vieja no entra (`CREDENCIALES_INVALIDAS`) y la nueva sí; token dos veces → 400 `ENTRADA_INVALIDA`; caducado (fila entera movida dos horas al pasado con la dueña) → 400; inventado y vacío → 400; filtrada → 400 y el token ya gastado; `costeo_app` sobre `password_reset_token` → `42501`; `costeo_despachador` lee `email_outbox` y recibe `42501` en `app_user`, `password_reset_token`, `rate_limit_hit.clave` y `company`. **`autenticacion-y-autorizacion.spec.ts`** (25) sigue en verde con el helper nuevo.

```
npm run test:unit --workspace @costeo/api
  Test Files 45 passed · Tests 646 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-transaccional.spec.ts test/integracion/autenticacion-y-autorizacion.spec.ts
  Test Files 2 passed · Tests 43 passed
```

**Tras la corrección de la revisión adversarial de la etapa.** Unitarias: 648 (+2: `plantillas.spec.ts` gana `BLOQUEO` —sin enlaces, asunto y texto— y el caso HTML recorre las tres; las cuatro del «aviso al titular» de `iniciar-sesion.spec.ts` pasan a comprobar el repositorio doble —company y usuario de la cuenta, `plantilla: 'BLOQUEO'`, `datos: {}`, y el cuerpo renderizado sin URLs—; el doble de `restablecer-contrasena.spec.ts` implementa `encolarCorreo` y lee el enlace por `datosParaGuardar`). Integración: `correo-transaccional.spec.ts` 22 (+4: atomicidad «sin outbox no hay invitado»; medianas de `/olvido` con y sin usuario a menos de 50 ms; cinco fallos → fila `BLOQUEO` sin enlace y `datos = {}`, sexto intento 429; `costeo_app` sin `SELECT datos`, sin `UPDATE`/`DELETE` en la cola y sin `INSERT` en `password_reset_token`, con control positivo sin fijar tenant) y **`backoffice-correo.spec.ts`** nueva, 2 (el token en claro no está en `audit_log` por ninguna de las tres rutas, leído con `costeo_backoffice` y con control positivo de los eventos recién escritos; el back office ve la salud de la cola y `SELECT datos` → `42501`). `autenticacion-y-autorizacion`, `aislamiento-entre-companies`, `pentest`, `roles-de-base-de-datos`, `backoffice`, `salud-y-errores` y `limitador` siguen en verde.

```
npm run test:unit --workspace @costeo/api
  Test Files 45 passed · Tests 648 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-transaccional.spec.ts test/integracion/autenticacion-y-autorizacion.spec.ts
  Test Files 2 passed · Tests 47 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-transaccional.spec.ts test/integracion/backoffice-correo.spec.ts test/integracion/backoffice.spec.ts
  Test Files 3 passed · Tests 34 passed
npm run test:integration --workspace @costeo/api -- test/integracion/aislamiento-entre-companies.spec.ts test/integracion/pentest.spec.ts test/integracion/roles-de-base-de-datos.spec.ts test/integracion/backoffice.spec.ts test/integracion/salud-y-errores.spec.ts test/integracion/limitador.spec.ts
  Test Files 6 passed · Tests 70 passed
```

Auditoría tras la corrección: `audit:types`, `audit:lint`, `audit:forbidden` (40 reglas / 392 archivos), `audit:arch` (313 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode` — en verde. La migración corregida (CHECK con `BLOQUEO`, `SELECT` por columnas) se re-aplicó en la base local con `migrate:down` + `migrate:deploy` y se verificó:

```
npm run migrate:down
[migrate:down] revirtiendo 1 migracion(es), de la mas reciente:
  <- 20260910042649_p16a1_correo_y_limite_de_tasa
[migrate:down] listo.
npm run migrate:deploy
migrations/
  └─ 20260910042649_p16a1_correo_y_limite_de_tasa/
    └─ migration.sql
All migrations have been successfully applied.

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

Estado en la base local tras el `deploy`: `has_column_privilege(rol, 'email_outbox', 'datos', 'SELECT')` → `costeo_app` **f**, `costeo_backoffice` **f**, `costeo_despachador` t; `has_table_privilege(rol, 'email_outbox', 'SELECT')` → `costeo_app` f, `costeo_backoffice` f (solo columnas), `costeo_despachador` t.

```
(sigue la evidencia original de la etapa)
npm run test:integration --workspace @costeo/api -- test/integracion/roles-de-base-de-datos.spec.ts test/integracion/backoffice.spec.ts test/integracion/salud-y-errores.spec.ts test/integracion/pentest.spec.ts test/integracion/limitador.spec.ts
  Test Files 5 passed · Tests 48 passed
```

Auditoría de la etapa: `audit:types`, `audit:lint`, `audit:forbidden` (40 reglas / 391 archivos), `audit:arch` (313 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode` — en verde.

```
npm run migrate:deploy
Applying migration `20260910042649_p16a1_correo_y_limite_de_tasa`
All migrations have been successfully applied.

npm run migrate:verify
[migrate:verify] 1/4  ida completa
[migrate:verify] 2/4  escalera: ida y vuelta entera
  OK  el down deshace exactamente lo que hizo el up
[migrate:verify] 3/4  repeticion: up -> down -> up
  OK  up -> down -> up es idempotente
[migrate:verify] 4/4  sin deriva entre las migraciones y schema.prisma
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY
```

Estado en la base local tras el `deploy` (`pg_class`, `pg_proc`, ACL): las tres tablas con `relrowsecurity = t` y `relforcerowsecurity = t`; `password_reset_consume` y `password_reset_request` con `provolatile = v` y `prosecdef = t`; `email_outbox` `{costeo_app=ar, costeo_despachador=rw, costeo_backoffice=r}`, `rate_limit_hit` `{costeo_app=ar, costeo_despachador=d}` más `at {costeo_despachador=r}`, `password_reset_token` solo el dueño.

**Fase 3, etapa 2 — unitarias (base apagada), 36 nuevas:** `modules/correo/domain/reintentos.spec.ts` (5: primer fallo un minuto, la escalera 1 → 2 → 4 → 8, quinto fallo `FALLIDO`, por encima del tope sigue `FALLIDO`, no muta el instante), `saneado.spec.ts` (2), `application/despachar-correo.spec.ts` (7, con cola y mailer en memoria: envío y marca con saneado; un fallo no para a los demás y lleva error, espera y sin sanear; al quinto fallo viaja `FALLIDO` con el saneado; `contenido: null` cuenta como fallo sin llamar al proveedor; el error se acota a 500; `BLOQUEO` sin datos; el lote configurado y la purga a 24 h aunque no haya correos), `infrastructure/entorno-del-despachador.spec.ts` (8: mínimo y valores por defecto; **no acepta `DATABASE_URL`**; rol distinto rechazado sin repetir la contraseña; la comprobación del rol sale **acompañada** de otro error, INC-008; `fake` en producción no arranca; `consola`/`resend` sí; `RESEND_*` con recorte y vacío = ausente; cotas de intervalo y lote), `infrastructure/bucle.spec.ts` (3), `shared/infrastructure/correo/resend-mailer.spec.ts` (5, contra un `fetch` falso: 2xx con `POST`, `Bearer`, remitente y los cuatro campos; 5xx con el estado y **sin** el cuerpo ni la clave; 401 también falla; timeout de verdad con `AbortSignal`; un fallo de red sube tal cual), `consola-mailer.spec.ts` (2: con y sin cuerpo), `mailer.provider.spec.ts` (4: `fake`/`consola` sin credenciales; `resend` sin clave y sin remitente no arranca, con las dos sí). Total unitarias: **684** (eran 648).

**Fase 3, etapa 2 — integración, `test/integracion/correo-despachador.spec.ts`, 11 nuevas (una app HTTP para encolar + `createApplicationContext(CorreoModule.forRoot(…))` con `FakeMailer` y lote grande; la cola se vacía del residuo de otras suites antes de medir, INC-014):** dos companies invitan → una pasada envía los dos, con asunto y enlace, `ENVIADO`, `intentos = 1`, `sent_at`, sin error (D-16.15); tras `ENVIADO`, `datos` sin `token=` ni `enlace` y exactamente `{plantilla, destinatario}` (D-16.34); `failNext(1)` → `PENDIENTE`, `intentos = 1`, error «simulado», `siguiente_intento_en` a más de 50 s en el futuro, el enlace **sigue** en vuelo, y la pasada siguiente no lo toma; cinco fallos (venciendo la espera con la dueña entre uno y otro) → `FALLIDO`, `datos` saneado, sin siguiente intento ni `sent_at`, y una pasada más no lo toma (D-16.46); un reintento que al fin sale queda `ENVIADO` con `intentos = 2` y el error borrado; la purga borra los golpes de 25 h y 30 h y respeta los de 23 h y de ahora (D-16.28); `AppModule` no tiene `DespachadorConnection` (`get` estricto y no estricto) ni `CorreoModule` (`select`), y el contexto del despachador sí; `costeo_despachador` recibe `42501` en `app_user`, `inventory_movement`, `company` y `password_reset_token`, puede `UPDATE` sobre la cola (control positivo) pero ni `INSERT` ni `DELETE`, y sobre `rate_limit_hit` lee `at` y no `clave`. **`backoffice-interfaz.spec.ts`, +2:** `GET /correo/salud` con sesión de operador devuelve exactamente `{pendientesAntiguos, fallidos, ultimoEnvio}` con una fila `PENDIENTE` de dos horas sembrada (para que «no aparece» no sea «no había nada»), y la respuesta **cruda** no contiene `datos`, `@`, `token` ni `snacklab`; la ruta no deja fila en `backoffice_access_log`; y `/correo/salud` sin sesión es 401.

```
npm run test:unit --workspace @costeo/api
  Test Files 53 passed · Tests 684 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-despachador.spec.ts test/integracion/backoffice-interfaz.spec.ts
  Test Files 2 passed · Tests 18 passed
npm run test:integration --workspace @costeo/api -- test/integracion/backoffice.spec.ts test/integracion/backoffice-correo.spec.ts test/integracion/correo-transaccional.spec.ts test/integracion/roles-de-base-de-datos.spec.ts test/integracion/salud-y-errores.spec.ts
  Test Files 5 passed · Tests 48 passed
```

**El guardián de las reglas nuevas** (sabotaje → captura → reversión). Un archivo temporal `apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts` que importa `CorreoModule` y `DespachadorConnection` y lee `DESPACHADOR_DATABASE_URL`:

```
audit:forbidden  FALLO — 5 infraccion(es)
  [conexion-del-despachador-solo-en-correo]  Nombrar `DespachadorConnection` fuera del modulo de correo
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:2  import { DespachadorConnection } from '../../correo/infrastructure/despachador-connection';
  [cadena-del-despachador-solo-en-correo]  Leer `DESPACHADOR_DATABASE_URL` fuera del modulo de correo
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:3  export const sabotaje = { ..., cadena: process.env['DESPACHADOR_DATABASE_URL'] };
  [correo-no-lo-monta-la-app]  Importar `CorreoModule` desde el arbol de la aplicacion cliente
     apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts:1  import { CorreoModule } from '../../correo/infrastructure/correo.module';
audit:arch (con el sabotaje)
  error correo-no-entra-desde-otros-modulos: apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts → apps/api/src/modules/correo/infrastructure/despachador-connection.ts
  error correo-no-entra-desde-otros-modulos: apps/api/src/modules/iam/infrastructure/sabotaje-guardian.ts → apps/api/src/modules/correo/infrastructure/correo.module.ts
  x 2 dependency violations (2 errors, 0 warnings). 340 modules, 1479 dependencies cruised.
(revertido)
audit:forbidden  OK — 43 reglas sobre 419 archivos
audit:arch  OK — reglas de capa respetadas y guardian verificado
(segundo sabotaje: apps/api/src/sabotaje-guardian-2.ts importa CorreoModule desde la raíz de src/)
  [correo-no-lo-monta-la-app]  apps/api/src/sabotaje-guardian-2.ts:1  import { CorreoModule } from './modules/correo/infrastructure/correo.module';
```

**El binario real, contra la base local** (`npm run build`, `CORREO_INTERVALO_MS=1000 node dist/despachador.js` con `MAIL_ADAPTER=consola`, una fila `PENDIENTE` y un golpe de `rate_limit_hit` de hace dos días sembrados con la dueña; siete segundos y `SIGTERM`):

```
despachador de correo: adaptador consola, una pasada cada 1000 ms, lote de 20, latido en C:\Users\Lander\AppData\Local\Temp\costeo-correo.latido
[correo] para: salud-9a1a52ff@snacklab.ec
[correo] asunto: Te han invitado a costeo-saas
----------------------------------------
Te han invitado a usar costeo-saas. Para activar tu cuenta y elegir tu contrasena, abre este enlace:
http://localhost:3001/activacion?token=secreto
…
[correo] tomados 20 · enviados 20 · fallidos 0 · golpes purgados 1
…
[correo] para: evidencia.despachador@snacklab.ec
…
[correo] tomados 14 · enviados 14 · fallidos 0 · golpes purgados 0

fila sembrada tras la pasada: { estado: 'ENVIADO', intentos: 1, enviado: true, datos: '{"plantilla": "INVITACION", "destinatario": "evidencia.despachador@snacklab.ec"}' }
rate_limit_hit con clave 'ip:evidencia': { quedan: 0 }
latido: C:\Users\Lander\AppData\Local\Temp\costeo-correo.latido -> 2026-09-10T06:03:38.346Z
```

`docker compose config` en verde con el archivo base y con la superposición de producción (`APP_URL`, `MAIL_ADAPTER`, `DOMINIO`, `CORREO_TLS` puestos); el servicio `correo` sale con `image: costeo-api:local`, sin puertos y con el healthcheck sobre el latido.

Auditoría de la etapa: `audit:types`, `audit:lint`, `audit:forbidden` (43 reglas / 419 archivos), `audit:arch` (339 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode` — en verde. Sin migración nueva en esta etapa: la de la etapa 1 ya traía `siguiente_intento_en` y los privilegios del rol.

**Corrección tras la revisión adversarial de la etapa «Despachador» (cuatro hallazgos, los cuatro atendidos):**

- **Unitarias, +6** (base apagada; total **690**, eran 684): `infrastructure/bucle.spec.ts` (+3: `correr()` con una parada **a media pasada** no resuelve hasta que la pasada termina y no arranca otra; una parada durante la espera sale enseguida; ya detenido no hace ninguna pasada), `application/despachar-correo.spec.ts` (+3: la reserva se renueva por correo con la firma con la que se tomó; una fila cuya reserva ya es de otra instancia se **cede** —ni proveedor ni marca— y la pasada sigue con `{tomados: 2, enviados: 1, cedidos: 1}`; **si el proveedor aceptó y falla `marcarEnviado`, el error sube, `marcarFallo` no se llama y la pasada se corta ahí**: el segundo correo ni se intenta y la purga no corre).
- **Integración, `correo-despachador.spec.ts`, +1 (12):** `tomarPendientes` deja escrita la reserva del lote y es la firma que viaja con la fila; la dueña simula a «otra instancia» reescribiendo `siguiente_intento_en` de una fila → `renovarReserva` devuelve `false` para esa y `true` para la intacta (cuya reserva avanza); un correo ya `ENVIADO` tampoco se renueva (`estado = 'PENDIENTE'` en el `WHERE`).
- **El binario real contra la base local, reproducción literal del revisor** (`npm run build`, después `node -e "…setTimeout(()=>process.emit('SIGTERM','SIGTERM'),3000);process.on('exit',c=>console.log('exit',c));require('./apps/api/dist/despachador.js')"` con `CORREO_INTERVALO_MS=1000`, `MAIL_ADAPTER=fake`, `NODE_ENV=development`). Antes: «SIGTERM: se termina la pasada…» y muerte por `process.kill` sin `exit` (código 1). Ahora:

```
despachador de correo: adaptador fake, una pasada cada 1000 ms, lote de 20, latido en C:\Users\Lander\AppData\Local\Temp\costeo-correo.latido
[correo] tomados 1 · enviados 1 · fallidos 0 · cedidos 0 · golpes purgados 0
[correo] SIGTERM: se termina la pasada en curso y se sale
exit 0
codigo de salida del proceso: 0
```

- **`npm run rol:despachador` y `npm run rol:backoffice` tras quitar el `loadEnvFile` sin guarda**: «ya existe. No se toca su contrasena. CONNECT sobre costeo concedido.» los dos (el camino idempotente que `desplegar.sh` 5/8 recorre en cada despliegue).

```
npm run test:unit --workspace @costeo/api
  Test Files 53 passed · Tests 690 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-despachador.spec.ts test/integracion/correo-transaccional.spec.ts test/integracion/backoffice-correo.spec.ts
  Test Files 3 passed · Tests 36 passed            (costeo-api detenido durante la corrida, INC-016)
```

Auditoría tras la corrección: `audit:types`, `audit:lint`, `audit:forbidden` (**44** reglas / 419 archivos), `audit:arch` (339 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode` — en verde. Sin migración nueva.

**Fase 3, etapa 3 — unitarias (base apagada), 116 nuevas o reescritas:** `shared/domain/acceso/politica-de-intentos.spec.ts` (11, con políticas que NO son las del login: umbral, ventana de escalada sin disparo, escala que se repite, insistir alarga), `iam/domain/politica-de-intentos.spec.ts` (**23, sin cambios**, en verde tras la generalización), `shared/domain/limite-de-tasa/politicas.spec.ts` (11: los cuatro `kind` con sus umbrales, ventana de una hora, el enésimo pasa y el enésimo+1 no, una hora después vuelve, `LimiteDeSolicitudesError` con 429, segundos, minuto en singular y plural, nunca cero, sin correo ni IP en el mensaje), `shared/application/limite-de-tasa/limitador.spec.ts` (15, registro en memoria: claves `ip:` y `correo:<sha256>` normalizado; el golpe se registra siempre, por eje presente, también bloqueado; umbral por IP y por destinatario independientes, otro correo pasa, el mismo desde otra IP no, otro `kind` no cuenta, una hora después pasa; el error trae los segundos; el evento `system.ratelimit.exceeded` sin company, con IP y sin el correo ni su hash; permitido no audita), `shared/infrastructure/http/ip-del-cliente.spec.ts` (**71**: IPv4 estricta, IPv4 mapeada en las cuatro formas, IPv6 canónica con `::`, mayúsculas, ceros y v4 embebida, mal formadas y con zona, `esProxyDeConfianzaValido` con CIDR válidos e inválidos, y `ipDelCliente` sin lista, con lista —último salto, cabecera repetida, exacta, IPv6 exacta, canónica contra `::ffff:`, ocho formas de basura que caen al socket, coma final—, fuera de la lista —vecina, `/32`, `/0`, entrada mal escrita—, y la salida siempre canónica o `null`), `shared/infrastructure/config/environment.spec.ts` (+5: vacía, lista con espacios, cinco valores rechazados, una mala entre buenas, y **acompañada de `PORT` inválido** la comprobación sigue en el informe, INC-008), `shared/infrastructure/http/error.filter.spec.ts` (+2: `LIMITE_DE_SOLICITUDES` 429 con `Retry-After` y el mensaje; un error de dominio sin espera no lleva la cabecera), `iam/application/casos-de-uso/restablecer-contrasena.spec.ts` (reescrito con `LimitadorDeTasa` sobre un registro en memoria; +3: el límite corre antes de generar nada y el cuarto por destinatario no deja solicitud pero sí golpe y evento; sin IP el destinatario protege; el undécimo por IP no toca el token ni guarda hash). Total unitarias: **812** (eran 684).

**Fase 3, etapa 3 — integración, tres suites nuevas o reescritas (19 casos) y un caso en `backoffice-correo.spec.ts`:** `test/integracion/limite-de-tasa.spec.ts` (12, app con `proxiesDeConfianza: ['127.0.0.1']` y `rateLimit.max` alto; cada caso elige su IP con `X-Forwarded-For` del rango de documentación): `/olvido` el décimo por IP pasa y el undécimo es 429 `LIMITE_DE_SOLICITUDES` con `Retry-After` entero entre 1 y 3600 y «minuto(s).» al final del mensaje, aunque cada uno lleve otro correo; el mismo correo con cuatro IP distintas se corta a la cuarta; dos correos desde la misma IP tienen tres cada uno y la IP sigue teniendo margen; **con par confiable otra `X-Forwarded-For` es otra clave** (la IP bloqueada no arrastra a la vecina); el golpe bloqueado también cuenta (12 filas `ip:` tras 10 + 2, y el `Retry-After` no baja); `/restablecimiento` diez tokens inválidos son diez 400 y el undécimo 429 antes de mirar el token; `POST /usuarios` el mismo destinatario tres veces 202 y la cuarta 429, y **treinta por IP pasan y la trigésimo primera es 429**; reenvío tres veces al mismo invitado y la cuarta 429, y treinta 404 a ids inventados y el siguiente 429; **`login_attempt.ip` guarda el último salto** (`10.9.9.9, 203.0.113.N` → `203.0.113.N`); y ninguna clave de `rate_limit_hit` lleva `@` (todas `ip:<v4>` o `correo:<64 hex>`). `test/integracion/ip-tras-el-proxy.spec.ts` (3, app con `proxiesDeConfianza: []`): diez `/olvido` con diez `X-Forwarded-For` distintas y diez correos distintos, y el undécimo es 429 con otra cabecera más y también sin cabecera; los doce golpes quedaron bajo `ip:127.0.0.1`, ninguno bajo `ip:198.51.100.*`, y doce `correo:<hash>`; `login_attempt.ip` guarda el socket aunque la cabecera diga `203.0.113.77`. `test/integracion/limitador.spec.ts` (+1, app con par confiable): agotadas las tres del socket, una `X-Forwarded-For` nueva vuelve a tener tres y se agota a la cuarta sin liberar al socket — **el `ThrottlerGuard` global distingue por cabecera con par confiable**. `backoffice-correo.spec.ts` (+1): cuatro `/olvido` a un correo inexistente, el cuarto 429, y con el rol del back office se lee `system.ratelimit.exceeded` con `host(ip) = 127.0.0.1`, `detail = {kind: 'password.olvido', ejes: 'destinatario', …}` y sin el correo en ninguna columna. La purga de `rate_limit_hit` que respeta las recientes ya estaba probada en `correo-despachador.spec.ts` y sigue en verde.

**Suites existentes en verde tras el cableado** (vacían `rate_limit_hit` como vacían `login_attempt`): `correo-transaccional` (22), `backoffice-correo` (3), `autenticacion-y-autorizacion` (25), `correo-despachador` (12), `backoffice` , `backoffice-interfaz`, `salud-y-errores`, `pentest` (21).

Comandos y resultado:

```
npm run test:unit --workspace @costeo/api
  Test Files 57 passed · Tests 812 passed
npm run test:integration --workspace @costeo/api -- test/integracion/limite-de-tasa.spec.ts test/integracion/ip-tras-el-proxy.spec.ts test/integracion/limitador.spec.ts
  Test Files 3 passed · Tests 19 passed
npm run test:integration --workspace @costeo/api -- test/integracion/correo-transaccional.spec.ts test/integracion/backoffice-correo.spec.ts test/integracion/autenticacion-y-autorizacion.spec.ts test/integracion/correo-despachador.spec.ts test/integracion/backoffice.spec.ts test/integracion/backoffice-interfaz.spec.ts test/integracion/salud-y-errores.spec.ts test/integracion/pentest.spec.ts
  Test Files 8 passed · Tests 105 passed   (tras corregir `host(ip)` en el caso nuevo del back office)
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env config
  networks.default.ipam.config[0].subnet = 172.28.0.0/24 · api.environment.PROXY_DE_CONFIANZA exigida
```

Auditoría de la etapa: `audit:types`, `audit:lint`, `audit:forbidden` (44 reglas / 431 archivos), `audit:arch` (351 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode`, `audit:secrets` — todos en verde. Sin migración nueva en esta etapa: `rate_limit_hit` y `system.ratelimit.exceeded` venían de la etapa 1.

**Corrección tras la revisión adversarial de la etapa «Límite e IP».** Unitarias nuevas o reescritas (base apagada): `shared/domain/acceso/politica-de-intentos.spec.ts` (+7: `golpesQueDeciden` es `umbral × escalones + 1` y decide lo mismo con los 5 más recientes que con 40; `abreBloqueo` con `umbral`, `2 × umbral`, los de en medio, cero y el tope truncado), `shared/application/limite-de-tasa/limitador.spec.ts` (registro en memoria con `golpear` que hace lo que el puerto promete; +4: cinco 429 → un evento y cinco golpes; el evento nombra solo el eje que bloquea; pide `maximo` 11 por IP y 4 por destinatario; con 200 golpes bloqueados el `Retry-After` sigue contando desde el último), `iam/application/casos-de-uso/restablecer-contrasena.spec.ts` (registro en memoria con `golpear`, aserciones intactas). Integración: `limite-de-tasa.spec.ts` (+2, «en PARALELO» con `Promise.all`: 12 al mismo buzón → exactamente 3 aceptadas y 12 golpes; 30 desde la misma IP → exactamente 10 y 30 golpes; **las dos en rojo antes de la corrección: 12 de 12 y 30 de 30 aceptadas**), `backoffice-correo.spec.ts` (el caso del evento exige ahora **una** fila tras tres 429 más). Sin migración: la tabla y el índice `(kind, clave, at DESC)` ya servían.

```
npm run test:unit --workspace @costeo/api
  Test Files 57 passed · Tests 823 passed   (eran 812)
npm run test:integration --workspace @costeo/api -- test/integracion/limite-de-tasa.spec.ts
  Test Files 1 passed · Tests 14 passed     (antes de corregir: 2 failed — 30 de 30 y 12 de 12 aceptadas)
npm run test:integration --workspace @costeo/api -- test/integracion/backoffice-correo.spec.ts test/integracion/ip-tras-el-proxy.spec.ts test/integracion/limitador.spec.ts test/integracion/correo-transaccional.spec.ts test/integracion/autenticacion-y-autorizacion.spec.ts test/integracion/correo-despachador.spec.ts test/integracion/pentest.spec.ts test/integracion/salud-y-errores.spec.ts
  Test Files 8 passed · Tests 95 passed
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env config   (con las `:?falta` de relleno)
  services.caddy.networks.default.ipv4_address = 172.28.0.10 · api.environment.PROXY_DE_CONFIANZA = 172.28.0.10 · subnet 172.28.0.0/24
```

Auditoría tras la corrección: `audit:types`, `audit:lint`, `audit:forbidden` (44 reglas / 433 archivos), `audit:arch` (351 módulos), `audit:complexity`, `audit:duplication` (0 clones), `audit:migrations` (15 reversibles), `audit:deadcode` (salida 0; las ocho «configuration hints» de `knip.json` ya estaban) y `audit:secrets` — en verde.

**Cierre — las cuentas finales del paquete, sobre el árbol completo** (con `costeo-api` detenido durante la corrida de integración, INC-016, y vuelto a levantar después):

```
npm run test:unit --workspace @costeo/api
  Test Files 57 passed · Tests 823 passed                 (eran 585 al abrir el paquete: +238)
npm run test:integration --workspace @costeo/api
  Test Files 30 passed · Tests 395 passed | 5 skipped     (400 casos; eran 313: +87. Las 5 saltadas son
                                                           los presupuestos de rendimiento con motivo, INC-016)
npm run audit:types · audit:lint · audit:forbidden (44 reglas sobre 433 archivos) · audit:arch (351 módulos,
  1529 dependencias) · audit:complexity · audit:duplication (0 clones) · audit:migrations (15 reversibles y con RLS)
  · audit:deadcode — los ocho con código 0
npm run migrate:deploy
  15 migrations found in prisma/migrations · No pending migrations to apply.
```

Las seis suites nuevas: `iva-de-compra` (25), `correo-transaccional` (22), `correo-despachador` (12), `backoffice-correo` (3), `limite-de-tasa` (14), `ip-tras-el-proxy` (3). El 500 que aparece en el log de integración es el caso deliberado «si el outbox no acepta el correo, el invitado tampoco existe». La salida literal de `npm run audit` completo la pega el orquestador en `AUDITORIA-RESULTADO.md`.

## Problemas encontrados y cómo se resolvieron

**Fase 1:**

- **`ADD COLUMN … NOT NULL` generado por Prisma sobre una tabla con filas.** `migrate:new` produce la sentencia sin default y fallaría en toda base con artículos. Se movió esa línea al bloque MANUAL con `DEFAULT 0.15` + `DROP DEFAULT`; `migrate:verify` 4/4 confirma que el estado final coincide con `schema.prisma`. No es incidencia: el mensaje lo habría dicho al primer `migrate:deploy`.
- **Las suites existentes compraban sin artículo y sin grupo**: con «nunca 0.15», las 29 compras de `inventario.spec` y las de cinco suites más serían 400. Se resolvió en las pruebas, no relajando la regla: tarifa `'0'` explícita donde el importe no debe cambiar (bruto = neto), y `'0.15'` donde el IVA ya era el caso.
- **`audit:complexity`** paró `RegistrarMovimiento.ejecutar` (42 líneas) y `resolverUno` del lote de precios (complejidad 11 por los `?.`/`??` de la precedencia). Se extrajeron `filaDe` y `conTarifa`.
- **Archivos con CRLF en el árbol de trabajo** (`dependencias-de-precios.ts`): los reemplazos por script fallaban en silencio hasta normalizar; git los declara `eol=lf`. Sin efecto en el repositorio.
- **`costeo-api` levantado durante la suite** (INC-016): se detuvo el contenedor antes de correr integración y se volvió a levantar al terminar.
- **Revisión adversarial de la Fase 1 — seis hallazgos, los seis atendidos.** (1, alta) Documentación «en el mismo commit» ausente: `modelo-datos.md`, ADR-024, CHANGELOG y la columna `iva` en los runbooks — escrita. (2, alta) Evidencias de la Fase 1: `migrate:deploy` y `down` + `deploy` sobre la base sembrada — ejecutadas y pegadas; la re-importación de los datos de ejemplo no aplica desde el repositorio y quedó justificada en «Decisiones» y en el runbook. (3, media) El CHECK no impide una `COMPRA` nueva sin desglose — guarda `exigirDesgloseEnCompra` en la puerta del repositorio, con su unitaria, y la limitación dicha en guardas y ADR-024. (4, media) La fracción se validaba con `throw` dentro del bucle de los lotes, sin fila y sin los demás motivos — `motivoDeTarifaInvalida` en el dominio de los tres lotes; la copia local de `catalog` desapareció. (5, media) SPEC §11 con la tabla partida — arreglado. (6, media) Precedencia aplicada a `PRODUCIDO` — D-16.51, pendiente de ratificar. `audit:lint` paró cuatro `expect(() => guarda())` del spec nuevo (`no-confusing-void-expression`); se envolvieron en llaves.
- **`Decimal.toFixed()` de Prisma no conserva ceros a la derecha** en las lecturas de catálogo y precios (`'0.08'`, no `'0.080000000000'`), a diferencia del libro, que sale a escala `ALMACENAMIENTO`. Es la convención existente de cada módulo; la aserción se ajustó.

**Fase 3, etapa 1:**

- **`/olvido` devolvía 500 con el log en silencio**: `$queryRaw` sobre una función `RETURNS void` falla en el motor de Prisma («Failed to deserialize column of type 'void'»), y el `ErrorFilter` lo convierte en `INTERNAL_ERROR` sin sacar el mensaje. Se reprodujo con una sonda de tres líneas contra la base y se resolvió pidiendo `::text AS hecho` con esquema zod de tupla. No se registra como incidencia: el diagnóstico costó una sonda y el mensaje del motor decía exactamente qué pasaba; queda dicho en el comentario del esquema por si vuelve a hacer falta una definer `void`.
- **jscpd marcó `CUERPO_DE_RESTABLECIMIENTO` como clon de `CUERPO_DE_ACTIVACION`** (mismo `z.object` de dos campos). Se reutilizó el esquema con el porqué escrito.
- **`rol-despachador.mjs` era un clon de `rol-backoffice.mjs`** salvo el nombre y el `CREATE ROLE`: se extrajo `scripts/lib/rol-de-base.mjs` y los dos scripts quedaron en veinte líneas cada uno. `npm run rol:backoffice` se volvió a ejecutar para confirmar que el camino idempotente («ya existe, no se toca su contraseña») sigue igual.
- **Dos fallos de la propia suite nueva**, no del código: la vida del token se comparaba contra un instante tomado antes de la petición (milisegundos de más) —ahora tolerancia de 10 s—, y el caso «caducado» intentaba mover solo `expires_at` al pasado, cosa que el `CHECK` `expires_at > created_at` impide con razón: se mueve la fila entera dos horas atrás.
- **`costeo-api` levantado durante la suite** (INC-016): se detuvo el contenedor antes de correr integración y se volvió a levantar al terminar.
- **Revisión adversarial de la etapa «Correo base» — cinco hallazgos de severidad media, los cinco atendidos** (detalle en «Qué se construyó»). (1) `email_outbox.datos` legible por `costeo_app` y `costeo_backoffice` — `SELECT` por columnas sin `datos`, con prueba para los dos roles. (2) «Trabajo equivalente» prometido y no medido en `/olvido` — se reconoce el residuo de dos `INSERT`, se documenta y se mide con una prueba de medianas. (3) Tres 🔴 ausentes — atomicidad en la dirección «sin outbox no hay invitado», token ausente de `audit_log`, y `UPDATE`/`DELETE`/`INSERT` prohibidos a la app. (4) `ci.yml` sin `COSTEO_BACKOFFICE_PASSWORD` ni `BACKOFFICE_DATABASE_URL` **desde P11**, y ahora sin las dos del despachador: CI no podía ni levantar `docker compose up -d db pgbouncer` (`:?falta`) desde ese paquete; corregido con credenciales desechables. (5) El aviso de bloqueo salía por `MailerPort` desde la API mientras la documentación decía «la API solo encola» — ahora se encola (`BLOQUEO`).
- **El revisor verificó «a mano con SQL» que el token no está en `audit_log`… con la dueña**, que no tiene política de `SELECT` sobre esa tabla y ve 0 filas siempre. La prueba nueva lee con `costeo_backoffice` y comprueba primero que sí ve los eventos recién escritos (INC-007, caso nuevo: un lector sin política es un verde falso).
- **Dos checks pararon la primera versión de las pruebas nuevas, y los dos tenían razón:** `cadena-privilegiada-solo-en-backoffice` (leer `BACKOFFICE_DATABASE_URL` en `correo-transaccional.spec.ts`) y `sin-set-local-a-mano` (un `set_config` como control positivo). Se movieron las dos aserciones del back office a `backoffice-correo.spec.ts` y el control positivo dejó de fijar tenant. La reproducción del revisor usaba `app.current_company`; el ajuste real es `app.company_id` (`tenant-transaction.ts`), lo que no cambia el fondo del hallazgo.
- **`audit:lint` paró un `${number}` en el helper `unicoAviso` del spec de login** (`restrict-template-expressions`): `String(...)`.
- **Un heredoc de bash con cuatro archivos falló al parsear en este entorno** sin escribir nada; se escribieron con la herramienta de archivos. Sin efecto en el repositorio.

**Fase 3, etapa 2:**

- **`DespachadorConnection` como espejo literal de `BackofficeConnection` era un clon** (pool, `run`, `onModuleDestroy`: quince líneas idénticas que jscpd habría parado). Se extrajo `ConexionConRolPropio` en `persistence/` y los dos la extienden; `BackofficeConnection` conserva su verificación de rol y su cabecera. Lo mismo con el esquema de entorno del despachador frente a `environment.ts`: la comprobación del rol en el campo y el validador que no repite valores pasaron a ser una fábrica y una función exportadas, en vez de copiarse.
- **`audit:lint` paró quince avisos en la primera pasada**, todos de forma: dobles `async` sin `await` en los specs (ahora devuelven `Promise.resolve`/`reject`), los números de la escalera de espera y de la reserva sin nombre (`ESPERA_TRAS_EL_PRIMER_FALLO`…, `MINUTOS_DE_RESERVA`), un genérico redundante en `validarEntorno`, y `String(entrada)`/`String(body)` sobre tipos que pueden no ser cadena en el `fetch` falso (helpers `urlDe` y `cuerpoDe`).
- **`expect.toSatisfy` no existe como comparador asimétrico en vitest**: la aserción de forma de `/correo/salud` se escribió comprobando claves y tipos uno a uno.
- **La base local acumulaba 92 correos `PENDIENTE` de las suites anteriores** (INC-014): con `failNext(1)`, el fallo armado habría golpeado un residuo y no el correo de la prueba. La suite vacía la cola con pasadas de lote 500 antes de medir; el residuo queda `ENVIADO` (por el `FakeMailer`) con `datos` saneado, que es menos token en claro en la base de desarrollo, no más.
- **Con `MAIL_ADAPTER=fake` en el `.env` local, el servicio `correo` de compose no habría arrancado** (producción rechaza `fake`, y el contenedor corre con `NODE_ENV=production` también en el modo local de compose). Se cambió el valor de desarrollo a `consola` en `.env.example` y en el `.env` local, tras comprobar que ninguna prueba dependía de que la API montara el falso.
- **`audit:secrets` paró las dos cadenas de conexión de ejemplo del spec del esquema del despachador** (la URL de conexión completa con `costeo_despachador` y una contraseña literal): la contraseña pasó a una constante interpolada, como ya hacía `environment.spec.ts`, y de paso la aserción «el mensaje no repite la contraseña» busca esa constante y no la palabra `clave`.
- **`costeo-api` levantado durante la suite** (INC-016): se detuvo el contenedor antes de correr integración y se volvió a levantar al terminar.
- **Revisión adversarial de la etapa «Despachador» — cuatro hallazgos (una alta, tres medias), los cuatro atendidos.** (1, alta) **El cierre ordenado no ocurría.** `contexto.enableShutdownHooks()` registraba el `cleanup` de Nest antes que el `process.once` propio: al llegar `SIGTERM`, Nest ejecutaba `onModuleDestroy` (el `$disconnect()` del pool, con la pasada a medias) y después `process.kill(process.pid, señal)` sin ningún receptor —confirmado en `@nestjs/core/nest-application-context.js`, `listenToShutdownSignals`—: el proceso moría en el acto sin volver al bucle, y un correo ya aceptado por Resend quedaba `PENDIENTE` para reenviarse a los cinco minutos, justo en el caso rutinario de un redespliegue. Se quitó la llamada; la señal solo hace `bucle.detener()`, `BucleDePasadas.correr()` resuelve con la pasada terminada y solo entonces `contexto.close()` cierra el pool y `process.exitCode = 0`. Reproducción del revisor ejecutada antes y después (evidencia en «Pruebas»), unitaria del bucle a media pasada, y la incidencia convertida en regla de `audit:forbidden` (`despachador-sin-ganchos-de-nest`, §8.4). Cabecera del binario, este archivo y `configuracion.md` corregidos para que digan la verdad. (2, media) **`enviar` y `marcarEnviado` compartían `try`**: un fallo de la marca tras un `2xx` del proveedor pasaba por `marcarFallo` (fila `PENDIENTE`, `intentos + 1`, error de base en la columna, reenvío al minuto). Ahora `intentarEnvio` captura solo el envío y devuelve el mensaje o `null`; un fallo al marcar sube sin tocar la fila, que queda con su reserva: la única ventana de doble envío que queda son los milisegundos entre el `2xx` y el `UPDATE`, y está dicha en la cabecera y en `configuracion.md` (para ADR-025). Unitaria nueva. (3, media) **La reserva de cinco minutos cubría «el lote entero» solo con lote ≤ 30**: con `CORREO_LOTE` hasta 500 y envíos en serie, las filas del final la perdían y otra instancia las enviaba también. Se optó por **renovar la reserva fila a fila** (`renovarReserva(correo, ahora)`, quinta operación del puerto, `UPDATE … WHERE id AND estado = 'PENDIENTE' AND siguiente_intento_en = <firma de la pasada>`; 0 filas → se cede) y no por atar `LOTE_MAXIMO` a la reserva, porque la renovación no depende de ninguna aritmética de tiempos: la reserva solo tiene que cubrir un envío y su marca. `CorreoPendiente.reservadoHasta` es la firma; `ResumenDePasada` gana `cedidos`. Comentario de la constante corregido; unitarias e integración nuevas. (4, media) **`desplegar.sh` no creaba los roles que `roles.sql` ya no crea**: en el VPS de P14b el cluster existe, `roles.sql` no vuelve a correr y la migración de este paquete habría abortado el paso de migraciones con «Falta el rol costeo_despachador». Paso **5/8** nuevo con `npm run rol:backoffice && npm run rol:despachador` (idempotentes), renumeración a ocho pasos, runbook `despliegue.md` (porqué, y la fila en «Solución de problemas conocidos»). Al probar el camino se vio que `rol-de-base.mjs` cargaba `RAIZ/.env` sin comprobar que exista —en el VPS no existe, `ENOENT` en el primer despliegue—; `entorno.mjs` ya lo carga con guarda, así que se quitó la copia. «`desplegar.sh` y `preparar.sh` al día» vuelve a ser cierto.

**Fase 3, etapa 3:**

- **`ip::text` de un `INET` escrito por Prisma sale con `/32`** (`127.0.0.1/32`): las tres aserciones sobre `login_attempt.ip` y `audit_log.ip` fallaron a la primera. Se lee con `host(ip)`. No es incidencia: el mensaje lo decía.
- **`IncomingHttpHeaders` no es asignable a un tipo con una sola propiedad opcional** («has no properties in common», detección de tipo débil): `PeticionConOrigen.headers` pasó a `Readonly<Record<string, string | string[] | undefined>>`, y `audit:lint` pidió `Record` en vez de firma de índice.
- **Un heredoc de bash con comillas simples dentro volvió a fallar al parsear en este entorno** (el mismo síntoma que anotó la etapa 1): los parches se escribieron como scripts de Python en el scratchpad y se ejecutaron por ruta. Sin efecto en el repositorio.
- **`audit:secrets` paró una línea de este documento escrita en la etapa 2** (una URL de conexión de ejemplo en «Problemas»): se reescribió en palabras. Es la misma regla que esa línea contaba haber aplicado al spec.
- **El límite de tasa hacía fallar a las suites existentes por diseño**: `correo-transaccional` pide el restablecimiento del mismo correo treinta veces para medir el canal de tiempo, y tres por hora es el límite real. Se resolvió en las pruebas, no relajando la regla ni añadiendo un interruptor de configuración: vaciar `rate_limit_hit` con la dueña en `beforeAll`/`beforeEach` y dentro del helper de medida, que es el precedente exacto de `DELETE FROM login_attempt`.
- **`costeo-api` levantado durante la suite** (INC-016): se detuvo el contenedor antes de correr integración y se volvió a levantar al terminar.
- **Revisión adversarial de la etapa «Límite e IP» — cuatro hallazgos (una crítica, tres medias), los cuatro atendidos** (detalle en «Qué se construyó»). (1, crítica) **El límite no limitaba bajo concurrencia**: leer-luego-escribir en transacciones separadas dejaba pasar todas las peticiones simultáneas de la misma clave; se reprodujo con la 🔴 nueva antes de tocar nada (30 de 30 y 12 de 12 aceptadas) y se corrigió haciendo de contar y anotar una sola transacción por clave con `pg_advisory_xact_lock`. Las 🔴 anteriores estaban escritas en serie (`estadosDe` con `await` uno a uno) y por eso pasaban sin medir la carrera: el caso INC-007 de esta etapa. (2) `findMany` sin `take` cargaba todos los golpes de la hora de una clave que insiste; tope `golpesQueDeciden`. (3) Un evento de `audit_log` por cada 429; ahora en la transición, como el aviso del login. (4) `PROXY_DE_CONFIANZA=172.28.0.0/24` confiaba en la pasarela y en los demás contenedores; IP fija de Caddy. **No se registra incidencia nueva**: el fallo (1) queda en INC-022 como corrección y en ADR-026 como principio (un límite de leer-luego-escribir no es un límite), y su prevención es la 🔴 en paralelo, que es la clase de prueba que falta cada vez que se escribe un contador.
- **Una unitaria nueva estaba mal escrita, no el código**: `[4, 5, 6, 7]` como «rechazos de la misma ronda» con umbral 3 incluye el 6, que es la escalada y lo que la prueba siguiente afirma. Se corrigió la lista.
- **`docker compose … config` con `--env-file .env` no arranca en esta máquina**: el `.env` local no tiene `APP_URL`, `MAIL_ADAPTER`, `DOMINIO` ni `CORREO_TLS` (son del VPS). Se ejecutó con valores de relleno en el entorno del comando, que ganan al archivo; el resultado que importa es la red y `caddy`, no esos valores.
- **`EXPLAIN ANALYZE` sobre `rate_limit_hit` vacía daba `Seq Scan`** (las suites la vacían al terminar): la medida se hizo con 38.000 filas sembradas dentro de una transacción con `ROLLBACK`, para no dejar residuo (INC-014).

**Cierre (documentación):**

- **Tres documentos decían algo que el código ya no hacía**, y se corrigieron al escribir encima: `modelo-datos.md` («P16-A1: ninguna tabla nueva», escrito en la Fase 1 antes de que existieran tres), `configuracion.md` («`costeo_backoffice` no existe todavía», desde P11) y la fila de INC-022 en el índice de incidencias, que sigue diciendo «`PROXY_DE_CONFIANZA` con la subred fija» —cierto, pero la lista lleva la IP de Caddy; la ficha lo explica y la fila no se tocó porque el índice no es mío—. Es el caso H13 de `AUDITORIA.md`: describir lo planeado en vez de lo construido dura exactamente hasta que alguien lo lee contra el árbol.
- **El índice de ADR salta del 012 al 024**: los ADR-013…019 existen en la carpeta y no tienen fila. No es de este paquete y no se tocó; se anota para quien cierre P16-A2.
- **`EXPLAIN ANALYZE` de `tomarPendientes` sobre la base de desarrollo real habría sido sobre 474 correos**, casi todos `ENVIADO`: sin siembra, cualquier plan es bueno. Se sembraron 60.000 dentro de la transacción con `ROLLBACK`, como con `rate_limit_hit`.
- **No hay `psql` en el PATH** (INC-002): los `EXPLAIN` se corrieron con un script de Node sobre el `pg` de `node_modules`, en el scratchpad, con la cadena de la dueña leída del `.env`.

## `npm run bench` — el paso que faltaba, y lo que encontró

**AUDITORIA.md I8 lo exige en todo paquete que toque el camino de lectura de `costing`, `analytics`,
`inventory` o `pricing`.** Este lo toca: `cadena-de-costo.ts` —que costea la carta entera— pasó a
delegar el neteo en `shared/domain/iva/neteo.ts`. Ejecutarlo destapó dos cosas, y ninguna estaba en
el plan.

**1. El bench llevaba dos paquetes sin poder arrancar.** `scripts/lib/volumen.sql` insertaba
`company.max_locations`, la columna que P11 borró al mover el límite a la tabla `plan` (D5). Ningún
check lo veía: no es TypeScript, no es una migración, y la regla de INC-017 solo comprueba que
`scripts/bench.mjs` exista. Es la **primera recurrencia de INC-017**, anotada en su ficha. Arreglado
con `plan_code = 'PROFESIONAL'`, que es el que refleja el `max_locations = 20` que la línea borrada
declaraba. Con `BASICO` (10 / 500 / 300) el volumen que el archivo siembra —10 ubicaciones, 500 ítems
y 200 productos en la company medida— entraría **exactamente en el límite** de ubicaciones y de ítems:
el bench mediría una company que no puede crecer ni una fila, y el primer ítem que alguien añadiera al
volumen la rompería con un error de plan en vez de una medición. `PROFESIONAL` (25 / 2.000 / 1.000)
deja el margen que la línea original tenía.

**2. El informe de consultas pisaba la evidencia de P15.** `RUTA_INFORME` estaba clavado en
`docs/pasos/P15/`, así que la primera corrida sobrescribió un documento de auditoría ya commiteado.
Ahora es `npm run bench -- --informe=<carpeta>`; sin la bandera no escribe ningún archivo. El de este
paquete está en `docs/pasos/P16-A1/CONSULTAS-MAS-CARAS.md` y el de P15 quedó restaurado.

**3. El consolidado no cabe en su presupuesto en esta máquina: 940,9 ms de 800.** Los otros tres
presupuestos, en verde. **No es regresión de P16-A1** —mismas consultas, mismos recuentos de llamada,
y normalizado al suelo del entorno cuesta 143,7 «suelos» frente a los 149,6 de P15— pero **el check
tiene razón y no se sube el umbral**. Es la deuda técnica #2 de `ESTADO.md` (vistas materializadas,
ADR-012 §7) llegando a su condición de pago, y es **decisión del usuario**. La tabla con las tres
corridas y el razonamiento completo están en `AUDITORIA-RESULTADO.md`.

**4. Y una que sale de mirar `ci.yml` al lado:** el smoke test usaba `docker compose up -d --build api`,
que es exactamente lo que INC-018 prohibió después de costar dos días. En CI no hay contenedor
anterior que se quede en pie, así que el riesgo era menor, pero la regla es la regla: ahora
`docker compose build api` va en su propio paso.

## Deuda y pendientes

- **El consolidado de diez ubicaciones incumple su presupuesto de 800 ms en esta máquina (940,9 ms).** No es de este paquete —relativo al suelo del entorno está igual que en P15— y su arreglo está diseñado desde P9 (vistas materializadas, ADR-012 §7, deuda #2 de `ESTADO.md`). **Decisión del usuario.** Y algo que conviene saber: **`npm run bench` no lo ejecuta CI**, así que ese presupuesto no lo vigila nadie automáticamente.
- `company_settings.iva_compra` sin uso desde este paquete; se retira en P16-B con `ajustes` (D-16.43).
- El envío real manual (DKIM/SPF/DMARC en Resend) depende del usuario; la evidencia va en este archivo cuando exista.
- **D-16.51 (preparación con IVA 0) pendiente de ratificación del usuario** antes del commit del paquete; si la rechaza, se revierte `pricing/domain/preparacion.ts` y sus dos llamadas y se restaura la prueba anterior.
- **Re-importación de los datos de ejemplo (D-16.18):** no ejecutable desde el repositorio (sin CSV versionado; el libro es append-only). Es un paso del runbook para el piloto (`puesta-en-marcha.md`, Paso 7) y la revisión de la semilla 0.15 de sus artículos por `PUT`.
- **El SQL a mano puede escribir una `COMPRA` sin desglose** (siembras, scripts): la guarda es de aplicación (ADR-024, decisión 4). Si P16-C o el back office escriben compras por una ruta que no pase por `comoFila`, hay que decidir el trigger.
- **Todo lo que la etapa 2 dejó «pendiente para las siguientes» está hecho** (el límite de tasa con la IP real, ADR-025, ADR-026, `SEGURIDAD.md`/`seguridad.md`, `modelo-datos.md`, los runbooks, `ESTADO.md`). Lo único de esa lista que se deja a propósito: **el comentario de la migración de P1 sigue diciendo «exactamente TRES» funciones definer**. Una migración aplicada es inmutable; la verdad de hoy —cinco, dos que escriben— está en la migración de P16-A1, en `modelo-datos.md`, en `seguridad.md` y en ADR-025.
- **El envío real por Resend no se ha ejercitado**: el adaptador está probado contra un `fetch` falso (2xx, 5xx, timeout) y la cuenta depende del usuario; la evidencia va aquí cuando exista.
- **La imagen de producción con el servicio `correo` no se ha construido en esta etapa** (`docker compose config` sí valida los dos archivos, y `dist/despachador.js` se compila con `npm run build`); el ensayo completo de despliegue es el que lo confirma, como pasó en P14b.
- **`ci.yml` no se ejecutaba de verdad desde P11** (faltaban las variables del back office; ahora están las cuatro). No hay evidencia de una corrida verde en GitHub desde entonces: la primera corrida tras el commit de este paquete es la que lo confirma, y si falla por otra variable que falte, es deuda de P11, no de P16-A1.
- **El despachador renderiza `BLOQUEO`** (hecho en la etapa 2: `contenidoDe` devuelve `{plantilla: 'BLOQUEO', datos: {}}` y el saneado lo trata como a cualquier otro). Se deja la línea para que conste que la deuda de la etapa 1 se cobró.

- **`AccesoBloqueadoError` (el login) no trae `Retry-After`**: el filtro ya lo emitiría si el error llevara `reintentarEnSegundos`; añadirlo es una línea en `iam/domain/errores.ts` y una prueba, y cambia un contrato de P1. Registrado en ADR-026, decisión 7, como deuda dicha.
- **`docs/SEGURIDAD.md` §2.1 y ADR-026 ya recogen** los cuatro límites, la exención de ámbito, el contar-y-anotar bajo `pg_advisory_xact_lock` con sus alternativas, la auditoría de transición con el tope de lectura, y la IP fija de Caddy con el riesgo residual. Lo que el estándar sigue pidiendo y no está: CAPTCHA a partir del tercer fallo y la «recuperación de cuenta que escala a revisión manual» (dicho ahí mismo).
- **La purga de `rate_limit_hit` es un `Seq Scan`** (no hay índice que empiece por `at`; el compuesto empieza por `kind`). Con un día de golpes como mucho —4 ms sobre 38.000 filas en el `EXPLAIN` del cierre— es aceptable y corre cada cinco segundos; si aparece en `pg_stat_statements`, el arreglo es un índice sobre `(at)` con esta consulta delante. `tomarPendientes` hace un `sort` de todas las `PENDIENTE` por la misma razón (el `OR` sobre `siguiente_intento_en`): lineal en las pendientes, que en una cola sana son decenas.
- **El índice de `docs/decisiones/README.md` no tiene filas para ADR-013…019** (existen en la carpeta). Deuda heredada; no es de este paquete.
- **El ensayo completo de despliegue con la subred fija no se ha hecho en esta etapa**: `docker compose config` valida los dos archivos, pero la red `costeo-saas_default` de la máquina local ya existía con otra subred y cambiarla exige `down` + `up` de toda la pila, que es justamente lo que el runbook explica y que conviene hacer en el ensayo de cierre (INC-018/019/020 salieron de ahí). Hasta entonces, la comprobación de que Caddy cae dentro de `172.28.0.0/24` es `docker network inspect costeo-saas_default`.
- **El contador del limitador global sigue en memoria del proceso** y `rate_limit_hit` en PostgreSQL: dos almacenes distintos para dos mecanismos distintos, ya dicho en `app.module.ts`. Con una réplica es exacto.

## Cómo probar manualmente lo construido

**Fase 1** (con sesión de ADMIN y un ítem `COMPRADO` sin grupo):

1. `POST /catalogo/articulos` **sin** `ivaTarifa` → 400. Con `"ivaTarifa": "0.15"` → 201.
2. `POST /inventario/movimientos` `{ tipo: "COMPRA", cantidad: "10", costoTotal: "115.00", purchaseArticleId: <el artículo>, ivaTarifa: null, … }` → 201; en la base: `total_cost = 100`, `total_bruto = 115`, `iva_tarifa_aplicada = 0.15`, `iva_recuperable_aplicado = true`, `desglose_conocido = true`. `GET /inventario/movimientos?locationId=…` lo enseña con `"desglose": "CONOCIDO"`.
3. La misma compra **sin** `purchaseArticleId` → 400 «No hay tarifa de IVA para esta compra…». Crea un grupo con tarifa (`POST /catalogo/grupos { nombre, ivaTarifa: "0.15" }`), asigna el ítem al grupo (`PUT /catalogo/items/:id`) y repite → 201.
4. `PUT /catalogo/articulos/:id` con `ivaTarifa: "0"`; la siguiente compra queda con `total_cost = total_bruto`.
5. `PUT /ajustes` con `ivaCompraRecuperable: false`; una compra nueva guarda `total_cost = 115` y `iva_recuperable_aplicado = false`; las anteriores no cambian.
6. `POST /inventario/movimientos/:id/correccion` sobre una compra con desglose → la fila nueva lleva los cuatro importes.
7. `npm run importar -- --tipo MOVIMIENTOS` con una columna `iva` vacía en un ítem sin grupo → la fila se rechaza con su número.

**Fase 3 — correo y restablecimiento** (con `MAIL_ADAPTER=consola` en el `.env`, `npm run dev` en una terminal y `npm run correo:despachar` en otra):

1. `POST /usuarios { email }` con sesión de ADMIN → 202. En la terminal del despachador, en menos de cinco segundos: `[correo] para: …`, el asunto y el cuerpo con `http://localhost:3001/activacion?token=…`. En la base (dueña): `SELECT estado, intentos, datos FROM email_outbox ORDER BY created_at DESC LIMIT 1` → `ENVIADO`, `1`, `{"plantilla": "INVITACION", "destinatario": "…"}` — el token ya no está.
2. Para el despachador (`Ctrl+C`) y repite la invitación a otro correo: la fila queda `PENDIENTE` con `datos.enlace` y el token en claro; `SELECT datos FROM email_outbox` **con `costeo_app`** (`DATABASE_URL`) → `permission denied for table email_outbox`. Arranca el despachador: la fila sale y se sanea.
3. `POST /usuarios/:id/reenvio-de-invitacion` → 202 y una segunda fila; el enlace de la primera ya no activa (401).
4. `POST /auth/password/olvido { email }` **sin cookie** con un correo activo → `202 {}`; en la base, una fila en `password_reset_token` con `used_at` nulo y `expires_at` a una hora, y el correo `RESTABLECIMIENTO` con el `company_id` del usuario. Con un correo inventado → el mismo `202 {}` y ninguna fila.
5. Abre el enlace `…/restablecer?token=…` que imprimió el despachador y `POST /auth/password/restablecimiento { token, contrasena }` → 204; la sesión que tuvieras abierta cae (401 en `GET /ubicaciones`); el mismo token otra vez → 400 `ENTRADA_INVALIDA`.
6. `POST /auth/password/olvido` cuatro veces seguidas al mismo correo → la cuarta es 429 `LIMITE_DE_SOLICITUDES` con `Retry-After` y «Vuelve a intentarlo en 60 minutos.»; con `PROXY_DE_CONFIANZA=` vacía, una cabecera `X-Forwarded-For: 203.0.113.9` no cambia nada (sigue contando el socket). Con `PROXY_DE_CONFIANZA=127.0.0.1` y la API reiniciada, cada `X-Forwarded-For` distinta tiene sus propios diez.
7. Back office (`npm run backoffice`, sesión de operador): `GET /correo/salud` → `{pendientesAntiguos, fallidos, ultimoEnvio}`; la tarjeta «Cola de correo» al principio de *Cartera*.
8. Con `MAIL_ADAPTER=resend` y `RESEND_API_KEY` vacía, `npm run correo:despachar` **no arranca**: `MAIL_ADAPTER=resend exige RESEND_API_KEY, y no esta`.

## Incidencias registradas en este paquete

| Incidencia | Síntoma | ¿Se automatizó la prevención? |
|---|---|---|
| INC-022 | Detrás del proxy toda petición llega con la IP de Caddy: el bloqueo por IP del login bloquearía a todos a la vez | ✅ prueba de la cabecera falseada y del par confiable |
| **INC-017, recurrencia 1** | `npm run bench` muere con `column "max_locations" of relation "company" does not exist`: el SQL suelto de un script se quedó con una columna que una migración había borrado dos paquetes antes | ⚠️ no automatizable con lo que hay (ninguna herramienta verifica el SQL suelto); la prevención es **ejecutar el bench**, que es lo que I8 ya pedía |
