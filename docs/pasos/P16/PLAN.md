# P16 → P20 — La aplicación completa, en una pasada

> Plan de ejecución en modo autónomo. Sustituye al plan del sprint (Fases A–D), que está cerrado.
> **Versión 6** (2026-09-09): incorpora D-16.9…D-16.38, las Fases 0–4, los añadidos a P16-A1 y el
> criterio de la parada «entrega al piloto». **P16-A1 no empieza hasta que la Fase 0 esté en
> `ESTADO.md`.**

---

## Contexto

El backend está completo (36 escrituras, 3 barreras, 585 + 313 pruebas) y desplegado en local con
marca. **Pero la interfaz solo usa 5 de las 41 rutas, y solo dos escriben.** Un dueño de restaurante
no puede dar de alta un insumo, escribir una receta, subir un precio ni registrar la compra de hoy.
**No es un producto que se le entregue a un restaurante.** Es un motor con un visor encima.

El usuario decidió: que quede **como Noctis Commerce** y **con lo que trae `docs/Sistema ejemplo`**,
en una pasada; los bloques sin backend se **especifican** todos y se **construye** solo la
importación; entrega al piloto tras las pantallas operativas, con cinco evidencias.

---

## Decisiones cerradas por el usuario (no se reabren)

| # | Decisión | Consecuencia |
|---|---|---|
| U1 | Shell **como Commerce**: barra lateral por grupos, sección por entidad, listado → alta → ficha → edición en **página propia**, `← Volver`, confirmación en línea | Route group `(app)`, `navegacion.ts`, gating por permiso, `typedRoutes` |
| U2 | **Inicio** con el resumen del mes | `/inicio`; BODEGA ve `/analitica/reposicion` |
| U3 | Los cuatro bloques sin backend tienen **SPEC escrito y presentado**; solo se **construye P20** | P17, P18, P19 diferidos por decisión de producto |
| U4 | **Token CSRF completo** (SEGURIDAD.md §4.2) | P16-A2, ADR-021 |
| U5 → **D-16.9** | El bodeguero escribe **el total de la factura con IVA**. Dos niveles: tarifa por artículo, recuperabilidad por company. **Neteo solo si `iva_compra_recuperable = true`; si es `false`, el IVA entra íntegro al plato** | Fase 1 |
| **D-16.10** | Todo `COMPRA` persiste `total_bruto`, `iva_tarifa_aplicada`, `iva_recuperable_aplicado`, `costo_total_neto` | Fase 1 |
| **D-16.11** | Reemplazos totales con **concurrencia optimista**: 409 `CONFLICTO_DE_VERSION` | Fase 2, ADR-023 |
| **D-16.12** | **Correo transaccional** es alcance mínimo: invitación y recuperación | Fase 3 |
| **D-16.15** | El despachador **no** usa el rol de la app ni bypass; ADR-025; 🔴 dos companies → envía los dos | D-16.23 |
| **D-16.16** | Proveedor único: **Resend**. Adaptadores `fake`, `consola`, `resend`; `RESEND_API_KEY`, `RESEND_REMITENTE` | Fase 3 |
| **D-16.17** | Límite de tasa **por IP y por destinatario** en `olvido`, `restablecimiento`, `POST /usuarios`, `reenvio-de-invitacion`; 429 con código propio; 🔴 por endpoint. **La IP se obtiene por el mismo camino que `login_attempt` (proxy de confianza), nunca leyendo `X-Forwarded-For` directamente; 🔴 cabecera falseada desde fuera del proxy no cambia la clave de límite** | D-16.24, D-16.36 |
| **D-16.18** | Los `COMPRA` anteriores **no** se rellenan; «sin desglose» como estado; datos de ejemplo re-importados | D-16.25 |
| **D-16.19** | `email_outbox.company_id` nullable; índices por estado en outbox y tokens | Fase 3 |
| **D-16.20** | ADR-023: deuda del 409 espurio entre sucursales por `product.version`; señal: primer conflicto sin usuario concurrente → versión por `(product, location)` | Fase 2 |
| **D-16.21** | P20 **en memoria, sin reanudar, sin antivirus, solo CSV**, con tope de `Content-Length` y de filas | P20 |
| **D-16.22** | `verificar-pantalla.mjs` **no** se construye | Verificación |
| **D-16.26** | Los endpoints públicos de restablecimiento **no operan bajo tenant**: dos funciones `SECURITY DEFINER` (patrón de `session_lookup` e `invitation_lookup`): una busca el usuario activo por correo, crea `password_reset_token` y encola en `email_outbox` **en una sola operación** (sin usuario → no hace nada y devuelve lo mismo); otra consume el token (un uso, caducidad) y devuelve `user_id`. 🔴 `/olvido` sin sesión encola; `/restablecimiento` sin sesión consume | D-16.31 |
| **D-16.27** | Observabilidad: (a) `restart: unless-stopped` en el despachador; (b) `GET /usuarios` incluye `correoInvitacion: {estado: 'PENDIENTE'\|'ENVIADO'\|'FALLIDO', error?}` y la pantalla 32 ofrece «Reenviar» si `FALLIDO`; (c) salud «`PENDIENTE` con más de N minutos» en el **back office** | Fase 3, P16-C, pantalla 32 |
| **D-16.28** | `rate_limit_hit` fuera del ámbito de tenant, exención registrada en la doc de seguridad; purga en cada pasada del despachador; 🔴 la tabla no crece tras la ventana | D-16.32 |
| **D-16.29** | `import_job` persiste el **SHA-256**; la confirmación lo recalcula → 409 `ARCHIVO_DISTINTO`. En SPEC §24 | D-16.33 |
| **D-16.30** | Evidencia 1 del piloto: el respaldo se **copia fuera del VPS** (destino nombrado en el runbook) y la restauración probada **parte de la copia remota** | Parada |
| **D-16.34** | **El token en claro existe en la base solo mientras el correo está en vuelo:** al marcar `ENVIADO`, o `FALLIDO` tras el tope, el despachador reemplaza `email_outbox.datos` por `{plantilla, destinatario}` sin enlace. Ninguna lectura del outbox (`GET /correo/salud`, `GET /usuarios.correoInvitacion`) expone `datos`. `HORAS_DE_RESTABLECIMIENTO` con valor por defecto **1**. ADR-025 registra la alternativa descartada (cifrado del campo con clave del despachador) y su señal: más de un operador con acceso a la base. 🔴 tras `ENVIADO`, `datos` no contiene `token=`; 🔴 la respuesta cruda de `/correo/salud` no contiene `datos` | Fase 3 |
| **D-16.35** | Evidencia 1: el dump se **cifra en el VPS antes de subirse** (herramienta y gestión de la clave nombradas en `respaldos-y-restauracion.md`; **la clave no vive en el mismo destino que el respaldo**) y la restauración probada incluye el **descifrado desde la copia remota** | D-16.37 |
| **D-16.38** | (adición a D-16.37) La clave privada de `age` tiene **al menos dos copias en lugares independientes entre sí** (gestor de contraseñas + copia física, o segundo gestor sin credenciales compartidas), registradas en `respaldos-y-restauracion.md` **sin revelar dónde**. La evidencia 1 descifra con **una copia distinta del equipo donde se generó el par**, y lo dice en la evidencia | Parada |
| U6 | Entran las cuatro opcionales (simulador, desglose, costo de uso, editar sucursal) | P16-B/C; bench |
| U7 | Tipti fuera (D8); back office fuera de `apps/web` | |
| U8 | Parada **«entrega al piloto»** con cinco evidencias; P20 después de las operativas | Secuencia |

Decisiones mías, registradas en `ESTADO.md` en la Fase 0:

- **D-16.1** La rejilla de ventas manda todas las filas con valor, con la `version` leída. Desviación consciente de la letra de §10.
- **D-16.2** «Mes sin abrir» = `code === 'PERIODO_SIN_DATOS'`. **D-16.3** `GET /costeo` gana `semaforoFoodCost`; nada se decide en el cliente. **D-16.4** Fechas por `lib/fechas.ts` (`12:00Z`); mes por defecto en `America/Guayaquil`. **D-16.5** El mes vive en la URL. **D-16.6** Sin permiso = en sitio; fail-closed. **D-16.7** No hay `/empaques`. **D-16.8** Paquetes de API antes de cualquier pantalla.
- **D-16.13** Concurrencia con **columna `version` entera** en `period`, `product`, `item` (ninguna tabla tiene `updated_at`).
- **D-16.14** El correo **extiende** `MailerPort` como transporte.
- **D-16.23** (D-16.15) Rol **`costeo_despachador`** (`NOBYPASSRLS`, `CONNECTION LIMIT 2`), `GRANT SELECT, UPDATE ON email_outbox` y `DELETE ON rate_limit_hit`, nada más; política `USING (true) WITH CHECK (true)` solo sobre esas dos tablas; **proceso aparte** (`apps/api/src/despachador.ts`, servicio `correo`, `restart: unless-stopped`); `npm run correo:despachar`. Descartada la (b). Reglas de `audit:forbidden`/`dependency-cruiser` para `DESPACHADOR_DATABASE_URL`.
- **D-16.24** (D-16.17) El login es bloqueo escalonado y se queda; `evaluarIntentos` se reutiliza desde `LimitadorDeTasa` (`shared/application`) con `rate_limit_hit(kind, clave, ip, at)`, 429 **`LIMITE_DE_SOLICITUDES`**.
- **D-16.25** (D-16.18) **`desglose_conocido boolean NOT NULL DEFAULT false`** + CHECK; toda `COMPRA` nueva nace `true` (🔴).
- **D-16.31** (D-16.26) **`password_reset_request(p_email, p_token_hash, p_datos jsonb) RETURNS void`** y **`password_reset_consume(p_token_hash) RETURNS TABLE(user_id uuid)`**, definer con `REVOKE ALL FROM PUBLIC` / `GRANT EXECUTE TO costeo_app`, llamadas por `$queryRaw` como `auth_lookup`/`session_lookup`/`invitation_lookup`; el token en claro lo genera Node (`tokens.generar()`), a la base llega el hash y, en `p_datos`, el enlace para el correo; sin usuario, no hace nada con el mismo retorno y coste. Son las dos únicas definer **que escriben**, discutidas en su migración. `password_reset_token` **sin política para `costeo_app`** (deny-by-default).
- **D-16.32** (D-16.28) La lista de exenciones de M6 **sigue vacía**: `rate_limit_hit` nace con `ENABLE` + `FORCE` y política **permisiva** para `costeo_app` — fuera del ámbito de tenant, no de la auditoría; exención de ámbito en `docs/SEGURIDAD.md` y `docs/sistema/seguridad.md`. Purga `DELETE … WHERE at < now() − ventana` en cada pasada; 🔴.
- **D-16.33** (D-16.29) `import_job.sha256 text NOT NULL` (64 hex, CHECK); `storage_key` queda para el CLI y vale `''` en la UI, dicho en el SPEC.
- **D-16.36** (adición a D-16.24) **Hoy la API toma la IP del socket** (`auth.controller.ts:91`, `backoffice.controller.ts:345`, dos copias) y su propio comentario deja «`trust proxy`» para «cuando el despliegue tenga proxy de confianza». Ese despliegue existe desde P14b: **detrás de Caddy toda petición llega con la IP de Caddy**, así que el bloqueo por IP del login (25 fallos/60 min) **bloquearía a todos los usuarios a la vez** y un límite por IP nuevo no mediría nada. Se cierra en P16-A1: `ipDelCliente(peticion)` en `shared/infrastructure/http/` con `PROXY_DE_CONFIANZA` (lista de direcciones o redes del proxy, en el esquema de entorno; en compose, la red interna; en desarrollo, vacío = socket) que toma **el último salto de `X-Forwarded-For` solo cuando el par del socket es de confianza**; `login`, `backoffice` y `LimitadorDeTasa` usan el helper y desaparecen las dos copias. 🔴 par no confiable con `X-Forwarded-For` falseada → clave = IP del socket; 🔴 par confiable → clave = último salto; `Caddyfile` sin cambios (manda `X-Forwarded-For` por defecto). Incidencia nueva: **INC-022** (un bloqueo por IP que en producción sería un bloqueo global).
- **D-16.37** (D-16.35) Herramienta: **`age`** (paquete de Debian 12, `apt-get install age` en `preparar.sh`), cifrado **asimétrico**: la clave **pública** vive en el VPS (`/etc/costeo/respaldo.pub`) y **puede cifrar pero no descifrar**; la clave **privada** vive solo en el gestor de contraseñas del usuario, nunca en el VPS ni en el destino remoto. `respaldo-diario.sh` cifra el dump y cada segmento de WAL (`age -r $(cat /etc/costeo/respaldo.pub) -o X.age X`) y sube **solo** los `.age`; los archivos en claro se borran tras subir. Restauración: `scripts/vps/descifrar-respaldo.sh` (`age -d -i clave.txt`) desde la copia **remota**, y después `npm run restaurar`. Descartado `gpg --symmetric`: la frase viviría en el VPS y podría descifrar allí mismo. Registrado en `respaldos-y-restauracion.md` con la rotación de la clave. La plantilla del `.env` en `preparar.sh` (línea 58–89, hoy sin ninguna de las dos) gana `RESPALDO_CLAVE_PUBLICA=/etc/costeo/respaldo.pub` y `PROXY_DE_CONFIANZA=` (D-16.36), y el paso 1 del cierre del script pide generar la clave (`age-keygen`) **fuera del VPS** y copiar solo la pública.

---

## Secuencia completa

```
Fase 0  Registrar U1–U8 y D-16.1…D-16.38 en ESTADO.md (tablero «Pasada P16»)   ← antes del primer commit
Tooling (1 commit)
P16-A1  API · modelo de IVA + correo transaccional + límite de tasa + IP tras el proxy   (7 fases, 1 commit)
P16-A2  API · shared + sesión + CSRF + lecturas de catálogo + arreglos                   (7 fases, 1 commit)
P16-B   API · pricing + recipes/products + costing + version de product/item             (7 fases, 1 commit, bench)
P16-C   API · inventory + usuarios/roles/sucursales + version de period                  (7 fases, 1 commit)
P16     Frontend · armazón + pantallas 1–27  (+ 28 y 31 si el piloto tiene más de una sucursal)
  ⏸ ENTREGA AL PILOTO — cinco evidencias
  ⏸ SPEC §24 → aprobación → P20 Importación desde la UI
P16     Frontend · pantallas 28–33 (las que falten)
  ⏸ SPEC §22 · §23 · §25/§26: escritos y presentados, NO construidos
```

---

## Fase 0 — Registrar decisiones (primera acción de la ejecución)

`ESTADO.md` gana «Pasada P16»: U1–U8, D-16.1…D-16.38, el tablero (fila por commit: estado, hash,
capturas, KB de bundle, decisiones) y la nota de P17/P18/P19 **diferidos por decisión de producto**,
con sus preguntas abiertas. Entra en el commit de Tooling.

## Tooling (commit 0)

Reglas de `audit:forbidden` para `apps/web/src/**/*.{ts,tsx}` (`no-fecha-a-medianoche`,
`no-number-en-frontend`, `no-tipti`) con guardián · `scripts/medir-bundle.mjs` (200 KB piso / 350 KB
resto) · el glob `.tsx` de `audit:complexity` va en «Armazón».

---

## P16-A1 — API · modelo de IVA (Fase 1) + correo transaccional (Fase 3) + límite de tasa + IP tras el proxy

### Fase 1 — Modelo de IVA (migración reversible, M1–M11)

| Cambio | Detalle |
|---|---|
| `purchase_article.iva_tarifa numeric(24,12) NOT NULL` | **Semilla, no verdad** (`0.15` en los existentes, dicho en `-- MANUAL:`). CHECK `0 ≤ tarifa ≤ 1` |
| `item_group.iva_tarifa numeric(24,12) NULL` | Nulo = «el grupo no define» |
| `inventory_movement`: `total_bruto NULL`, `iva_tarifa_aplicada NULL`, `iva_recuperable_aplicado boolean NULL`, **`desglose_conocido`** + CHECK. **`total_cost` existente ES `costo_total_neto`**. **Sin relleno** | |
| `RegistrarMovimiento` (COMPRA): tarifa **cuerpo > artículo > grupo**; sin ninguna → 400 (**nunca 0.15**); `neto = recuperable ? bruto/(1+tarifa) : bruto`; los cuatro con `desglose_conocido = true` | `inventory/domain/iva-de-compra.ts` |
| `MovimientoDto`: `desglose: 'CONOCIDO' \| 'SIN_DESGLOSE'` | |
| `POST /catalogo/articulos` exige `ivaTarifa`; `PUT …/:id` la admite; `PUT /catalogo/grupos/:id` admite `ivaTarifa` nullable | |
| CSV `MOVIMIENTOS` y `SugerirPrecio`: misma precedencia | |
| **`CC-IVA-01..04`** (no recupera×>0: `GET /costeo` cambia) | |
| **Re-importación de los datos de ejemplo**; evidencia en `CONSTRUCCION.md` | |
| SPEC **R13**; `docs/apis/app-cliente.md`; ADR-024 | |

### IP del cliente tras el proxy (D-16.36)

`ipDelCliente(peticion)` en `shared/infrastructure/http/` con `PROXY_DE_CONFIANZA`; `login`, `backoffice`, `LimitadorDeTasa` lo usan; 🔴 cabecera falseada; **INC-022** registrada con su prevención (la propia prueba).

### Fase 3 — Correo transaccional

| Cambio | Detalle |
|---|---|
| `MailerPort.send` **se conserva**; `Plantilla`, `EncolarCorreo` en `shared/application` | |
| `email_outbox(id, company_id NULL, user_id NULL, destinatario, plantilla, datos jsonb, estado, intentos, error, created_at, sent_at)`; índices `(estado, created_at)`, `(user_id, created_at DESC)`; política app + política del despachador. **Encola en la misma transacción** | D-16.19, D-16.27(b) |
| **`datos` en vuelo solamente (D-16.34):** al pasar a `ENVIADO`, o a `FALLIDO` tras el tope, el despachador escribe `datos = {plantilla, destinatario}`; ninguna lectura devuelve `datos`; `HORAS_DE_RESTABLECIMIENTO` por defecto **1** (`DIAS_DE_INVITACION` como hoy). 🔴 tras `ENVIADO` no hay `token=`; 🔴 `/correo/salud` crudo sin `datos`. ADR-025: alternativa descartada (cifrar el campo con clave del despachador) y señal (más de un operador con acceso a la base) | |
| `password_reset_token(id, user_id, token_hash, expires_at, used_at, created_at)`; índices; **sin política de app** | D-16.31 |
| **`password_reset_request` / `password_reset_consume`** (definer) | D-16.26 |
| Rol **`costeo_despachador`**; `scripts/rol-despachador.mjs`; `DESPACHADOR_DATABASE_URL` solo en `modules/correo/`; reglas de auditoría | D-16.23 |
| Despachador `despachador.ts` (proceso aparte; servicio `correo`, `restart: unless-stopped`) y `npm run correo:despachar`: `FOR UPDATE SKIP LOCKED`, render, `send`, reintentos hasta 5, `FALLIDO`, **saneado de `datos`**, **purga de `rate_limit_hit`**. 🔴 dos companies; 🔴 su rol no lee otras tablas | ADR-025 |
| Adaptadores `fake` · `consola` · **`resend`** (`fetch`, probado contra servidor falso). Ninguna prueba envía correo real | D-16.16 |
| `APP_URL` | |
| Invitación: `InvitarUsuario` encola; enlace + caducidad; `user_id` del invitado | |
| **Reenviar invitación**: `ReenviarInvitacion` (nuevo token, invalida el anterior, encola, D-16.17); `POST /usuarios/:id/reenvio-de-invitacion` | Pantalla 32 |
| Restablecimiento: `POST /auth/password/olvido` (**siempre 202**, tiempo constante) → `password_reset_request`; `POST /auth/password/restablecimiento` → `password_reset_consume`, política, **revoca sesiones** | |
| **Salud en el back office**: `GET /correo/salud` → `{pendientesAntiguos, fallidos, ultimoEnvio}` (solo contadores e instantes), `CORREO_MINUTOS_DE_ALERTA`; tarjeta en `cartera` | D-16.27(c) |
| **Límite de tasa**: `LimitadorDeTasa` + `rate_limit_hit` (RLS permisiva); umbrales por `kind`; 429 `LIMITE_DE_SOLICITUDES`; cuatro endpoints; IP por `ipDelCliente`. 🔴 por endpoint, IP y destinatario; 🔴 purga; 🔴 cabecera falseada | ADR-026 |
| Pruebas: token dos veces → 400; caducado → 400; enumeración imposible por respuesta y tiempo; outbox transaccional; reintentos y tope; `/olvido` y `/restablecimiento` **sin sesión** | |
| **Envío real manual, en el runbook** (DKIM/SPF/DMARC en Resend, fuera de spam); evidencia en `CONSTRUCCION.md`. Depende del usuario | |
| Rutas públicas: `/olvide`, `/restablecer` | Pantalla 1b |

## P16-A2 — API · shared + sesión + CSRF + lecturas de catálogo + arreglos

`error.filter.ts` (tres errores → 400) · `PERIODO_SIN_DATOS` → 404 · **CSRF** (`session.csrf_token`, `X-CSRF-Token`, 403 `CSRF_INVALIDO`, helper de pruebas, ADR-021) · `GET /auth/sesion` → `{ userId, permisos, alcance, csrf }` · CORS + `DELETE` · `CONSULTA_*` `.strict()` · `nombre` en ventas y menu-engineering · `GET /catalogo/unidades`, `GET /catalogo/items/:id`, `GET /catalogo/articulos/:id`, `CrearItem` valida unidad, P2002 → 409, `PUT /catalogo/articulos/:id`, `PUT /catalogo/grupos/:id` · doc al día.

## P16-B — API · pricing + recipes/products + costing + concurrencia · `npm run bench`

**`product.version`, `item.version`** + `exigirVersion`; tres PUT exigen `version` → 409 `CONFLICTO_DE_VERSION`; ADR-023 (+ D-16.20); 🔴 dos escrituras · `GET /precios/pendientes`; `vigente`; `GET /precios/costos?fecha`; `EsquemaPipe`; validaciones de `SugerirPrecio` · `GET /productos/:id`; `GET /productos/:id/ubicaciones`; `GET /productos/ubicaciones?locationId`; `GET/PUT /productos/:id/componentes`; `GET /recetas/versiones`; `GET /recetas/propagacion?productId`; error de empaque · `semaforoFoodCost`; `GET /costeo/:id?pvp=`; `CostosDto.lineas`.

## P16-C — API · inventory + usuarios/roles/sucursales + concurrencia

**`period.version`**; `POST /analitica/ventas` exige `version` → 409; 🔴 · `GET /inventario/movimientos/:id`; filtro `tipo`; `desglose` · `consolidado.estadoDelPeriodo` · **`GET /usuarios`** con `roles[]`, `estado`, `invitacionCaducaEn`, **`correoInvitacion: {estado, error?}`** (nunca `datos`); `GET /roles`; `PUT /ubicaciones/:id`.

Pruebas 🔴 comunes: aislamiento; BODEGA sobre respuesta cruda; guardianes; `migrate:verify` + `down` sobre base sembrada; `DELETE /usuarios/roles` por Caddy en modo prod.

---

## P16 — Frontend: armazón y kit

**Reutilizado:** `lib/api.ts` (gana `'DELETE'`, `X-CSRF-Token`, `alCaducarSesion`, `CONFLICTO_DE_VERSION`, `LIMITE_DE_SOLICITUDES`), `lib/sesion.tsx`, `lib/decimales.ts`, `ui/Tabla`, `ui/Estados`, `ui/Marca`, `global.css`, tokens.

**Nuevo:** `app/(app)/layout.tsx` + `armazon/*` · `navegacion.ts` · `lib/permisos.tsx` · `lib/periodo.ts`, `lib/fechas.ts`, `lib/validacion.ts` · `componentes/ui/` (cada primitiva con su primer consumidor; obligatoria desde el segundo): `useLectura` + `Vista`, `useEnvio`, `Formulario`, `Campo*`, `Selector`, `Opciones`, `Casilla`, `Confirmar`, `PillDeEstado`, `Indicador`, `Icono`, `Volver`, `Buscador`, `PaginacionPorCursor`, `MesSinAbrir`, `SelectorDeMes`, `Permitido` · `textos/es/*.ts` · fábrica `seccion(permiso)`.

**Commit «Armazón»:** lo anterior + `git mv` de las 4 páginas a `(app)/` con partición ≤40 líneas + glob `.tsx` en `audit:complexity` (guardián) + `/` → `/inicio`. **«Inicio»** aparte.

## Rutas (públicas fuera de `(app)`: `/entrar`, `/sucursal`, `/activacion`, `/olvide`, `/restablecer`)

`/inicio` · `/insumos`, `/insumos/nuevo`, `/insumos/[id]`, `/insumos/[id]/editar`, `/insumos/[id]/articulos/nuevo`, `/insumos/[id]/articulos/[articuloId]/editar`, `/insumos/[id]/receta` · `/grupos`, `/grupos/nuevo`, `/grupos/[id]/editar` · `/precios`, `/precios/nuevo` · `/productos`, `/productos/nuevo`, `/productos/[id]`, `/productos/[id]/editar`, `/productos/[id]/receta`, `/productos/[id]/receta/versiones`, `/productos/[id]/componentes`, `/productos/[id]/propagar` · `/movimientos`, `/movimientos/nuevo`, `/movimientos/[id]/corregir`, `/transferencias/nueva`, `/producciones/nueva` · `/saldos`, `/reposicion` · `/conteos`, `/conteos/nuevo`, `/conteos/[id]` · `/ventas` · `/costos-fijos`, `/costos-fijos/editar` · `/costeo`, `/menu`, `/food-cost-real`, `/punto-de-equilibrio`, `/inventario-valorizado` · `/importar`, `/importar/[id]` (P20) · `/consolidado`, `/consolidado/productos`, `/consolidado/compras` · `/periodos`, `/periodos/[id]/reapertura` · `/sucursales`, `/sucursales/nueva`, `/sucursales/[id]/editar` · `/usuarios`, `/usuarios/invitar`, `/usuarios/[id]` · `/ajustes` · `/cuenta/contrasena`.

## Pantallas, en orden de commit

| # | Pantalla | Endpoints | Notas |
|---|---|---|---|
| 1 | Armazón | `GET /auth/sesion`, `GET /ubicaciones` | Migra las 4 existentes |
| 1b | Olvidé mi contraseña · Restablecer | `/auth/password/olvido`, `/auth/password/restablecimiento` | Mismo mensaje siempre; 429 accionable |
| 2 | Inicio | `GET /analitica/resumen`; BODEGA `/analitica/reposicion` | |
| 3 | **Ventas (arreglo)** | `GET /productos/ubicaciones`, `GET/POST /analitica/ventas` | D-16.1 + `version` |
| 4 | Insumos: listado | `GET /catalogo/items`, `/grupos`, `GET /precios/costos` | |
| 5 | Insumo: alta | `POST /catalogo/items`, `GET /catalogo/unidades` | |
| 6 | Insumo: ficha + editar + archivar | `GET/PUT /catalogo/items/:id`, artículos, precios | |
| 7 | Grupos | `GET/POST /catalogo/grupos`, `PUT …/:id` | |
| 8 | Artículo: alta y editar (`ivaTarifa` precargada) | `POST /catalogo/articulos`, `PUT …/:id` | |
| 9 | Precios: bandeja + decidir | `GET /precios/pendientes`, `POST /precios/:id/decision` | |
| 10 | Precio: sugerir | `POST /precios` | |
| 11 | Productos | `GET/POST /productos`, `GET /productos/:id`, `/ubicaciones` | |
| 12 | Producto: ficha (PVP/activo, empaque, simulador, desglose) | `GET/PUT …/ubicaciones` (`version`), `PUT …/empaque`, `GET /costeo/:id?pvp=`, `lineas` | |
| 13 | Componentes de combo | `GET/PUT …/componentes` (`version`) | |
| 14 | Receta | `GET /recetas`, `PUT /recetas` (`version`) | |
| 15 | Versiones | `GET /recetas/versiones` | |
| 16 | Propagación + reversión | previsualización, `POST`, listado, reversión | |
| 17 | Movimientos: libro | `GET /inventario/movimientos` | «Sin desglose» como estado |
| 18 | Movimiento: compra/merma/ajuste | `POST /inventario/movimientos`, artículos, `GET /periodos` | «Total de la factura (con IVA)» |
| 19 | Corrección | `GET /inventario/movimientos/:id`, `POST …/correccion` | |
| 20 | Transferencia | `POST /inventario/transferencias` | |
| 21 | Producción | `POST /inventario/producciones` | |
| 22 | Saldos + Reposición | `GET /inventario/saldos`, `/analitica/reposicion` | |
| 23 | Conteos | `/conteos…` | |
| 24 | Costos fijos | `GET/POST /analitica/costos-fijos` | |
| 25 | Food cost real | `GET /analitica/food-cost-real` | |
| 26 | Punto de equilibrio | `GET /analitica/punto-de-equilibrio` | |
| 27 | Inventario valorizado | `GET /analitica/inventario` | |
| *28, 31* | *Consolidado · Sucursales* — **antes de la parada si el piloto tiene más de una sucursal** | | |
| **⏸** | **ENTREGA AL PILOTO** | | |
| **⏸ P20** | **SPEC §24 → aprobación → Importación desde la UI** + `/importar`, `/importar/[id]` | | |
| 28 | Consolidado + comparativa | `GET /consolidado…` | |
| 29 | Períodos + reapertura | `GET /periodos`, `POST …/reapertura` | Solo OWNER |
| 30 | Ajustes | `GET/PUT /ajustes` | `ivaCompraRecuperable` explicado |
| 31 | Sucursales | `GET/POST /ubicaciones`, `PUT …/:id` | |
| 32 | Usuarios: lista con **estado del correo**, invitar, **reenviar** (si `FALLIDO`), roles; Activación | `GET /usuarios`, `/roles`, `POST /usuarios`, `POST /usuarios/:id/reenvio-de-invitacion`, roles, activación | 429 accionable |
| 33 | Cambio de contraseña | `POST /auth/password` | |

## Parada «ENTREGA AL PILOTO» — se aprueba con las cinco evidencias

1. **Respaldo automático** programado en el VPS, **cifrado con `age`** (clave pública en el VPS, privada solo en el gestor; D-16.37), **copiado fuera del VPS** al destino nombrado en el runbook (lo aporta el usuario), y **restauración completa probada en una base vacía partiendo de la copia remota, descifrado incluido**; el descifrado se hace **con una copia de la clave privada distinta del equipo donde se generó el par** (D-16.38: existen al menos dos copias independientes, anotadas en el runbook sin decir dónde); evidencia: salida de `descifrar-respaldo.sh` + `restaurar` con los recuentos, la procedencia del archivo **y qué copia de la clave se usó**.
2. **Invitación real** entregada a una bandeja real del piloto, **fuera de spam**.
3. **Datos del piloto** cargados con `npm run importar`; `iva_compra_recuperable` fijado **según confirmación de su contador**.
4. **Tres productos** del piloto con costo conocido por él, contrastados contra `GET /costeo`; **diferencias explicadas por escrito**.
5. Las 27 capturas (1280 y 360 px, por rol) y `medir-bundle` verde.

Las evidencias 1–3 dependen de lo que solo el usuario aporta (VPS, destino remoto, clave privada en su gestor, dominio, cuenta de Resend, datos y contador del piloto): la parada espera a eso.

---

## P20 — Importación desde la UI (D-16.21, D-16.29; SPEC §24 con parada)

**En memoria, sin reanudar, sin antivirus, solo CSV.** `POST /importaciones` (octet-stream; rechazo por `Content-Length` antes de bufferizar; tope de filas) → analiza, **guarda `sha256`**, devuelve informe + `id`; `POST /importaciones/:id/confirmacion` **recibe el archivo otra vez**, recalcula → **409 `ARCHIVO_DISTINTO`**, re-analiza, escribe; `filasOmitidas`; `DESCARTADA`/`FALLIDA`; un hijo de parser a la vez (409 `IMPORTACION_EN_CURSO`); plantilla CSV; similitud como aviso; IVA por D-16.9. SEGURIDAD §5 puntos 3, 5, 6, 7 «no aplica» por no guardar el archivo, dicho en el SPEC. Rutas `/importar`, `/importar/[id]`.

## SPEC escritos y presentados, NO construidos

- **§22 Butcher test**: fórmulas de rendimiento equivalente; sugiere, no aplica. Abierto: equivalente vs físico (R12).
- **§23 Recepción HACCP**: acta + `COMPRA` en la misma `run()`; `RECHAZADO` no toca el libro; acta inmutable; neteo por D-16.9; sugerencia `ULTIMA_COMPRA`. Abierto: devoluciones; actor cuando registra BODEGA.
- **§25 USAR + §26 multimodelo**: plan de cuentas; **R15: `EBITDA_USAR − utilidad_operativa = 0.00`**; Miller/Pavesic ponderados; ABC con `labor_minutes` y `brigade_hourly_rate`. Abierto: 5000 teórico o real; cargas sociales; mapa categoría → cuenta.

---

## Verificación

- **API:** `npm run audit` en cada commit; `npm run bench` en P16-B; 🔴 aislamiento, BODEGA, guardianes, `migrate:verify` + `down` sobre base sembrada; CSRF; concurrencia; IVA; correo (outbox transaccional, tokens, tiempo constante, dos companies, rol del despachador, `/olvido` y `/restablecimiento` sin sesión, **`datos` saneado tras `ENVIADO`, `/correo/salud` sin `datos`**); límite de tasa (endpoint, IP, destinatario, purga, **cabecera falseada**); SHA-256 en P20.
- **Pantallas:** pila de producción en local + sesión por página estática + Chrome sin cabeza 1280/360 por rol + volcado de red de BODEGA. Sin `verificar-pantalla.mjs`.
- **Piloto:** las cinco evidencias.

## Lo que NO se construye

Tipti · `/empaques` · `/consumos` manual · presets ±10 % · «fuga por plato» · glosario · `expiraEn` · debounce en memoria · elasticidad · borrado físico · back office en `apps/web` · «Todas las sucursales» · antivirus, reanudación y `.xlsx` en P20 · `verificar-pantalla.mjs` · cifrado del campo `datos` (descartado, con señal) · **P17, P18, P19** (SPEC sí, código no).

## Riesgos y trampas

| Trampa | Mitigación |
|---|---|
| `.nullable()` sin `.optional()` | `Formulario` manda `null` explícito |
| Decimales string en ambas direcciones | `comoImporte`/`redondear` |
| Reemplazos totales pisándose | 409 `CONFLICTO_DE_VERSION` accionable |
| IVA asumido o inventado | Precedencia explícita; 400; sin relleno; `desglose_conocido` |
| Correo perdido, duplicado o invisible | Outbox transaccional; `SKIP LOCKED`; tope; `correoInvitacion`; salud; `restart` |
| Token en claro en reposo | Saneado de `datos` al salir de vuelo; caducidad 1 h; lecturas sin `datos` |
| Escrituras públicas bajo RLS | Definer de D-16.31; `password_reset_token` sin política de app |
| Despachador con más acceso del debido | Rol propio; 🔴 `permission denied` |
| **Toda petición con la IP del proxy** | `ipDelCliente` + `PROXY_DE_CONFIANZA`; 🔴 cabecera falseada; INC-022 |
| Enumeración y abuso | 202 constante; límite por IP y destinatario; purga |
| Archivo cambiado entre análisis y confirmación | SHA-256 → 409 |
| Respaldo legible fuera de casa | `age` con clave pública en el VPS, privada en el gestor |
| Clave privada perdida = respaldo perdido | Dos copias independientes (D-16.38); la evidencia 1 descifra con una copia que no es la del equipo de origen |
| 404 en mes sin abrir | `PERIODO_SIN_DATOS` |
| INC-013 | `lib/fechas.ts` + regla |
| jscpd / knip / complexity `.tsx` | Kit desde el segundo uso; primer consumidor; glob en «Armazón» |
| `DELETE` con cuerpo por Caddy | Probado en modo prod |
| Compactación de contexto | Tablero en `ESTADO.md` **en cada commit** |

## Documentación

`docs/pasos/P16-A1|A2|B|C|P20/` (`CONSTRUCCION.md` + `AUDITORIA-RESULTADO.md`), `docs/apis/app-cliente.md`, `CHANGELOG`, `ESTADO`, runbooks (`despliegue.md`: servicio `correo`, rol del despachador, `PROXY_DE_CONFIANZA`; `puesta-en-marcha.md`: Resend, DKIM/SPF/DMARC, envío real manual, destino remoto y clave de `age`; `respaldos-y-restauracion.md`: cifrado, gestión y rotación de la clave, **las dos copias independientes de la privada sin revelar su ubicación**, restauración desde la copia remota), `docs/SEGURIDAD.md` y `docs/sistema/seguridad.md` (exención de `rate_limit_hit`; las dos definer que escriben; el token en vuelo; la IP tras el proxy), `docs/incidencias/INC-022`. ADRs: **ADR-020** armazón y kit · **ADR-021** CSRF · **ADR-022** lecturas del frontend · **ADR-023** concurrencia (+ D-16.20) · **ADR-024** IVA en dos niveles · **ADR-025** correo (outbox, rol y proceso, definer, token en vuelo y alternativa descartada) · **ADR-026** límite de tasa e IP tras el proxy. SPEC: R13; §22–§26.

## Referencias del diseño detallado

- Inventario de la API: `…\tasks\wzykvwf97.output` · `…\subagents\workflows\wf_dc61cb11-454\journal.jsonl`
- Sistema de ejemplo: `…\tasks\w3chd8iid.output`
- Cinco diseños + crítica: `…\subagents\workflows\wf_6388aa86-d76\journal.jsonl`

(`…` = `C:\Users\Lander\AppData\Local\Temp\claude\c--Projects-CommerceKosto\4c27c27d-49db-4b90-aaa5-2060e8481be7` y `C:\Users\Lander\.claude\projects\c--Projects-CommerceKosto\4c27c27d-49db-4b90-aaa5-2060e8481be7`.)
