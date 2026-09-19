# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Fase en curso:** **Pasada P16 → P20**. Commit 0 (Tooling) cerrado; **P16-A1 cerrado** (IVA en dos niveles + correo transaccional + límite de tasa + IP tras el proxy; `docs/pasos/P16-A1/`), con `npm run audit` en verde y `npm run bench` ejecutado. **P16-A2 cerrado** (sesión + token CSRF + frontera HTTP + lecturas de catálogo; `docs/pasos/P16-A2/`), con `npm run audit` en verde. **P16-B cerrado** (pricing + recipes/products + costing + concurrencia optimista; `docs/pasos/P16-B/`), con `npm run audit` en verde, `migrate:verify` 4/4 y `npm run bench` ejecutado **sobre su propio código** (hasta P16-B el bench medía el `dist` que hubiera en disco: INC-007, caso 12). **P16-C cerrado** (inventory + usuarios/roles/sucursales + `period.version`; `docs/pasos/P16-C/`): **los cuatro paquetes de API de la pasada están hechos**. **Armazón (pantalla 1) cerrado** (grupo de rutas `(app)`, permisos cerrados por defecto, mes en la URL, kit de lecturas y escrituras, las cuatro pantallas migradas; ADR-020 y ADR-022; `docs/pasos/P16/`), verificado entrando de verdad con tres roles a 1280 y 360 px: **destapó que «Entrar» no funcionaba desde un navegador sin sesión desde P16-A2 (INC-023)** y que una fila ya guardada de ventas o del conteo no se podía editar; los dos, arreglados. **P16-D cerrado** (el costeo marca `sinReceta` y el semáforo `SIN_DATO`; duda #12 cerrada por el usuario con la opción (a); `docs/pasos/P16-D/`). **Inicio (pantalla 2) cerrado** (resumen del mes o reposición según el permiso; `/` → `/inicio`; arreglo del signo en `lib/decimales` —INC-024— con las primeras pruebas de `apps/web`, ADR-027). **Pantalla 1b cerrada** (`/olvide` y `/restablecer`; INC-025, el 202 sin cuerpo; pruebas del transporte). **Pantalla 3 cerrada** (ventas lee la carta de `GET /productos/ubicaciones`; la rejilla cabe a 360 px). **Pantalla 4 cerrada** (`/insumos`: catálogo con costo de uso, sin costo para `BODEGA`). **Pantalla 5 cerrada** (`/insumos/nuevo`). **Pantalla 6 cerrada** (ficha, edición con versión y archivo). **Pantalla 7 cerrada** (`/grupos`, alta y edición). **Verificación multi-tenant cerrada** (D-16.193): el entorno sintético tiene **dos companies** y las pantallas 1–14 están comprobadas contra la de al lado. **D-16.199 cerrada** (el umbral del eje de IP sube a 50 cuentas/hora). **Siguientes, en este orden: D-16.198** (repetir el simulacro de restauración con libro y período cerrado) y **D-16.200** (anulación de una importación); después, **pantalla 15 — Versiones de receta**, ya con las dos comprobaciones de tenant cruzado (D-16.193). Duda abierta **#14** (renombrar y archivar productos). Queda pendiente, y dicho, la prueba de `DELETE /usuarios/roles` a través de Caddy en modo producción (exige parar la pila local en uso). Dos cosas esperan al usuario y no bloquean el código: ratificar **D-16.51** y decidir sobre el **presupuesto del consolidado** (abajo, en dudas abiertas). El plan P0–P15 está completo y el sistema se ha desplegado entero en local.
**Último commit:** `P16-F2: el umbral del eje de IP se calibra para IPs compartidas`
**Fecha de última actualización:** 2026-09-13

## Pasada P16 → P20 — la aplicación completa · EN CURSO desde 2026-09-09

> **El plan completo (versión 6) está en `docs/pasos/P16/PLAN.md`.** Esta sección es lo que sobrevive
> a una compactación: las decisiones cerradas, el tablero y dónde se retoma. Si el plan y esta sección
> difieren, manda el plan; si el plan y el código difieren, manda el código y se corrige el tablero.

### Por qué existe

El backend tiene 36 escrituras y la interfaz usaba **5 de 41 rutas, dos de ellas de escritura**. Un
dueño no podía dar de alta un insumo, escribir una receta, subir un precio ni registrar la compra de
hoy. «Solo veo datos cargados, no veo nada que yo pueda cargar» (el usuario, 2026-09-09). Se
construye todo, en una pasada, **como Noctis Commerce** y **con lo que trae la referencia visual**.

### La referencia visual está en disco, no en git

`docs/Sistema ejemplo/` — **ignorada en `.gitignore`**, como el Excel. Es una aplicación Vite ajena
con 18 vistas y su propio `package.json`; versionarla la metería bajo los doce checks (de hecho ya
ponía `audit:forbidden` en rojo por un script que apunta a un `dist/` inexistente). Se lee para el
armazón y las 33 pantallas; no se importa nada de ella. Si no está en disco: pedirla al usuario.

### Tablero — se actualiza EN CADA COMMIT, no al final

| Commit | Qué | Estado | Hash | Capturas | Bundle gzip (piso / mayor) | Decisiones |
|---|---|---|---|---|---|---|
| 0 · Tooling | Fase 0 + tres reglas de `apps/web` + `medir-bundle` + `multer` forzado a 2.3.0 (INC-021) | ✅ 2026-09-09 | *(el de este commit)* | — | 127 KiB / 139 KiB | D-16.39 |
| P16-A1 | IVA en dos niveles + correo transaccional + límite de tasa + IP tras el proxy · 2 migraciones · ADR-024/025/026 · INC-022 + recurrencia de INC-017 · 823 unitarias, 395 + 5 de integración | ✅ 2026-09-10 · `npm run audit` **exit 0** · bench ejecutado (3 de 4 presupuestos en verde) | *(el de este commit)* | — | | D-16.40…D-16.64 |
| P16-A2 | `shared` + sesión + CSRF + lecturas de catálogo + arreglos · 1 migración · **ADR-021** (supersede en parte a ADR-006) · recurrencias de INC-007 (→11) e INC-012 (→3) · 1 regla nueva de `audit:forbidden` · 870 unitarias, 460 + 5 de integración | ✅ 2026-09-12 · `npm run audit` **exit 0** · `migrate:verify` 4/4 · bench ejecutado (3 de 4, el consolidado sigue fuera) | *(el de este commit)* | — | 126,9 / 138,7 KiB | D-16.65…D-16.99 |
| P16-B | pricing + recipes/products + costing + concurrencia optimista · 1 migración · **ADR-023** · recurrencias de INC-012 (→4) e INC-007 (→12) · 1 regla nueva de `audit:forbidden` · 12 guardianes · 889 unitarias, 515 + 5 de integración | ✅ 2026-09-12 · `npm run audit` **exit 0** · `migrate:verify` 4/4 · bench ejecutado sobre su código (3 de 4, el consolidado sigue fuera: 919,4 ms) | *(el de este commit)* | — | 126,9 / 138,7 KiB | D-16.100…D-16.120 |
| P16-C | inventory + usuarios/roles/sucursales + `version` de period · 1 migración · sin ADR (decisión 5 de ADR-023) · recurrencia de INC-017 (→2) · 1 regla nueva de `audit:forbidden` · 8 guardianes · 891 unitarias, 536 + 5 de integración · **arreglo de `/ventas`** (mandaba solo lo cambiado a un reemplazo total) | ✅ 2026-09-12 · `npm run audit` **exit 0** · `migrate:verify` 4/4 · bench ejecutado (3 de 4, el consolidado sigue fuera: 913,1 ms) · **pendiente: `DELETE /usuarios/roles` por Caddy** | *(el de este commit)* | — | 126,9 / 138,7 KiB | D-16.121…D-16.130 |
| Armazón (pantalla 1) | grupo de rutas `(app)` + permisos cerrados por defecto + barra lateral por grupos + mes en la URL + kit (`useLectura`/`useCarga`, `Vista`, `useEnvio`, `useRejilla`, `CeldaEditable`, `CampoDeTexto`) + las 4 pantallas migradas y partidas · **ADR-020 y ADR-022** · **INC-023** («Entrar» roto desde P16-A2) · recurrencias de INC-007 (→13) e INC-015 (→1, con comprobación en `doctor`) · glob `.tsx` en `audit:complexity` (10 incumplimientos → 0) · `typecheck` con `next typegen` · **arreglo: filas guardadas no editables** en ventas y conteo | ✅ 2026-09-14 · `npm run audit` **exit 0** (891 unitarias, 536 + 5 de integración) · login, guardar y recargar verificados en el navegador · **la base local pasa al puerto 5442** (D-16.145) · **tenant cruzado ✓** | *(el de este commit)* | 33 (3 roles × 1280/360, en el scratchpad de la sesión) | 126,9 / 142,6 KiB | D-16.131…D-16.145 |
| P16-D | API · el costeo marca `sinReceta` (ninguna línea activa, o combo sin componentes) y el semáforo `SIN_DATO`, también simulado · la pantalla de costeo lo pinta · sin migración ni ADR (decisión de producto, SPEC §14) · 5 guardianes | ✅ 2026-09-14 · `npm run audit` **exit 0** · verificado en el navegador | *(el de este commit)* | 2 (costeo de la dueña en bodega y del gerente en local) | 126,9 / 142,6 KiB | D-16.146, D-16.147 |
| Inicio (pantalla 2) | `/inicio`: nueve indicadores del resumen (con `analytics.read`) o la reposición sin cantidades (`BODEGA`) · `Indicador` · `Vista` con `vacio: … \| 'nunca'` · `/` → `/inicio` · **INC-024** (el signo perdido de `comoImporte`) · **ADR-027**: primeras pruebas de `apps/web` con `node --test` (20), en `audit:tests` · 4 guardianes | ✅ 2026-09-14 · `npm run audit` **exit 0** · verificado en el navegador con los tres roles · **tenant cruzado ✓** | *(el de este commit)* | 6 (3 roles × 1280/360) | 126,9 / 143,0 KiB | D-16.148…D-16.151 |
| Pantalla 1b | `/olvide` (misma frase siempre; 429 con su mensaje) · `/restablecer` (largo y repetición antes de gastar el token; 400 → pedir otro; 429 → reintentar) · enlace en `/entrar` · **INC-025** (202 sin cuerpo) · `lib/api.spec.ts` (11, fija también INC-023) · `erasableSyntaxOnly` · 3 guardianes | ✅ 2026-09-14 · `npm run audit` **exit 0** · recorrido completo en el navegador · **tenant cruzado ✓** | *(el de este commit)* | 2 (restablecer a 360) | 126,9 / 143,5 KiB | D-16.152…D-16.155 |
| Pantalla 3 | Ventas: la carta de `GET /productos/ubicaciones` (antes `GET /costeo` entero) · `.celda-editable` 5rem en el teléfono | ✅ 2026-09-14 · `npm run audit` **exit 0** · escritura y log de la API verificados · **tenant cruzado ✓** | *(el de este commit)* | 12 (ventas e inventario, 3 roles × 1280/360) | 126,9 / 143,5 KiB | D-16.156, D-16.157 |
| Pantalla 4 | `/insumos`: ítems, grupos y `GET /precios/costos` solo con `pricing.read` · filtros de nombre y grupo, «Incluir archivados» · `Casilla`, `Selector` · `comoCostoDeUso` (+3 pruebas) | ✅ 2026-09-14 · `npm run audit` **exit 0** · filtros y log de la API verificados · **tenant cruzado ✓** | *(el de este commit)* | 6 (3 roles × 1280/360) | 126,9 / 143,9 KiB | D-16.158…D-16.160 |
| Pantalla 5 | `/insumos/nuevo`: `POST /catalogo/items` con unidades de la API, rendimiento en % (`fraccionDePorcentaje`, +3 pruebas), `llevaStock` solo en preparaciones · `Formulario`, `Volver` · «Nuevo insumo» con `catalog.create` | ✅ 2026-09-14 · `npm run audit` **exit 0** · altas, 409, 400 y permisos verificados en el navegador y en la base · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 144,3 KiB | D-16.161…D-16.163 |
| Pantalla 6 | `/insumos/[id]` (datos, costo de uso, presentaciones, historial con «Vigente», archivar/reactivar) · `/insumos/[id]/editar` (409 → «Ver la versión actual») · `componentes/insumos/` · `Confirmar`, `Pildora` · `Volver` genérico · `porcentajeDeFraccion`, `comoFecha` (+3 pruebas) | ✅ 2026-09-14 · `npm run audit` **exit 0** · ficha, edición, conflicto, archivo y `BODEGA` verificados en el navegador · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 145,1 KiB | D-16.164…D-16.167 |
| Pantalla 7 | `/grupos` (tarifa o «No define») · `/grupos/nuevo` · `/grupos/[id]/editar` (buscado en la lista) · `FormularioDeGrupo` | ✅ 2026-09-14 · `npm run audit` **exit 0** · alta, edición a `null`, 409, id inexistente y gerente verificados · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 145,4 KiB | D-16.168, D-16.169 |
| Pantalla 8 | `/insumos/[id]/articulos/nuevo` (factor solo si cambia la dimensión; IVA obligatorio, precargado del grupo) · `…/[articuloId]/editar` (presentación y factor no editables) · `CampoDePorcentaje`, `CampoDeCantidad` · `conPuntoDecimal` (+1 prueba) | ✅ 2026-09-14 · `npm run audit` **exit 0** · dos dimensiones, edición y gerente verificados · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 145,7 KiB | D-16.170…D-16.172 |
| Pantalla 9 | `/precios`: sugeridos junto al vigente, por cursor («Ver más»), Confirmar/Rechazar solo con `pricing.confirm`, 409 en la fila · entrada «Precios por confirmar» en Catálogo | ✅ 2026-09-14 · `npm run audit` **exit 0** · confirmar, rechazar, 409, gerente y bodega verificados; lo sintético deshecho · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 144,8 KiB | D-16.173…D-16.175 |
| Pantalla 10 | `/precios/nuevo` (comprado: presentación, precio con IVA, tarifa opcional; preparación: costo estándar sin IVA; vigente a la vista; `origen` `MANUAL`) · «Sugerir precio» en bandeja y ficha · `diaDeHoy`, `instanteDelDia`, `textoOpcional` (+5 pruebas) · precios con `comoCostoDeUso` · `.campo select` | ✅ 2026-09-14 · `npm run audit` **exit 0** · compra, preparación, exenta, 400, sin presentaciones, gerente, bodega y 360 px verificados; lo sintético deshecho · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 146,3 KiB | D-16.176…D-16.179 |
| Pantalla 11 | `/productos` (maestro + estado y PVP en la sucursal elegida; buscar, categoría, archivados) · `/productos/nuevo` · `/productos/[id]` de lectura (datos, empaque, dónde se vende) · grupo «Carta» · `lib/busqueda` (+3 pruebas), `ui/Dato` | ✅ 2026-09-14 · `npm run audit` **exit 0** · dos sucursales, filtros, alta, 409, gerente, bodega y 360 px verificados · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 146,0 KiB | D-16.180…D-16.182 |
| Pantalla 12 | `/productos/[id]`: costo en la sucursal (porción, merma, empaque, total, venta y semáforo), simulador `?pvp=`, desglose con unidades, configuración por sucursal y empaque con `version` · `componentes/costeo/tipos`, `ui/VolverACargar`, `CONFLICTO_DE_VERSION` | ✅ 2026-09-14 · `npm run audit` **exit 0** · simular, 400, guardar, 409, empaque, sin receta, gerente y 360 px verificados; lo tocado restaurado · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 148,3 KiB | D-16.183…D-16.186 · INC-026 |
| Pantalla 13 | bloque «Componentes» en la ficha de un combo · `/productos/[id]/componentes` (lista entera con `version`, añadir/quitar, 400 con motivo, 409) · «Sin componentes» en el costo de un combo | ✅ 2026-09-14 · `npm run audit` **exit 0** · alta de combo, repetido, guardar, 409, no-combo, gerente y 360 px verificados · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 148,8 KiB | D-16.187…D-16.188 |
| Pantalla 14 | `/productos/[id]/receta` y `/insumos/[id]/receta` (una página): líneas con unidad, AP/EP en palabras de cocina, excluir o quitar, vale desde y nota, `basadaEn` y 409, aviso de versión futura · «Receta» en las fichas | ✅ 2026-09-14 · `npm run audit` **exit 0** · guardar con excluida y costo nuevo, 409, preparación, comprado, combo, gerente, bodega y 360 px verificados; receta restaurada · **tenant cruzado ✓** | *(el de este commit)* | — | 126,9 / 148,5 KiB | D-16.189…D-16.191 |
| P16-F | El eje de IP del login **limita, no bloquea** (D-16.196): cuenta cuentas distintas (10/h), 429 `LIMITE_DE_SOLICITUDES` con 15 min fijos, sin escalada · `RociadoDeContrasenasError` · 1 migración (tipo de evento `auth.login.ip_limited`) · **ADR-028** · **INC-027** | ✅ 2026-09-17 · `npm run audit` **exit 0** · 🔴 en dominio, caso de uso y HTTP; `migrate:verify` con la 19.ª | *(el de este commit)* | — | — | D-16.196 |
| P16-G | **Restauración por tenant** (D-16.195): `npm run restaurar:tenant`, 22 tablas en orden de claves foráneas, recorte y validación por RLS, guardián contra el catálogo, ajustes de costeo comparados y no reinsertados · **INC-028**: el volcado va por descriptor, sin el tope de 512 MiB que mataba el respaldo sin mensaje | ✅ 2026-09-17 · `npm run audit` **exit 0** · simulacro sobre ensayo-b: respaldo de 722 MiB verificado, 18 filas restauradas, `ensayo` intacto y la interfaz costeando otra vez | *(el de este commit)* | — | — | D-16.195 |
| Pantallas 15–27 | una fila por pantalla al commitear | ⬜ | | | | |
| ⏸ Entrega al piloto | cinco evidencias (abajo) | ⬜ | | | | |
| ⏸ SPEC §24 → P20 | importación desde la UI, tras aprobar el SPEC | ⬜ | | | | |
| Pantallas 28–33 | consolidado, períodos, ajustes, sucursales, usuarios, contraseña | ⬜ | | | | |
| ⏸ SPEC §22 · §23 · §25/§26 | escritos y presentados, **no construidos** | ⬜ | | | | |

### Decisiones del usuario — cerradas, no se reabren

| # | Decisión |
|---|---|
| U1 | Shell **como Commerce**: barra lateral por grupos, sección por entidad, listado → alta → ficha → edición en página propia, `← Volver`, confirmación en línea |
| U2 | **Inicio** con el resumen del mes; BODEGA ve reposición |
| U3 | Los cuatro bloques sin backend tienen SPEC escrito y presentado; **solo se construye P20** |
| U4 | **Token CSRF completo** (SEGURIDAD.md §4.2) |
| U5 → D-16.9 | El bodeguero escribe **el total de la factura con IVA**. Dos niveles: tarifa por artículo, recuperabilidad por company. **Neteo solo si `iva_compra_recuperable = true`**; si no, el IVA entra íntegro al plato |
| D-16.10 | Todo `COMPRA` persiste `total_bruto`, `iva_tarifa_aplicada`, `iva_recuperable_aplicado`, `costo_total_neto` |
| D-16.11 | Reemplazos totales con **concurrencia optimista**: 409 `CONFLICTO_DE_VERSION` |
| D-16.12 | Correo transaccional en alcance mínimo: **invitación y recuperación** |
| D-16.15 | El despachador **no** usa el rol de la app ni bypass; 🔴 dos companies → envía los dos |
| D-16.16 | Proveedor único: **Resend**. Adaptadores `fake` · `consola` · `resend` |
| D-16.17 | Límite de tasa **por IP y por destinatario** en olvido, restablecimiento, `POST /usuarios` y reenvío de invitación; 429 con código propio. La IP llega por el proxy de confianza, nunca leyendo `X-Forwarded-For` directamente; 🔴 cabecera falseada desde fuera no cambia la clave |
| D-16.18 | Los `COMPRA` anteriores **no se rellenan**: «sin desglose» es un estado; datos de ejemplo re-importados |
| D-16.19 | `email_outbox.company_id` nullable; índices por estado |
| D-16.20 | ADR-023 registra la deuda del 409 espurio entre sucursales por `product.version`; señal: primer conflicto sin usuario concurrente |
| D-16.21 | P20 **en memoria, sin reanudar, sin antivirus, solo CSV**, con tope de `Content-Length` y de filas |
| D-16.22 | `verificar-pantalla.mjs` **no** se construye |
| D-16.26 | Los endpoints públicos de restablecimiento no operan bajo tenant: **dos funciones `SECURITY DEFINER`** (una crea token + encola en una operación; otra consume y devuelve `user_id`) |
| D-16.27 | Observabilidad del correo: `restart: unless-stopped`; `GET /usuarios` trae `correoInvitacion {estado, error?}` y la pantalla ofrece «Reenviar» si `FALLIDO`; salud «PENDIENTE > N min» en el back office |
| D-16.28 | `rate_limit_hit` fuera del ámbito de tenant, con exención documentada; purga en cada pasada del despachador; 🔴 no crece |
| D-16.29 | `import_job` persiste **SHA-256**; la confirmación lo recalcula → 409 `ARCHIVO_DISTINTO` |
| D-16.30 | Evidencia 1 del piloto: respaldo **copiado fuera del VPS**, restauración probada **desde la copia remota** |
| D-16.34 | El token en claro vive en la base **solo mientras el correo está en vuelo**: al pasar a `ENVIADO` o `FALLIDO`, `datos` queda en `{plantilla, destinatario}`; ninguna lectura del outbox expone `datos`; `HORAS_DE_RESTABLECIMIENTO` = 1 por defecto; ADR-025 registra el cifrado del campo como alternativa descartada y su señal (más de un operador con acceso a la base) |
| D-16.35 | El dump se **cifra en el VPS antes de subirse**; la clave no vive con el respaldo; la restauración probada descifra desde la copia remota |
| D-16.38 | La clave privada tiene **al menos dos copias independientes** (gestor + copia física o segundo gestor), anotadas en el runbook sin decir dónde; la evidencia 1 descifra con una copia **distinta del equipo donde se generó el par**, y lo dice |
| U6 | Entran las cuatro opcionales: simulador de PVP, desglose del costo, costo de uso, editar sucursal |
| U7 | Tipti fuera (D8); back office fuera de `apps/web` |
| U8 | Parada **«entrega al piloto»** con cinco evidencias; P20 después de las pantallas operativas |

### Decisiones mías — registradas aquí, detalladas en el plan

| # | Decisión |
|---|---|
| D-16.1 | La rejilla de ventas manda todas las filas con valor, con la `version` leída (desviación consciente de la letra de §10) |
| D-16.2 | «Mes sin abrir» = `code === 'PERIODO_SIN_DATOS'` |
| D-16.3 | `GET /costeo` gana `semaforoFoodCost`; nada se decide en el cliente |
| D-16.4 | Fechas por `lib/fechas.ts` a `12:00Z`; mes por defecto en `America/Guayaquil` |
| D-16.5 | El mes vive en la URL |
| D-16.6 | Sin permiso = en sitio, fail-closed |
| D-16.7 | No hay `/empaques` (el empaque es un ítem, ADR-008) |
| D-16.8 | Paquetes de API antes de cualquier pantalla |
| D-16.13 | Concurrencia con **columna `version` entera** en `period`, `product`, `item` (ninguna tabla tiene `updated_at`) |
| D-16.14 | El correo **extiende `MailerPort`** como transporte |
| D-16.23 | Rol **`costeo_despachador`** (`NOBYPASSRLS`, `CONNECTION LIMIT 2`, solo `email_outbox` y `DELETE` en `rate_limit_hit`), **proceso aparte** (`despachador.ts`, servicio `correo`); reglas de auditoría para `DESPACHADOR_DATABASE_URL` |
| D-16.24 | `LimitadorDeTasa` en `shared/application` reutiliza `evaluarIntentos`; tabla `rate_limit_hit(kind, clave, ip, at)`; 429 `LIMITE_DE_SOLICITUDES` |
| D-16.25 | `desglose_conocido boolean NOT NULL DEFAULT false` + CHECK; toda `COMPRA` nueva nace `true` |
| D-16.31 | `password_reset_request(p_email, p_token_hash, p_datos)` y `password_reset_consume(p_token_hash)`, definer, patrón de `session_lookup`; las dos únicas definer **que escriben**; `password_reset_token` sin política para `costeo_app` |
| D-16.32 | La lista de exenciones de M6 **sigue vacía**: `rate_limit_hit` con RLS y política permisiva |
| D-16.33 | `import_job.sha256 text NOT NULL` (64 hex, CHECK); `storage_key` vale `''` en la UI |
| D-16.36 | **Hoy la API toma la IP del socket** (`auth.controller.ts:91`, `backoffice.controller.ts:345`) y detrás de Caddy toda petición llega con la IP del proxy: el bloqueo por IP del login sería un **bloqueo global**. `ipDelCliente(peticion)` en `shared/infrastructure/http/` con `PROXY_DE_CONFIANZA`; lo usan login, back office y el limitador; **INC-022** |
| D-16.37 | Cifrado del respaldo con **`age`** (asimétrico): pública en `/etc/costeo/respaldo.pub`, privada solo en el gestor; `preparar.sh` instala `age` y su `.env` gana `RESPALDO_CLAVE_PUBLICA` y `PROXY_DE_CONFIANZA`; `descifrar-respaldo.sh`; descartado `gpg --symmetric` |
| D-16.39 | `docs/Sistema ejemplo/` se ignora en git y el plan se copia a `docs/pasos/P16/PLAN.md` para que sobreviva a la compactación |
| D-16.40 | (P16-A1) La fórmula de neteo vive una sola vez en `shared/domain/iva/neteo.ts` y `pricing/domain/cadena-de-costo.ts` la llama; precedencia `elegirTarifa` y `TarifaDeIvaDesconocidaError` (400) al lado |
| D-16.41 | (P16-A1) `total_cost` es neto solo en las `COMPRA` nuevas; `desglose_conocido` solo en `COMPRA`; la corrección copia los cuatro campos; CHECK `inventory_movement_desglose_coherente` |
| D-16.42 | (P16-A1) `iva_recuperable_aplicado`/`iva_tarifa_aplicada` son la foto del momento de la compra; `compras_del_mes` sigue sumando `total_cost` (neto en filas nuevas), discontinuidad dicha en ADR-024 |
| D-16.43 | (P16-A1) `company_settings.iva_compra` deja de leerse como default de `SugerirPrecio` y del lote; la columna queda hasta P16-B |
| D-16.44 | (P16-A1) CSV `MOVIMIENTOS` y `ARTICULOS` ganan `ivaTarifa` opcional; precedencia fila > artículo > grupo; sin tarifa, la fila se rechaza en el análisis |
| D-16.45 | (P16-A1) `PUT /catalogo/articulos/:id` y `PUT /catalogo/grupos/:id` se construyen aquí; los GET de lista devuelven `ivaTarifa` |
| D-16.46 | (P16-A1) `email_outbox.siguiente_intento_en` (espera 1→2→4→8 min, tope 5); estados y plantillas con CHECK; app `SELECT, INSERT` bajo tenant, despachador `SELECT, UPDATE` permisivo, back office `SELECT` |
| D-16.47 | (P16-A1) `password_reset_request(p_email, p_token_hash, p_expires_at, p_datos)` y `password_reset_consume(p_token_hash, p_ahora) RETURNS TABLE(user_id, company_id)`: el `company_id` faltaba y sin él no se puede escribir la contraseña ni revocar sesiones |
| D-16.48 | (P16-A1) El repositorio de organización encola el correo en la misma transacción que la invitación; `ReenviarInvitacion`; correos con enlace; `HORAS_DE_RESTABLECIMIENTO` en el entorno, `DIAS_DE_INVITACION` constante |
| D-16.49 | (P16-A1) `ipDelCliente` toma el último salto de `X-Forwarded-For` solo con par de confianza (IP o CIDR v4), valida que sea IP, y lo usa también el `ThrottlerGuard` global; producción con subred fija `172.28.0.0/24` y **Caddy con IP fija `172.28.0.10`, que es la única de la lista** (corrección tras la revisión adversarial: la subred entera incluía la pasarela y los demás contenedores) |
| D-16.50 | (P16-A1) `evaluarIntentos` generalizada con `PoliticaDeIntentos` y mudada a `shared/domain/acceso`; `LimitadorDeTasa` por `kind` (olvido IP 10/h · destinatario 3/h; restablecimiento IP 10/h; invitar y reenvío IP 30/h · destinatario 3/h); `rate_limit_hit.clave` es `ip:` o `correo:<sha256>`; 429 con `Retry-After` |
| D-16.51 | (P16-A1, **pendiente de ratificar**) Una preparación (`PRODUCIDO`) no lleva IVA de compra: su precio nace con `ivaCompra = 0` ignore lo que diga su grupo, y otra tarifa es 400. Su costo estándar ya es neto (R10) y `CostosDeItems` lo neteaba otra vez. ADR-024, decisión 5 |
| D-16.52 | (P16-A1) «Toda COMPRA nueva nace con desglose» es guarda de **aplicación** (`exigirDesgloseEnCompra` en `comoFila`, la única puerta del libro), no trigger: un trigger sobre `recorded_at` habría roto las siembras SQL y la prueba de la fila vieja. El SQL a mano queda fuera, y dicho. ADR-024, decisión 4 |
| D-16.53 | (P16-A1) `email_outbox.datos` (el enlace con el token en claro, mientras el correo está en vuelo) solo lo lee `costeo_despachador`: `costeo_app` y `costeo_backoffice` tienen `SELECT` **por columnas**, todas menos esa. Cifrar el campo con clave del despachador se descartó con señal: más de un operador con acceso a la base. ADR-025, decisión 4 |
| D-16.54 | (P16-A1) El aviso de bloqueo del login **se encola** (plantilla `BLOQUEO`, `datos = {}`) en vez de salir por `MailerPort` desde la API; `DependenciasDeIam` no inyecta `MAILER_PORT`. «La API solo encola» pasa a ser cierto |
| D-16.55 | (P16-A1) El canal de tiempo residual de `/olvido` (dos `INSERT` con usuario, ninguno sin él) se **reconoce y se acota** —límite de tasa y una prueba de medianas < 50 ms—, no se finge escribiendo en el ramal vacío. ADR-025, decisión 3 |
| D-16.56 | (P16-A1) El token de restablecimiento **se gasta antes** de validar la contraseña (una débil obliga a pedir otro enlace); `password_reset_consume` exige `ACTIVE`; el correo del usuario se lee bajo tenant tras consumir, en vez de ampliar el retorno de la definer |
| D-16.57 | (P16-A1) `GRANT SELECT ("at")` —solo la columna— sobre `rate_limit_hit` al despachador, lo mínimo para que el `DELETE … WHERE at < …` funcione sin leer una clave; y `email_outbox.user_id → app_user` con clave foránea (el plan solo nombraba `company_id`) |
| D-16.58 | (P16-A1) `FOR UPDATE SKIP LOCKED` lleva al lado una **reserva** de 5 min en `siguiente_intento_en` (el bloqueo de fila muere al confirmar y el envío ocurre fuera), **renovada fila a fila** con la firma de la pasada; cero filas = otra instancia la tomó y se cede. Un fallo al **marcar** un correo aceptado sube sin pasar por `marcarFallo`. ADR-025, decisión 6 |
| D-16.59 | (P16-A1) El despachador **no usa `enableShutdownHooks()`**: la señal solo hace `detener()`, la pasada termina, después se cierra el pool y sale con 0. Regla `despachador-sin-ganchos-de-nest` en `audit:forbidden` |
| D-16.60 | (P16-A1) En producción el despachador **rechaza `fake`** (marcaría `ENVIADO` lo que nadie recibió); `consola` es el valor de desarrollo; `resend` sin `RESEND_API_KEY`/`RESEND_REMITENTE` no arranca; la API también conoce `RESEND_*` (el `.env` es uno) aunque no envíe. `mailer.provider.ts` decide para los dos procesos |
| D-16.61 | (P16-A1) `GET /correo/salud` del back office **sin motivo y sin fila en `backoffice_access_log`**: contadores e instantes, ningún dato de ningún tenant; un motivo obligatorio se rellenaría con «salud» y enterraría los accesos que importan. Sigue exigiendo sesión de operador |
| D-16.62 | (P16-A1) Contar y anotar el golpe son **una transacción por clave** bajo `pg_advisory_xact_lock(hashtext(kind), hashtext(clave))` (leer-luego-escribir dejaba pasar 30 de 30 simultáneas); la lectura se acota a `golpesQueDeciden = umbral × escalones + 1`; `system.ratelimit.exceeded` es **de transición** (una fila por ronda, `abreBloqueo`), no por rechazo. ADR-026, decisión 5 |
| D-16.63 | (P16-A1) La IP entra en los **casos de uso** (`SolicitarRestablecimiento`, `RestablecerContrasena`, `InvitarUsuario`, `ReenviarInvitacion`) y el límite corre como primera línea; en el reenvío la IP cuenta aunque el usuario no exista. `auth.password.reset_requested`/`reset_completed` llevan la IP |
| D-16.64 | (P16-A1) `Retry-After` sale para **cualquier** `ErrorDeDominio` con `reintentarEnSegundos` (el filtro mira la forma); `AccesoBloqueadoError` (login, P1) no lo trae aún: una línea y una prueba, deuda dicha en ADR-026. `api` gana `image: costeo-api:local` y `correo` la reutiliza sin `build`; `desplegar.sh` crea los roles en el paso 5/8 antes de migrar |
| D-16.65 | (P16-A2) **Synchronizer token, no double-submit.** El token vive en la fila de la sesión y viaja en el cuerpo; una segunda cookie legible sería el mismo canal que se está protegiendo, y dependería de que nadie pueda escribir cookies del sitio — que es justo lo que un subdominio comprometido sí puede. ADR-021 |
| D-16.66 | (P16-A2) **En claro en `session.csrf_token`.** No es una credencial de acceso, y guardarlo hasheado impediría `GET /auth/sesion`, que es lo que evita rotarlo en cada recarga. Riesgo aceptado y escrito: un volcado de `session` revela tokens CSRF vivos, que sin la cookie no habilitan nada |
| D-16.67 | (P16-A2) **La sesión sin token es inválida (401), no una sesión que no puede mutar (403).** Sin relleno de las filas viejas: el despliegue cierra las sesiones abiertas, y a cambio `csrfToken` es `string` y no `string | null` en todo el código de encima |
| D-16.68 | (P16-A2) **El back office lleva su propio token**, con guard y columna propios. Lo que hoy lo protege —`cors: false`, el `Content-Type` de su propia página, el loopback tras el túnel SSH— son propiedades accidentales del despliegue de hoy; el token no depende de ninguna |
| D-16.69 | (P16-A2) **No se implementa la verificación de `Origin`/`Referer`** que SEGURIDAD.md §4.2 llama «capa extra»: duplicaría la lista blanca de CORS, que en desarrollo y en las pruebas está vacía y obligaría a un «si está vacía, pasa» que **falla abierto**; el back office no tiene lista que consultar; y `supertest` no manda `Origin`. **Señal para reabrirlo:** un cliente que no sea `apps/web`, o el back office publicado fuera de loopback |
| D-16.70 | (P16-A2) **Un único helper de integración, `test/soporte/csrf.ts`**, y solo porque el problema es de *correspondencia* y no de comodidad: las suites manejan hasta cuatro sesiones a la vez y toda mutación necesita cookie y token **emparejados**. `servidor()`, `sembrarTenant()` y `entrar()` se siguen copiando por archivo |
| D-16.71 | (P16-A2) **La comparación se hace sobre los SHA-256 de los dos lados**, no sobre los tokens: `timingSafeEqual` lanza con longitudes distintas, y comprobar la longitud antes sería un oráculo del tamaño del token bueno |
| D-16.72 | (P16-A2) **El token del frontend vive en `lib/csrf.ts`** (módulo con estado) y no en el contexto de React, porque `api.ts` se ejecuta fuera de React y no puede leer un contexto |
| D-16.73 | (P16-A2) (revisión) **Volver a entrar NO cierra las sesiones anteriores**, y así se documenta. Implementarlo para que la 🔴 fuera verdad rompería el uso multidispositivo y sería otra decisión del usuario. Lo que la generación por sesión garantiza —y es lo que importa contra la fijación— es que **el token nunca lo elige el cliente** |
| D-16.74 | (P16-A2) (revisión) **La API analiza SOLO `application/json`** (`bodyParser: false` + `useBodyParser('json')` en `bootstrap.ts`). Cierra el *login CSRF* —un `<form>` cruzado llegaba a analizarse— sin lista de orígenes y sin tocar D-16.69. Precio: ningún endpoint podrá recibir un `<form>` nativo; el día que haga falta, la respuesta es un token en campo oculto, **no** reencender el analizador |
| D-16.75 | (P16-A2) (revisión) **El proceso del back office se queda con sus dos analizadores de cuerpo.** Su `NestFactory.create` vive en `backoffice.ts`, que ninguna suite monta, así que cambiarlo sería código de producción sin prueba. **Señal:** que se publique fuera de loopback, o que su lanzador entre en una suite |
| D-16.76 | (P16-A2) **Los «tres errores → 400» son `IdentificadorInvalidoError`, `UnidadDeUsoInvalidaError` y `ValorDecimalInvalidoError`.** El plan no los nombra; son las tres familias que extienden `Error` a secas, son alcanzables desde HTTP y no se traducían |
| D-16.77 | (P16-A2) **La traducción va en el DOMINIO, no en un `if` del filtro.** Las tres clases pasan a `ErrorDeDominio`; `error.filter.ts` no se toca para esto, que es la señal de que el diseño de P0 era el correcto |
| D-16.78 | (P16-A2) **`EscalaExcedidaError` se queda en 500.** No es del borde: es un desbordamiento a mitad de cálculo. Lo que se cierra es su camino de entrada, con la guarda de decimales en `desdeCadena`. Un 400 ahí enmascararía un bug del motor y le quitaría la traza al log |
| D-16.79 | (P16-A2) **El valor citado en un mensaje de error se recorta y se limpia** (`valorParaMensaje`): desde que estos errores son 400, ese texto vuelve al cliente y acaba en una línea de log, que un salto de línea partiría en dos |
| D-16.80 | (P16-A2) **`PERIODO_SIN_DATOS` reemplaza al código anterior en esa clase**, no se añade al lado. Mismo estado (404), distinto `code`. Es un cambio de contrato y se acepta porque el único cliente es `apps/web` y no lo leía |
| D-16.81 | (P16-A2) **`.strict()` en los ocho esquemas de consulta, sin excepciones**, y los dos comentarios que defendían lo contrario se reescriben con su refutación en vez de borrarse |
| D-16.82 | (P16-A2) **CORS gana también `exposedHeaders` y `maxAge`**, que no estaban en la línea del plan: el mensaje de error pide citar una cabecera que el navegador no podía leer, y sin `maxAge` toda mutación son dos viajes en una aplicación que se usa de pie en una bodega |
| D-16.83 | (P16-A2) **El nombre del producto se une en APLICACIÓN**, no en el repositorio ni en el dominio: al borde y sin consulta nueva en menu engineering; pidiéndoselo a `recipes` con `ListarProductos` en ventas, en vez de meter un `JOIN` a `product` en un repositorio que declara tocar solo sus dos tablas |
| D-16.84 | (P16-A2) **Una suite nueva para el borde (`frontera-http.spec.ts`) y otra para CORS (`cors.spec.ts`).** La segunda es obligada —necesita una app con orígenes declarados, y la regla es una app de Nest por archivo—; la primera es una elección: esas reglas no son de ningún módulo y se rompen todas a la vez |
| D-16.85 | (P16-A2) (revisión) **El 4xx de dominio deja rastro en el log, en nivel `debug`.** Se descartó rebajar la promesa de `error-de-dominio.ts`: el campo `detalle` existía, la promesa llevaba desde P0 escrita y cumplirla costó una función pura de cuatro líneas. No sube a `warn`: un 4xx no es un incidente |
| D-16.86 | (P16-A2) (revisión) **El mensaje de las claves sobrantes se escribe aquí y no se hereda de Zod**, que es texto en inglés dentro de un mensaje en español y, sobre todo, un eco sin recorte de lo que llegó por el cable. Se nombran tres claves y se dice cuántas eran |
| D-16.87 | (P16-A2) (revisión) **La prueba que discrimina se escribe con `toBe` sobre la lista entera**, no con un `not.toContain`: eso pasaría también con `X-CSRF-Token` fuera de la lista y todas las mutaciones rotas desde el navegador |
| D-16.88 | (P16-A2) **`GET /catalogo/unidades` publica `{ codigo, nombre, dimension }` y no el factor a base.** Hay dos lecturas de `unit` —`unidades()` para el dominio, `listarUnidades()` para el borde— porque lo que cada consumidor necesita es disjunto; fundirlas metería presentación en `UnidadDelCatalogo`, que es dominio puro |
| D-16.89 | (P16-A2) **Las unidades van en su propio controlador.** No es un recurso del tenant: es una tabla global y de solo lectura para la aplicación, y tenerlo aparte es lo que evita que alguien le cuelgue un `POST` |
| D-16.90 | (P16-A2) **La ficha del ítem trae el grupo entero y los artículos; la del artículo trae el ítem entero.** Una llamada por pantalla, y la ficha es un superconjunto de la fila de la lista (`grupoId` se queda junto a `grupo`) para que el cliente no necesite dos tipos |
| D-16.91 | (P16-A2) **Un recurso de otra company es 404 con el mismo texto que uno inventado**, y hay una prueba que compara los dos mensajes. La pertenencia va en el WHERE de cada lectura, nunca en un `if` posterior |
| D-16.92 | (P16-A2) **La comprobación de «esa unidad existe» se unifica en `catalog/domain/catalogo-de-unidades.ts`** y los cuatro llamantes comparten el mensaje que enumera las válidas. Antes había tres versiones y solo una servía para corregir |
| D-16.93 | (P16-A2) **`ResultadoDeLoteDeArticulos` vive en el puerto del catálogo**, no como variante del `ResultadoDeLote` compartido: los otros tres módulos que reciben lotes no pueden toparse con ese caso, y una rama muerta que el compilador exige se lee como si pudiera pasar |
| D-16.94 | (P16-A2) **El rescate de un `P2002` de lote relee en una transacción NUEVA.** La que falló está abortada y dentro de ella ya no corre ninguna consulta; y si la relectura no encuentra ningún nombre, el error original se relanza en vez de devolver una lista vacía |
| D-16.95 | (P16-A2) **Las tres rutas nuevas no llevan prueba de 403 porque no existe tal rol**: los cinco tienen `catalog.read` desde P2. Lo que se prueba en su lugar es que sin sesión no hay lectura y que `GERENTE_LOCAL` sigue sin poder escribir |
| D-16.96 | (P16-A2) (revisión) **El rescate del `P2002` vive en `shared/infrastructure/persistence/rescate-de-choque.ts`, no dentro del repositorio**: sus tres ramas no se pueden provocar a voluntad contra PostgreSQL, y fuera del repositorio se prueban con la base apagada. `esViolacionDeUnico` sustituye al `esDuplicado` local del catálogo |
| D-16.97 | (P16-A2) (revisión) **El choque de nombres de los lotes sigue ignorando mayúsculas y espacios de sobra, y el mensaje lo dice.** Comparar byte a byte como el índice rompería la coherencia con la deduplicación dentro del archivo; un índice único sobre `lower(btrim(name))` es una migración que puede chocar con datos ya escritos en los tenants existentes, y eso no cabe en la corrección de una revisión |
| D-16.98 | (P16-A2) (revisión) **Una prueba de §4.3 fija las claves exactas y compara con el rol que lo ve todo.** Una lista de nombres prohibidos solo puede crecer por detrás de los campos; un `toEqual` de claves obliga a decidir sobre cualquier campo nuevo el día que aparece, y comparar con `ADMIN` cubre el fallo contrario: la proyección mutilada |
| D-16.99 | (P16-A2) (revisión) **Cada fila 🔴 de `guardas-de-dominio.md` cita, desde ahora, el archivo de prueba de su 4xx.** M11 solo alcanza a los `CHECK` y a los `RAISE`; las claves foráneas y los índices únicos no tienen dónde llevar el `-- GUARDA:`, y por esa grieta entró la tercera recurrencia de INC-012. Las filas anteriores a P16-A2 se completan a medida que se tocan |
| D-16.100 | (P16-B) `product.version` e `item.version` (entero ≥ 1). Toda escritura del agregado exige `version` en el cuerpo y la sube en la misma sentencia condicionada; cero filas → se relee para distinguir 404 de 409. Agregado producto = maestro + `product_location` + `combo_component`. Las escrituras protegidas responden 200 `{ version }`. ADR-023 |
| D-16.101 | (P16-B) La receta se protege con `basadaEn` = id de la última versión creada de ese destino en esa ubicación (o `null`), bajo `pg_advisory_xact_lock`; `GET /recetas` y `/recetas/versiones` publican `ultimaVersionId`. `recipes` no puede escribir `item`, y así la receta no hereda la deuda de D-16.20 |
| D-16.102 | (P16-B) Las cargas en lote no exigen versión pero la suben (combos del lote de recetas) |
| D-16.103 | (P16-B) Artículos y grupos no llevan versión (D-16.13). Señal: el primer cambio perdido en uno de los dos |
| D-16.104 | (P16-B) `CONFLICTO_DE_VERSION` (409) no trae la versión actual en el cuerpo: pide recargar |
| D-16.105 | (P16-B) El semáforo por bandas se muda a `shared/domain/indicadores/semaforo.ts`; `GET /costeo` publica `semaforoFoodCost` con los umbrales de la company y la pantalla deja de decidir el color (D-16.3) |
| D-16.106 | (P16-B) `costos.lineas` solo con `recipe.read` en la sesión; si no, `null` (defensa en profundidad) |
| D-16.107 | (P16-B) `GET /costeo/:productId?pvp=` recalcula solo el lado de venta con `ladoDeVenta`, sin escribir; la respuesta lleva `pvpSimulado` |
| D-16.108 | (P16-B) `GET /precios/pendientes`: nombres unidos en aplicación, `precioVigente` al lado, cursor por `id` (1..200, 50) |
| D-16.109 | (P16-B) Se retira `company_settings.iva_compra` (D-16.43): columna, `CHECK` y semilla; `PUT /ajustes` deja de aceptarla. El `down` la devuelve con 0.15 |
| D-16.110 | (P16-B) Precio, PVP y rendimiento por lote cero o negativos → 400 en esquema y dominio (posible cuarta recurrencia de INC-012; se confirma con prueba antes de arreglar) |
| D-16.111 | (P16-B) Las cinco consultas con `@Query` crudo pasan a `EsquemaPipe` `.strict()` (deuda de P16-A2) |
| D-16.112 | (P16-B) Ítem de empaque inexistente → 400 `ENTRADA_INVALIDA`, no 404 de producto |
| D-16.113 | (P16-B) `GET /productos/:id/ubicaciones` filtra por alcance; `GET /productos/ubicaciones?locationId` exige la ubicación en alcance |
| D-16.114 | (P16-B) `PUT /productos/:id/componentes` reemplaza la lista entera con la versión del combo: destino `COMBO`, componentes `SIMPLE`, sin repetir, sin sí mismo, cantidad > 0, máximo 50 |
| D-16.115 | (P16-B) **`reference_price(company_id, status)` pasa a `(company_id, status, id)`**, dentro de la migración del paquete. La bandeja pagina por `id` y con el índice de P3 el planificador recorría la clave primaria filtrando: su coste dependía de dónde cayeran los sugeridos. Sustituye y no se suma: el prefijo sirve a las lecturas por estado de antes. Dos planes en `docs/pasos/P16-B/AUDITORIA-RESULTADO.md` |
| D-16.116 | (P16-B) **Las 🔴 de carrera no usan `Promise.all`**: bloquean la fila desde otra conexión (`FOR UPDATE`), esperan en `pg_locks` a que las N escrituras estén paradas (`test/soporte/bloqueos.ts`) y sueltan. Con `Promise.all` un leer-comparar-escribir pasaba igual (guardián G10). P16-C lo usa para `period.version` |
| D-16.117 | (P16-B) **`npm run bench` compila la API antes de medir** (`tsc --build`, antes de crear la base). Medía `dist/bench.js` tal como estuviera: INC-007, caso 12 |
| D-16.118 | (P16-B) **`GET /recetas` cambia de forma** a `{ vigente, ultimaVersionId }` sin versión de API: ningún cliente la consumía. `ultimaVersionId` es la última CREADA, no la vigente |
| D-16.119 | (P16-B) **La presentación `"0"` de un artículo no fue recurrencia de INC-012**: `problemaDeConversion` la paraba desde P2 (guardián G7). La fila de `guardas-de-dominio.md` pasa a 🔴 con las dos capas y la prueba se retituló |
| D-16.120 | (P16-B) **`costos.lineas: null` sin `recipe.read` se prueba con una unitaria de la presentación**, no de integración: hoy ningún rol tiene `costing.read` sin `recipe.read`, así que ninguna petición llega a esa rama |
| D-16.121 | (P16-C) `period.version` la suben **solo las dos cargas del mes** (ventas y costos fijos), que comparten testigo; ni movimientos, ni cierre, ni reapertura, ni conteo. Condición en el `WHERE`, misma transacción que el reemplazo. 409 espurio posible entre ventas y costos del mismo mes: deuda como D-16.20 |
| D-16.122 | (P16-C) Un mes sin fila de período se lee con `version: 1`, la que tendrá al crearse |
| D-16.123 | (P16-C) `GET /analitica/ventas` → `{version, ventas}` y `GET /analitica/costos-fijos` → `{version, costos}`; los `POST` exigen `version` y responden 200 `{version}`. **`/ventas` mandaba solo las filas cambiadas a un reemplazo total** (borraba las demás): se arregla en este paquete (D-16.1) |
| D-16.124 | (P16-C) `consolidado.estadoDelPeriodo` y `cerradas`/`abiertas` salen de `period.status`, no de si hubo conteo |
| D-16.125 | (P16-C) `GET /inventario/movimientos/:id` (`inventory.read`, alcance por la ubicación del movimiento) y `?tipo=` con los siete tipos |
| D-16.126 | (P16-C) `GET /usuarios` (`user.read`) por alcance; `correoInvitacion` = último correo `INVITACION` solo de `INVITED`, `null` sin fila; nunca `datos` |
| D-16.127 | (P16-C) `PUT /ubicaciones/:id` edita `nombre` y `tipo`; sin `estado` (INACTIVE no tiene efecto hoy) y sin versión; 409 por nombre; **la de otra company es 403, no 404**, como toda ruta por ubicación desde P15; evento `location.updated` |
| D-16.128 | (P16-C) `GET /roles` (`user.read`) con `requiereUbicacion` y `permisos` |
| D-16.129 | (P16-C) **La hoja de conteo (`PUT /conteos/:id/lineas`) es reemplazo total sin versión**: duda abierta para el usuario (D-16.11 frente a D-16.13) |
| D-16.131 | (Armazón) **`useCarga(leer)` y `useLectura(ruta)`**: el resultado recuerda qué lectura lo produjo y una respuesta de otra se descarta; `recargar` no borra lo que se ve. ADR-022 |
| D-16.132 | (Armazón) **`Vista`** pinta los cuatro estados siempre en el mismo orden —mes sin abrir, error, cargando, vacío, datos— y exige `esVacio` y `vacio`: una pantalla ya no puede olvidar el estado vacío. ADR-022 |
| D-16.133 | (Armazón) **Permisos de `GET /auth/sesion`, una vez, cerrados por defecto**, y cada sección los declara en su `layout.tsx` con `seccion(permiso)`: `/costeo` `costing.read`, `/menu` `analytics.read`, `/ventas` `sales.read`, `/inventario` `count.write`. ADR-020 |
| D-16.134 | (Armazón) **El mes, con dos `select`** (no `<input type="month">`, que Firefox de escritorio degrada a texto); años: los cinco últimos más el de la URL; `replace`, no `push`; los enlaces laterales de las secciones con mes lo llevan. ADR-020 |
| D-16.135 | (Armazón) **Sin primitiva `Icono` todavía**: la iconografía del manual (p. 25) no se pudo leer en este equipo y §10 prohíbe deducirla. El botón del menú móvil dice «Menú» con texto |
| D-16.136 | (Armazón) **`/` → `/inicio` va en el commit «Inicio»**: con `typedRoutes`, un `redirect` a una ruta que no existe no compila. Hasta entonces `/` y `/sucursal` mandan a `/costeo` |
| D-16.137 | (Armazón) **Sin sesión, la mutación sale sin token y decide la API** (INC-023). Descartado un flag `sinSesion` por llamada: es la lista que alguien olvida en la quinta ruta pública. ADR-022 |
| D-16.138 | (Armazón) **`typecheck` del web = `next typegen && tsc --noEmit`**: sin tipos generados, `tsc` no ve las rutas tipadas, y CI nunca los tuvo (INC-007, caso 13) |
| D-16.139 | (Armazón) **Los botones de guardar de ventas y del conteo viven en la lámina, no en las `acciones` de `Marco`**: el estado editable se monta con los datos ya leídos y el botón lo necesita. ADR-022 |
| D-16.140 | (Armazón) **`sinCerosDeSobra`** precarga las casillas editables (`19.000000000000` → `19`) sin redondear ni parsear. Sin eso, una fila guardada no se podía editar. ADR-022 |
| D-16.141 | (Armazón) **Cabecera móvil en tres filas** (marca y «Salir»; sucursal; mes) con las etiquetas ocultas a la vista y no al lector; la lateral se estira con la ventana y **sin `sticky`** hasta que la navegación exista entera. Ajustado mirando capturas. ADR-020 |
| D-16.142 | (Armazón) **Un único `as Route`**, en `usePeriodo`: `typedRoutes` no puede tipar un `pathname` que llega en tiempo de ejecución |
| D-16.143 | (Armazón) **`npm run doctor` sondea los puertos de la base** con el `SSLRequest` del protocolo (INC-015, recurrencia 1). No distingue PostgreSQL de PgBouncer, y lo dice |
| D-16.144 | (Armazón) **`alCaducarSesion` devuelve cómo quitarlo y solo quita el suyo**; lo registran el armazón y `/sucursal` con `useEntrarAlCaducar()`. ADR-020 |
| D-16.145 | (Armazón, **pedido por el usuario**) **La base de desarrollo de esta máquina se publica en el 5442**, no en el 5432, para no convivir en el puerto de siempre con los Postgres de otros proyectos. Es `.env` local (`POSTGRES_PORT` y las cinco cadenas); `.env.example`, CI y el VPS siguen en 5432. **Y moverlo destapó dos checks atados al 5432:** la guardia de «unitarias sin base» y la sonda de `audit:tests` leían `POSTGRES_PORT ?? 5432` de un `process.env` sin el `.env`, así que habrían vigilado y sondeado un puerto vacío. Las dos leen ahora las cadenas de conexión, del entorno o del archivo sin cargarlo (INC-007, caso 13) |
| D-16.146 | (P16-D, **opción (a) del usuario para la duda #12**) **`sinReceta`** en el costeo: ninguna línea `ACTIVA` en la ubicación (receta ausente, vacía o toda excluida) o, en un combo, ningún componente; semáforo `SIN_DATO` también con PVP simulado; los importes siguen saliendo en cero y la marca no entra en ninguna fórmula. SPEC §14 |
| D-16.147 | (P16-D) **La ingeniería de menú, el food cost real y el consolidado no cambian** con un plato sin receta: es otra decisión de producto (duda #13) |
| D-16.148 | (Inicio) **Las pruebas de `apps/web` con `node --test`**, sin dependencias: funciones puras de `lib/`, importes con `.ts`, corridas por `audit:tests`. Vitest en el web descartado mientras no haga falta un DOM. ADR-027 |
| D-16.149 | (Inicio) **Inicio pide `replenishment.read`** (todos los roles) y elige por permiso: resumen con `analytics.read`, reposición sin él. No se deduce del rol |
| D-16.150 | (Inicio) **`Vista` recibe `vacio: { esVacio, titulo, ayuda } \| 'nunca'`**: que una lectura no tenga estado vacío propio se escribe, no se omite |
| D-16.151 | (Inicio) **El color de un indicador lo pone `global.css` desde `data-semaforo`**, como los cuadrantes; `SIN_DATO` no lleva color. Y la brecha va en puntos (`enPuntos`), no como porcentaje |
| D-16.152 | (1b) **`/olvide` enseña la misma frase exista o no la cuenta**, sin cifras de caducidad (es configuración del servidor); el 429 sí con su mensaje |
| D-16.153 | (1b) **`/restablecer` comprueba largo (12) y repetición antes de enviar**: la API gasta el token antes de mirar la contraseña. El 12 es ayuda con su porqué; la política la decide la API |
| D-16.154 | (1b) **`useEnvio` expone `codigo`**; tras un 429 el formulario se queda (el límite va antes del token), tras cualquier 400 se ofrece pedir otro enlace |
| D-16.155 | (1b) **`lib/api.ts` se prueba con `node --test`**: importe `./csrf.ts`, `ErrorDeApi` sin propiedades de parámetro y `erasableSyntaxOnly` en el web. `fetch` se simula en `globalThis`, sin mocks de módulo (la señal de ADR-027 sigue sin cumplirse) |
| D-16.156 | (3) **La rejilla de ventas lee `GET /productos/ubicaciones`**: `product.read` lo tienen los cuatro roles con `sales.read` |
| D-16.157 | (3) **`.celda-editable` a 5rem por debajo de `60rem`**: con 7rem la rejilla desbordaba su marco a 360 px |
| D-16.158 | (4) **`/insumos` pide `GET /precios/costos` solo con `pricing.read`**: `BODEGA` lee el catálogo sin la columna ni la llamada |
| D-16.159 | (4) **Filtros de nombre y grupo en el cliente**, sobre la lista leída; «Incluir archivados» en la API |
| D-16.160 | (4) **`comoCostoDeUso`**: con parte entera, dos decimales; sin ella, hasta cuatro (se mira el texto, no se compara) |
| D-16.161 | (5) **El rendimiento se escribe en porcentaje** y viaja como fracción con `fraccionDePorcentaje` (se corre la coma en el texto); el rango lo valida la API |
| D-16.162 | (5) **Una página de alta se protege con `Permitido` dentro de la sección**: la sección pide leer (`catalog.read`), el alta pide crear (`catalog.create`) |
| D-16.163 | (5) **Tras crear, al listado** mientras no existe la ficha; la pantalla 6 cambia el destino a la ficha nueva |
| D-16.164 | (6) **Tras un 409 el formulario se monta de nuevo con lo que hay** (clave = versión): seguir con lo escrito sobre una ficha que cambió pisaría lo del otro sin verlo |
| D-16.165 | (6) **«Sin precio confirmado» es un estado de la ficha**, no un error: `GET /precios/costo/:itemId` con `RECURSO_NO_ENCONTRADO` se lee como `null` |
| D-16.166 | (6) **Las fechas se enseñan en `America/Guayaquil`** (`comoFecha`): las vigencias son instantes, y en UTC caerían en otro día |
| D-16.167 | (6) **`Volver` es genérico sobre `Route<T>`** para aceptar rutas dinámicas con `typedRoutes`, sin `as Route` |
| D-16.168 | (7) **La tarifa del grupo vacía viaja como `null` y se enseña «No define»**, nunca 0 % |
| D-16.169 | (7) **La edición de un grupo lo busca en la lista** (no hay `GET` suelto, y la lista es pequeña); un id ausente enseña su estado |
| D-16.170 | (8) **El campo de factor aparece solo si la unidad de la presentación es de otra dimensión** que la de uso (la dimensión es un dato de `GET /catalogo/unidades`); quien exige o prohíbe el factor sigue siendo la API |
| D-16.171 | (8) **La tarifa del artículo se precarga con la del grupo** si la define; vacía si no, y es obligatoria |
| D-16.172 | (8) **`CampoDePorcentaje`/`CampoDeCantidad`** sustituyen el filtro de forma repetido en cinco campos |
| D-16.173 | (9) **La bandeja se ve con `pricing.read` y se decide con `pricing.confirm`**: sugerir y confirmar pueden ser dos personas, y sin el segundo permiso no hay columna de decisión |
| D-16.174 | (9) **Una decisión que sale bien vuelve a leer la primera página y descarta las añadidas con «Ver más»** (la bandeja se monta con clave = ids de la primera página); **un 409 se queda en su fila** con el mensaje de la API, sin quitarla sola |
| D-16.175 | (9) **A 360 px la decisión se alcanza desplazando la tabla dentro de su marco**, como en el resto de tablas; los números quedan a la vista primero. Sin vista de tarjetas propia |
| D-16.176 | (10) **El `origen` que manda la pantalla es siempre `MANUAL`**: `ULTIMA_COMPRA` lo pone el sistema al registrar una compra y `EXTERNO` está fuera de alcance (D8) |
| D-16.177 | (10) **Se sugiere desde la ficha (`?itemId=`) o desde la bandeja, y al terminar se va a la bandeja**, donde se ve que falta decidirlo. IVA vacío viaja `null` (la tarifa de la presentación); `0` declara exenta. Un comprado sin presentaciones activas enseña el aviso y el enlace para crearla, no el formulario |
| D-16.178 | (10) **Los precios de referencia se enseñan con `comoCostoDeUso`** (bandeja, historial de la ficha, vigente del formulario): el de una preparación es por unidad de uso y `comoImporte` lo dejaba en `0.00`. Con parte entera el formato no cambia |
| D-16.179 | (10) **`.campo select { min-width: 0 }`**: un desplegable con opciones largas empujaba la página a 387 px en un teléfono |
| D-16.180 | (11) **El listado de productos distingue «sin configurar» de «no se vende»**: un producto que no sale en `GET /productos/ubicaciones` de la sucursal nunca se decidió ahí; uno con `activo: false` sí |
| D-16.181 | (11) **Los productos van en un grupo propio de la navegación, «Carta»**, y no en «Catálogo»: el catálogo es lo que se compra (módulo `catalog`), la carta lo que se vende (`recipes`/`products`) |
| D-16.182 | (11) **La ficha del producto es de lectura en esta pantalla**; la configuración por sucursal, el empaque, el simulador y el desglose entran en la 12 sobre la misma página. **Sin `/productos/[id]/editar`** mientras no exista qué editar del maestro (duda #14) |
| D-16.183 | (12) **La ficha es la página de trabajo del producto**: costo (`costing.read`), configuración en la sucursal del selector y empaque (`product.write`) y la tabla de sucursales, cada bloque con su permiso. Sin páginas de edición aparte |
| D-16.184 | (12) **Tras cada escritura se relee la ficha y los bloques se remontan con clave `bloque-sucursal-versión`**: el costo se recalcula con lo guardado y ningún formulario conserva la versión vieja. **Una clave distinta por hermano** (INC-026) |
| D-16.185 | (12) **El simulador enseña la venta simulada debajo de la real, no en su lugar**, y no se ofrece sin receta: simular un food cost sobre nada es el número plausible y falso de la duda #12 |
| D-16.186 | (12) **El desglose pone la unidad del catálogo a cada cantidad** (la ficha lee los insumos con archivados), y el costo enseña **con provisión de merma** entre porción y empaque para que la suma se lea |
| D-16.187 | (13) **Los editores de listas (componentes, y después receta) tienen página propia**, enlazada desde la ficha; los datos sueltos (PVP, empaque) se editan en la ficha (D-16.183). Un reemplazo total necesita su copia de trabajo y un «Guardar» único |
| D-16.188 | (13) **El editor ofrece como componente solo productos con receta activos, más los que ya estén**, sin el propio combo; lo que no vale lo sigue diciendo la API. Un combo sin nada que costear se anuncia como **«Sin componentes»**, no como «sin receta» |
| D-16.189 | (14) **Una sola página de receta para producto y preparación**, con el destino como unión (`producto`/`item`) igual que la API; un combo y un insumo comprado reciben el porqué en vez del editor, y sus fichas no ofrecen «Receta» |
| D-16.190 | (14) **AP y EP se preguntan en palabras de cocina** —«Tal como se compra (AP)», «Ya limpio (EP)»— con la sigla al lado y una nota de qué cambia; la unidad de uso va en la etiqueta de la cantidad |
| D-16.191 | (14) **El editor arranca de la vigente y avisa si `ultimaVersionId` es otra** (una versión con vigencia futura): guardar la deja como la más nueva. «Vale desde» es hoy por defecto, a `12:00Z` (D-16.4) |
| D-16.192 | *(libre: la numeración salta a las decisiones del usuario)* |
| D-16.193 | (usuario) **El entorno sintético tiene DOS companies**: «ensayo» (`Ensayo de Despliegue (sintetico)`, dueña `duena@ensayo.invalid`) y «ensayo-b» (`Ensayo B (sintetico)`, dueña `duena@ensayo-b.invalid`), **con los mismos nombres de datos** —«Local Centro», «Arroz», «Arroz marinero»— y cifras distintas. Cada pantalla, desde la 15 y retroactivamente en la 1–14, se verifica además como dueña de ensayo-b: (a) su listado no trae ninguna fila de ensayo; (b) la URL de una ficha con un id de ensayo responde «no encontrado» **en sitio**. Se anota «tenant cruzado ✓» en la fila de la pantalla. El procedimiento vive en `docs/pruebas/ESTRATEGIA.md` |
| D-16.194 | (usuario, P16-E) **La unicidad del nombre de producto es por `(company_id, nombre)`** —el índice `product_company_id_name_key`— y el conflicto sale de ahí. Verificado y **corregido de paso**: el caso repetido devolvía **400** y la documentación de la API decía 409; ahora es 409 `CONFLICTO` (`ProductoRepetidoError`), como el nombre repetido del catálogo. 🔴 en `productos.spec.ts`: el mismo nombre en dos companies son dos 201 |
| D-16.195 | (usuario) **El runbook de respaldos gana la restauración POR TENANT** (dump → base auxiliar → filas de una company → reinserción con RLS), documentada y probada sobre ensayo-b **antes de la parada del piloto**. La restauración completa queda para la pérdida total. **Hecho en P16-G**: `npm run restaurar:tenant`, sin un solo `WHERE company_id` —el recorte y la validación los hace RLS—, con guardián contra el catálogo, recuentos comparados y aviso de los ajustes de costeo (que la aplicación no puede insertar: los crea el trigger). Simulacro completo sobre ensayo-b. De paso, **INC-028**: el respaldo moría sin mensaje al pasar de 512 MiB |
| D-16.196 | (usuario, sobre D-16.17/D-16.24) **El límite por destinatario es el principal; el de IP se calibra para IPs compartidas (CGNAT)**: umbral alto y solo 429, nunca bloqueo escalonado por IP sola. **Revisado: sí podía** —25 fallos de una sola cuenta dejaban fuera la IP entera hasta una hora—. **Hecho en P16-F**: el eje de IP cuenta **cuentas distintas** (10/hora), responde **429 con 15 minutos fijos** y no escala; el eje de cuenta no cambia. **ADR-028**, **INC-027**, migración `p16f_limite_de_ip_en_login` (un tipo de evento: `auth.login.ip_limited`), 🔴 en dominio, caso de uso y HTTP |
| D-16.197 | (usuario) **`app_user.email` es único GLOBAL** (`app_user_email_key`, sobre `email` a secas), verificado en el esquema. Una persona no puede existir en dos companies con el mismo correo. Queda registrado como decisión pendiente **«usuario en varias companies»** (duda #15), con plazo **antes de la segunda licencia vendida**. No se construye en esta pasada |
| D-16.198 | (usuario) **El simulacro de restauración por tenant se repite sobre un tenant CON libro y CON un período CERRADO**: sembrar ensayo-b con movimientos y cerrar un mes antes del respaldo. Si `inventory_movement_respeta_periodo_cerrado` rechaza la reinserción, el script resuelve el orden **sin saltarse RLS ni el trigger** (períodos reinsertados abiertos y cerrados al final, en la misma transacción). **El runbook no dice «probado» hasta que este simulacro pase**; evidencia en `CONSTRUCCION.md`. *(pendiente: commit propio)* |
| D-16.199 | (usuario, sobre D-16.196) **El eje de IP cuenta solo cuentas distintas CON fallos, nunca intentos, y el umbral sube a 50 por hora**: diez las junta cualquier lunes detrás de un CGNAT o del wifi de un centro comercial, y limitarlas es el daño que el eje existe para no causar. **Hecho en P16-F2**: 🔴 doce cuentas no limitan · 🔴 cuatrocientos fallos de diez cuentas siguen siendo diez · 🔴 cincuenta sí, sin escalada. El porqué del número, en **ADR-028** |
| D-16.200 | (usuario, SPEC §24) **Toda importación que escriba en el libro es reversible como importación**: cada movimiento importado lleva `import_job_id`; `POST /importaciones/:id/anulacion` emite los movimientos de signo contrario en una sola transacción (R3), respeta período cerrado (409 con motivo) y deja la importación en `ANULADA`. 🔴: importar, anular, y el saldo del tenant queda como antes. *(pendiente: commit propio)* |
| D-16.130 | (P16-C) **`IdentificadorDeRuta`**, un pipe propio que lanza el error del dominio, en los **24** `@Param` de la aplicación. No `ParseUUIDPipe`: respondía `BAD_REQUEST` y el contrato es `ENTRADA_INVALIDA`; el único que lo usaba (`reenvio-de-invitacion`) pasa al mismo `code`. El back office conserva el de Nest |

### P17 · P18 · P19 — diferidos por decisión de producto, no por bloqueo técnico

| SPEC | Qué se escribe | Preguntas abiertas para el usuario |
|---|---|---|
| §22 Butcher test | Fórmulas de rendimiento equivalente; sugiere, no aplica | Equivalente vs físico (R12) |
| §23 Recepción HACCP | Acta + `COMPRA` en la misma `run()`; `RECHAZADO` no toca el libro; acta inmutable; neteo por D-16.9 | Devoluciones; actor cuando registra BODEGA |
| §25 USAR + §26 multimodelo | Plan de cuentas; **R15: `EBITDA_USAR − utilidad_operativa = 0.00`**; Miller/Pavesic ponderados; ABC con `labor_minutes` | 5000 teórico o real; cargas sociales; mapa categoría → cuenta |

### Parada «entrega al piloto» — las cinco evidencias

1. Respaldo automático **cifrado con `age`**, copiado fuera del VPS, y restauración completa probada en base vacía **desde la copia remota, descifrado incluido, con una copia de la clave distinta del equipo de origen**.
2. Invitación real entregada a una bandeja real del piloto, **fuera de spam**.
3. Datos del piloto cargados con `npm run importar`; `iva_compra_recuperable` fijado **según su contador**.
4. Tres productos del piloto con costo conocido, contrastados contra `GET /costeo`, **diferencias explicadas por escrito**.
5. Las 27 capturas (1280 y 360 px, por rol) y `npm run medir-bundle` en verde.

**Lo que solo el usuario aporta, y la parada espera a ello:** VPS, destino remoto del respaldo, la clave privada en dos copias, dominio, cuenta de Resend con DKIM/SPF/DMARC, datos del piloto y la confirmación del contador.

---

### EL PROYECTO CAMBIÓ DE MODO — leer esto antes que nada

**Hay fecha comercial: un restaurante tiene que estar usando el sistema.** Eso cambió el ALCANCE, no
el estándar del motor. `apps/api` conserva las 7 fases, la auditoría completa y un commit por
paquete; **el frontend no** —allí no vive ninguna regla de negocio— y va con tipos, lint y un commit
por pantalla.

### Dónde se retoma exactamente

**(Escrito al cerrar P14b; el 2026-09-09 el usuario abrió la Pasada P16, arriba: SÍ queda código.)** El hueco del despliegue del frontend está cerrado. `apps/web` tiene
su `Dockerfile`, su servicio en `docker-compose.prod.yml` y su enrutado en Caddy, y la pila entera
—base, pooler, API, interfaz y proxy— **se levantó y se recorrió de punta a punta en local**: login,
catálogo importado, costeo mirado en pantalla, ventas cargadas y respaldo restaurado.

**Lo que falta son cinco cosas, y ninguna es código:** el DNS, el VPS, los secretos, el archivo del
tenant y el catálogo del cliente. La secuencia exacta, con su comprobación por paso, está en
**`docs/runbooks/puesta-en-marcha.md`**. La plantilla del tenant, en
`docs/plantillas/tenant.ejemplo.json`.

> **Y lo más importante que dejó el ensayo:** encontró **tres fallos** —INC-018, INC-019, INC-020—
> que llevaban días puestos con los doce checks en verde encima. Ninguno lo habría visto una revisión
> de código. **Hay una clase de fallo que solo aparece ejecutando el sistema entero como se va a
> ejecutar de verdad**, y por eso el paso 0 del runbook de puesta en marcha es repetir el ensayo.

### El producto se llama PLATISE

Cerrado en P14 leyendo `docs/Manual de Marca/platise-brand-book.pdf`, que lo publica desde agosto de
2026. **D1 pasa a ✅.** El nombre comercial es Platise y la firma es «El margen, plato por plato.»;
el repositorio, los paquetes y los roles de base de datos siguen llamándose `costeo-saas` /
`costeo_app`, que es infraestructura y no se toca.

### Lo hecho en el sprint

| Fase | Qué | Commits |
|---|---|---|
| **A** | P10 — importación acotada, y el MC de referencia | `b9c4403`, `a7d6aa1` |
| **B** | Despliegue decidido (ADR-016) y cadena de respaldo probada | `1e71e7f` |
| **C** | Las cinco pantallas | `2813068`, `851f3ad`, `e04b761`, `8d9d24d`, `61d64e4` |
| **D** | Guion de la sesión y comprobación previa | `61d64e4` |
| **Pospuestos** | P15 endurecimiento, P11 back office, P13 su interfaz, P14 capa visual | `c4450e7`, `a5512b8`, `ac4eb97`, y el de P14 |

### Lo que un «tú» futuro necesita saber del sprint

**1. Dos fallos serios aparecieron SOLO al usar el sistema de verdad, no en las pruebas.**

| Fallo | Cómo se veía | Por qué ninguna prueba lo vio |
|---|---|---|
| `SugerirPreciosEnLote` rechazaba TODAS las filas, cada una con un UUID por «motivo» | `articuloDe` devolvía `PurchaseArticleId \| null \| string` y discriminaba con `typeof === 'string'` — pero **`PurchaseArticleId` ES un string marcado**, así que un artículo ENCONTRADO se trataba como error | Ninguna prueba importaba precios con artículo |
| `combo_component` llevaba seis paquetes con lectura y sin escritura | Un combo se creaba y jamás se componía: costaba cero | `audit:deadcode` mira exports de TypeScript, **no rutas de escritura a la base** |

**La lección del primero, que vale para todo el proyecto: `typeof` no discrimina cuando uno de los
éxitos también es una cadena.** Con tipos marcados eso pasa más de lo que parece.

**2. Un check de CÓDIGO MUERTO encontró un agujero de SEGURIDAD.**
knip señaló `MAXIMO_BYTES` y `MAXIMO_DE_FILAS` como exports sin usar. No eran código muerto: eran los
topes de `SEGURIDAD.md` §5.1 **declarados y desconectados**. **Cuando knip señale una constante de
configuración, pregunta si es que sobra o es que no se aplicó.**

**3. El respaldo es nuestro, y por eso se prueba restaurándolo.**
`npm run respaldo` vuelca, **restaura sobre una base desechable y compara los recuentos** de cinco
tablas testigo. Si no cuadra, **no guarda el archivo**. Probado con 4.812.678 filas del libro. Los
respaldos de Hostinger son semanales; los nuestros, diarios con WAL — y el script sale con error si
`RESPALDO_COMANDO_SUBIDA` está vacío, porque un respaldo en la máquina que puede morir no es un
respaldo.

**4. El frontend tiene una regla de ESLint que hace cumplir «los decimales son cadenas».**
`parseFloat` y `Number()` sobre un campo de la API **rompen el build**. Es la única forma de que esa
regla sobreviva a la prisa. Ya cazó un caso real: la conversión a porcentaje truncaba, y `0.2799`
salía «27,9 %» pintado de verde con el umbral en 28 %.

**5. CORS estaba desactivado con el comentario «en P0 no hay frontend».** Ahora lo hay. Lista blanca
exacta desde `CORS_ORIGENES`, validada **campo a campo** y no en un refinamiento del objeto (INC-008).
El origen con barra final es el que cuesta media tarde: el navegador nunca la manda.

**6. Next escribe un `CLAUDE.md` dentro de `apps/web` en cada arranque.** Desactivado con
`agentRules: false`. Un segundo archivo con ese nombre, generado por una herramienta y sin revisar,
es justo la ambigüedad que el `CLAUDE.md` del proyecto existe para impedir.

### Lo que un «tú» futuro necesita saber del ENSAYO DE DESPLIEGUE (P14b)

**Se levantó la pila de producción entera en local —`docker-compose.prod.yml` con `DOMINIO=localhost`—
y se recorrió el camino completo del cliente.** Encontró tres fallos. Los tres llevaban días puestos,
con los doce checks en verde, y ninguno lo habría visto leer el código.

**1. La imagen de la API llevaba DOS DÍAS sin poder construirse, y el despliegue salía «healthy».**
P10 creó `apps/api/parser/` y el `Dockerfile` nunca lo copió, así que el `tsc` de dentro de la imagen
moría con `Cannot find module`. Lo grave no es eso: es que **`docker compose up -d --build` no aborta
cuando el build falla** — deja el contenedor anterior corriendo, su comprobación de salud sigue en
verde y el despliegue parece haber funcionado mientras sirve el código de dos días antes.

Se descubrió por la puerta de atrás: un endpoint devolvía menos campos de los que su DTO declara.
**INC-018.** Prevención automatizada: `dockerfile-no-copia-lo-que-el-codigo-importa`.

> **Nunca despliegues con `up -d --build`.** El script construye con `docker compose build` en su
> propio paso, y `set -e` aborta si falla.

**2. `npm run respaldo` volcaba la base `postgres`, que está vacía.**
Regresión de P15: `jscpd` empujó a extraer `conexionDeSuperusuario()` a `lib/entorno.mjs` y la base de
destino se fijó a `postgres`, que es lo que necesitaban `bench` y `restaurar` —los dos reapuntan a su
base desechable— pero no `respaldo`, que la usaba tal cual. **INC-019.**

Lo salvó que las tablas testigo sean de negocio: falló ruidosamente porque `inventory_movement` no
existe allí. Con tablas creadas y vacías habría dicho «0 filas, cuadra» cinco veces.

> **Cuando `jscpd` empuje a extraer algo, la pregunta no es si las tres copias son iguales: es si
> SIGNIFICAN lo mismo.**

**3. El semáforo de food cost decidía al revés, y llevaba así desde la Fase C.**
`localeCompare` con `numeric: true` **no compara decimales**: compara tramos de dígitos. `"0.1673"`
contra `"0.28"` acaba comparando 1673 contra 28. En pantalla: un food cost del **16,7 % pintado con
el color de la pérdida**, y —lo peligroso— uno del **40 % en verde**. **INC-020.**

Sobrevivió porque **con la misma cantidad de decimales a los dos lados acierta**: cualquier prueba
escrita con `0.30` contra `0.28` habría pasado. Lo encontró mirar una captura con datos reales.
Prevención automatizada: `no-comparar-decimales-con-localecompare`.

**4. Cómo se mira la aplicación sin manos, y merece la pena saberlo.**
Chrome sin cabeza sirve para verificar de verdad, y es lo que encontró el fallo 3:

```sh
chrome --headless=new --disable-gpu --ignore-certificate-errors   --virtual-time-budget=10000 --screenshot=x.png --window-size=1280,700 https://localhost/...
```

Para entrar con sesión sin automatizar un formulario: una página estática en `public/` que hace
`fetch('/api/auth/login')`, pone `localStorage` y navega. **Next cachea la lista de archivos de
`public/` al arrancar**, así que tras un `docker cp` hay que reiniciar el contenedor.

**5. Un solo origen, y por qué.**
Caddy sirve la interfaz en `/` y la API en `/api/*` con `handle_path`, que **quita el prefijo**. Con
eso: `CORS_ORIGENES` se queda vacío, la cookie sigue siendo `SameSite=Strict`, y no hace falta un
segundo certificado. **El prefijo hace falta de verdad**: la interfaz tiene una página en `/costeo` y
la API un endpoint en `/costeo`.

`NEXT_PUBLIC_API_URL` es `/api` y **se hornea en el paquete del navegador en tiempo de build** —
ponerla en `environment:` no hace nada. Al ser relativa, la misma imagen sirve para cualquier dominio.

**6. El orden de la importación no es arbitrario.**
`ITEMS → ARTICULOS → PRECIOS → PRODUCTOS → RECETAS`. Los precios de un ítem comprado **exigen** su
artículo: un importe sin presentación no dice cuánto cuesta la unidad de uso. Y `unidades` viaja como
**cadena**, no como número, igual que todo decimal en este sistema.

**7. Y una comprobación que salió bien y conviene repetir.**
El costeo del ceviche se rehízo a mano: con IVA de compra recuperable al 15 % (D3/R13) da **1,4478**
y el motor reportó **1,45**. No es plausible-pero-falso; es correcto, y R13 se ve aplicada.

### Lo que un «tú» futuro necesita saber de P14

**1. Un check puede no estar mirando lo que crees, y el único síntoma es un número que no se mueve.**
Después de añadir tres archivos y borrar uno, `audit:forbidden` seguía diciendo «346 archivos». La
causa: todos los patrones decían `apps/*/src/**/*.ts` y **ninguno `.tsx`**. Las 34 reglas —`: any`,
`@ts-ignore`, `eslint-disable`, marcadores pendientes— **nunca habían examinado una sola de las 2.000
líneas del frontend** que construyó la Fase C. Corregido a `*.{ts,tsx}`, el contador va a **359**.

Es la **décima** recurrencia de INC-007 y su caso 10. La lección nueva: **un glob de extensión es un
alcance con fecha de caducidad.** El día que el repositorio gana un tipo de archivo, las reglas se
quedan mirando a otro lado y nada falla. Vale para el siguiente: si algún día entra `.vue`, `.svelte`
o un segundo workspace, **ese contador tiene que moverse**.

**2. El manual de marca es una especificación, no una paleta — y se puede verificar.**
Publica tokens con columna clara y oscura, una escala de Fibonacci con el uso de cada término, cuatro
niveles tipográficos con interlínea y **seis ratios de contraste calculados**. Los seis se
recalcularon y **dan sus mismas cifras hasta el segundo decimal**, lo que prueba que los hex se
leyeron bien. Si algún día se retoca la paleta, ese recálculo es la comprobación: un hex mal copiado
descuadra su ratio.

Y trae decisiones de producto que no son estéticas: **el panel operativo va en claro** porque «un
panel oscuro con vidrio gana en portafolio y pierde al chef en la cocina», y el vidrio **no puede ir
detrás de una tabla densa** porque baja el contraste del texto pequeño. Por eso no hay
`prefers-color-scheme` ni tokens de sombra: no es un olvido.

**3. Los valores del manual salieron del PDF, no de una captura, y eso hay que saber repetirlo.**
El archivo está exportado desde Chromium: los colores son operadores `rg` con cuatro decimales, las
fuentes van incrustadas con su `ToUnicode` y **el logotipo es un trazado de Bézier**. Descomprimir
los flujos del PDF da el texto, la paleta y la geometría exactos. El logotipo de
`apps/web/public/marca/` **se extrajo así, no se redibujó**: reproduce la tabla de construcción del
manual —caja `H/φ`, trazo 11,803, rotura a −21,25°— sin que se le impusiera.

**4. La retícula del manual es de LÁMINA, no de aplicación.**
`--f6` (144 px) es su «margen lateral», pensado para 1600 × 900. Aplicado a la barra de la app a
1280 px, **parte la navegación en dos filas**. Se usa `--f3`. La regla del manual —toda medida sale
de la serie de Fibonacci— se respeta; el término se elige según el lienzo.

**5. Se revirtieron dos correcciones de CSS que no corregían nada.**
Se dedujo un desbordamiento horizontal de una captura de móvil y se añadieron `minmax(0, 1fr)` y
`min-width: 0` con su comentario explicativo. **Medido después, el desbordamiento no existía**: la
maqueta de prueba no llevaba `meta viewport`, y `scrollWidth` daba idéntico con y sin las reglas a
500 y a 320 px. **Un comentario que dice «esto evita un fallo» cuando no lo evita es peor que no
tener comentario.** Es INC-007 aplicado a uno mismo: el arreglo también hay que verificarlo.

**6. La capa visual se verifica con un navegador, y está a mano.**
No hay pruebas automatizadas de aspecto, pero Chrome sin cabeza sí sirve y encontró cosas:
`chrome --headless=new --screenshot=x.png --window-size=W,H <url>`. Con eso se rasterizó el logotipo,
se capturaron las pantallas contra el build de producción y se midió `scrollWidth` contra
`clientWidth` inyectando un guion. **Los dos fallos reales del paquete los encontró una captura, no
una lectura del código.**

**7. `apps/web` no tiene despliegue, y P14 no lo arregló.**
Ni `Dockerfile`, ni servicio en `docker-compose.prod.yml`, ni línea en el runbook; el `build` de la
raíz solo construye la API. Es la razón por la que las fuentes se **autoalojan** en vez de usar
`next/font/google`: ese descarga en tiempo de build, y no conviene que una cadena de despliegue que
todavía no existe nazca dependiendo de tener red.

### Lo que un «tú» futuro necesita saber de P10

**1. `combo_component` llevaba seis paquetes existiendo sin que nadie la escribiera.**
P4 creó la tabla, P5 la lee para costear (`componentesDeCombos`) y **entre P4 y P10 no se insertó una
sola fila**. Un combo se podía crear como producto y no se podía componer nunca: costaba cero.
Ninguna prueba lo vio porque ninguna creaba un combo con componentes. **Lo destapó preguntar qué
representaba una columna de un Excel**, no una revisión de código.

La lección, que es nueva: **una tabla con lectura y sin escritura es un agujero que ningún check ve.**
`audit:deadcode` mira exports de TypeScript, no rutas de escritura a la base. Si un día se añade una
tabla y solo se cablea su lectura, va a pasar otra vez.

**2. La transacción por método era el fallo, y no se podía envolver desde fuera.**
Cada método de repositorio abre su propia `TenantTransaction.run()`. 200 ítems = 200 transacciones.
Y `ClienteDeTransaccion` es `Prisma.TransactionClient`, que **no expone `$transaction`**: no hay
forma de que una transacción contenga a otra. La solución fue un método de repositorio nuevo por
módulo. **La atomicidad es por pasada, no entre módulos**, y eso no se puede arreglar con este ORM.

**3. Un check de CÓDIGO MUERTO encontró un agujero de SEGURIDAD.**
knip señaló `MAXIMO_BYTES` y `MAXIMO_DE_FILAS` como exports sin usar. No eran código muerto: eran los
topes de `SEGURIDAD.md` §5.1 **declarados y desconectados**. Estaban escritos desde que se escribió
el parser y no los aplicaba nadie. Es INC-007 al revés: no es que el verde mienta, es que el rojo
dice más de lo que parece. **Cuando knip señale una constante de configuración, pregunta si es que
sobra o es que no se aplicó.**

**4. `audit:arch` corrigió el sitio de dos tipos de negocio.**
`TipoDeProducto` y `OrigenDePrecio` vivían en los puertos. Son reglas —SPEC §8 y D8—, y el dominio
del lote los necesitaba: la regla de dependencia lo paró y se mudaron al dominio, con el puerto
reexportándolos. **Cuando el dominio necesita un tipo que está en `application`, casi siempre el tipo
está en el sitio equivocado.**

**5. El CLI abre sesión con contraseña, por el mismo camino que el navegador.**
La alternativa —un atajo que fabricara una `SesionActiva` sin credenciales— era una puerta que no
existe en ningún otro sitio del sistema, y bastaría con que alguien la expusiera un día por HTTP.
Con `IniciarSesion` + `ValidarSesion` no hay puerta nueva, y se hereda el bloqueo por intentos y el
registro en `audit_log`. **La contraseña llega por `COSTEO_IMPORT_PASSWORD`.**

**6. El importador se niega en producción, y la salida es una bandera explícita.**
`--operacion-supervisada` levanta la negativa, exige además `--confirmar`, e imprime contra qué base
va a escribir antes de hacerlo. El procedimiento completo está en `docs/runbooks/despliegue.md`. Se
resolvió en P10 a propósito: dejarlo para el día del despliegue habría costado la tarde.

**7. Lo que se aplazó del importador, y por qué se puede aplazar.**
El primer cliente **no es el dueño del Excel de referencia**, así que el importador **no aprende su
dialecto**: ni alias de cabecera ni el mapeo `INS`/`SUP`/`SUB`/`LNK`. Sería vocabulario de un archivo
que no se va a importar. **La pasada de análisis no escribe nada** y ya reporta columnas no
reconocidas y obligatorias ausentes: cuando llegue el archivo real, ajustar los alias es media hora
sin tocar el camino de escritura.

### Lo que un «tú» futuro necesita saber de P9

**1. El error de este paquete que sobrevive a una revisión es promediar un porcentaje.**
Un local que vende 200 con food cost del 80 % y otro que vende 100.000 con el 30 % dan **30,1 %**, no 55 %. La media simple le da a cada local un voto igual y el dueño decide por dólar. Los dos números son plausibles en pantalla; solo uno decide precios bien. La prueba unitaria lleva los dos y compara contra la media simple explícitamente.

**2. La comparativa de compras sale del LIBRO, no de `reference_price`.**
El precio de referencia es de company y no tiene ubicación: compararlo entre locales daría el mismo número siempre. Lo que varía es la factura, y `purchase_article_id` en `inventory_movement` estaba puesto desde P6 exactamente para esto. Hay una prueba que lo fija: el precio de referencia es 2,00 y la comparativa devuelve 1,20 y 1,68.

**3. El consolidado escala LINEAL, y el presupuesto se cumple al 92 %.**
Diez ubicaciones: p95 de **734 ms contra 800**, medido con la API y la base en la misma red. La proporción es 8,9× pese al `Promise.all`, porque la mayor parte del trabajo es CPU de Node y eso no se paraleliza esperando. **Alrededor de doce ubicaciones se rompe** — ahí entra la vista materializada que ADR-012 §7 deja diseñada.

**4. `audit:forbidden` paró un atajo real y el arreglo mejoró el diseño.**
El repositorio de `inventory` resolvía nombres leyendo `item` y `purchase_article` directamente. La regla `tablas-de-catalogo-solo-en-catalog` lo cazó: ahora devuelve ids y `analytics` pone los nombres con `ListarItems` y `ListarArticulos`.

**5. El hook de pre-commit podía pasar en verde SIN correr la integración, y se arregló.**
Con la base arriba y sana, la sonda TCP de `audit:tests` —un intento, 1,5 s— la tragó el atasco de INC-016 y el check se degradó a `PARCIAL`. Es INC-007 caso 8 en el peor sitio: se degrada justo bajo las condiciones que hacen falso todo lo demás. Ahora son **tres intentos**: una base apagada falla las tres al instante, una viva con hipo contesta a la segunda.

**6. La migración de P9 no crea ni una tabla.** Solo un permiso. Es la señal de que P8 dejó el terreno hecho: el consolidado es la suma de lo que cada ubicación ya publica, no un cálculo nuevo por otro camino.

### Lo que un «tú» futuro necesita saber de P8

**−1. Si `npm run audit` falla en pruebas de integración que NO tocan lo que cambiaste, mira el tamaño de la base antes que el diff.**
Las suites siembran y no limpian, y el libro es append-only **también para el dueño**: no se puede borrar por company. La base crece hasta que el timeout de 2 s tumba peticiones **al azar**, en suites distintas cada vez. `npm run db:reset -- --si`. Es **INC-014**.

**0. El Excel se puede leer, y se leyó. Está en `C:\Users\Lander\Downloads\`.**
No hace falta `openpyxl`: un `.xlsx` es un ZIP con XML, y `scratchpad/xlsx.py` lo lee en 60 líneas. **Cuando una fórmula del SPEC sea dudosa, míralo.** La verificación de P8 cerró una duda de dos paquetes, confirmó el hallazgo del rendimiento por lote contra la fuente y encontró dos divergencias que nadie había escrito. Sigue sin versionarse: es dato de cliente.

**1. R7 destapó un fallo de P6 que llevaba dos paquetes con 596 pruebas en verde encima.**
La receta es del **lote**; la venta, de **porciones**. Vender 100 unidades de un producto que rinde 2 consume **50** lotes, no 100 (SPEC §14: `costo_por_porcion = costo_neto_lote / rendimiento_porciones`). P6 no dividía, así que con rendimiento 4 cada venta sacaba del inventario cuatro veces lo real.

**Ninguna prueba lo vio porque todos los productos de prueba tenían rendimiento 1**, que es el único valor con el que multiplicar y dividir coinciden. La corrección vive en `totalConsumido`, el punto único que P6 y P8 comparten. **ADR-011 §1.**

**Verificado después contra el Excel**, que divide exactamente igual. Y el tamaño real del fallo: **11 de los 48 productos del cliente tienen rendimiento distinto de 1**, con valores de hasta **185**.

**2. Cuarta vez que aparece la misma forma de fallo, y ahora con nombre.**

| | Invariante verde | Desglose roto |
|---|---|---|
| P5 | R7 da cero | el desglose del costo |
| P6 | el saldo cuadra | el tipo del movimiento |
| P7 | la cobertura dice 50 % | el inventario final |
| **P8** | **R7 da cero con rendimiento 1** | **el consumo, al doble** |

La lección de P8 añade algo a las anteriores: **no basta con tener la prueba, el caso de prueba tiene que ser el que distingue.** Con rendimiento 1 los dos caminos de R7 coinciden aunque uno esté mal.

**3. Un redondeo intermedio invierte una recomendación de negocio.**
El índice de popularidad, escrito con la fórmula del SPEC tal cual, da `0.999999999999` donde debe dar `1`, y el producto cae en `CABALLO` en vez de `ESTRELLA`. Se arregla con **una sola división**. Vale para todo el proyecto: cuando un número se compara contra un umbral, cuenta cuántas divisiones hay antes.

**4. Tres traducciones del Excel producen números plausibles si se hacen mal.**
El signo de las mermas (allí positivas, aquí con signo), el consumo (allí calculado, aquí además registrable) y la receta por lote frente a la venta por porción. Las tres dan cifras creíbles. **Cada fórmula que se traiga del Excel hay que traducirla, no copiarla.**

**5. `analytics` no consulta ninguna tabla ajena.**
Pide la carta a `costing`, el libro y el conteo a `inventory` por dos casos de uso que ese módulo expone en `para-analitica.ts`, el mes a `periods` y los parámetros a `pricing`. Es lo que evita dos sitios que mantener en sincronía el día que cambie el signo de algo — y lo que hizo que la corrección del consumo fuera **una** línea.

**6. Una sola pasada alimenta las seis vistas.**
`contexto.ts` reúne todo en cinco consultas fijas más el costeo. Pedirlo por vista multiplicaría por cinco el trabajo más caro del sistema. **Su coste no está medido**, y es lo primero que P9 debería medir: el consolidado lo multiplica por el número de ubicaciones.

**7. `BODEGA`, por tercera vez.**
P6 le negó el saldo, P7 la conciliación, P8 las seis vistas. Y las tres veces con las mismas dos consecuencias: **ninguna escritura devuelve lo que acaba de calcular**, y **la proyección reducida es un tipo propio, nunca un `Omit` de la completa**.

### Lo que conviene que el usuario mire antes de P9

1. **El rendimiento del ÍTEM sigue sin confirmarse contra el Excel** (abierta desde P6), y ahora importa más: afecta al `consumo_teorico` que P8 publica en dos vistas. **No confundirlo con el rendimiento por lote**, que es el que P8 corrigió: aquel vive en el costo (SPEC §12), este en la cantidad (SPEC §14).
2. **Las vistas no están contrastadas contra el Excel celda a celda**, y ahora se sabe por qué no se puede: **el Excel no tiene ninguna unidad vendida cargada** (`T2_PRODUCTOS.H` es cero en los 48 productos). Sus tres vistas que dependen de ese dato están en cero. No hay valores esperados que extraer — pero **sus fórmulas sí se verificaron una a una**, y coinciden.
3. ~~El coste de armar el contexto no tiene medición propia~~ ✅ **Medido en P9: 734 ms de 800 con diez ubicaciones.** Cumple al 92 % y escala lineal, así que **doce ubicaciones lo rompen**. Es el aviso que P10 y P11 heredan.
4. ~~El consolidado puede sumar meses cerrados con abiertos~~ ✅ **Resuelto en P9:** la respuesta trae `estadoDelPeriodo` por ubicación y los contadores `cerradas` / `abiertas`.
5. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada; bloquea la migración de datos del Excel.
6. ~~**Nadie puede leer `audit_log`**~~ ✅ **Resuelto en P11:** `costeo_backoffice` tiene `SELECT` y `LeerAuditoria` la sirve, pidiendo motivo como cualquier acceso cross-tenant.

### Lo que la limpieza de la base destapó — leer antes de tocar una prueba de rendimiento

**La base de desarrollo se vació por primera vez desde P0.** Pasó de 3087 MB a 12 MB, y con ella cayeron tres cosas que llevaban tiempo tapadas:

1. **El puerto 5432 del host llegaba a pgbouncer, no a PostgreSQL.** Es **INC-015**. Explica los `ETIMEDOUT` que INC-014 atribuía al tamaño de la base: con `DEFAULT_POOL_SIZE: 1`, dieciocho suites entrando por el pooler se atascan. `docker compose down && up` lo arregla; `restart` no. **INC-014 quedó corregida** en vez de reescrita: el diagnóstico incompleto se deja visible.

2. **`db:reset` tenía dos errores, y el segundo era silencioso.** `DROP SCHEMA public CASCADE` no lo puede deshacer `costeo_migrator` —es dueño del esquema, no de la base— y además se habría llevado `pg_stat_statements` y `pg_trgm`, que viven en `public` y los crea `initdb` **como superusuario**. El script vacía ahora el esquema en vez de tirarlo.

3. **Dos pruebas de plan pasaban por el residuo de corridas anteriores.** Exigían índice donde `Seq Scan` era la elección **correcta**: la company medida era la tabla entera. Pasaban porque cientos de companies viejas hacían de ruido por accidente. Corregido: `rendimiento-de-costeo.spec.ts` siembra sus propias `COMPANIES_DE_RUIDO = 9`.

**La regla que queda, y vale para P9 en adelante:** una prueba de rendimiento que solo pasa sobre una base sucia no mide el sistema, mide el residuo. Si escribes una que compare planes, **siembra tú el ruido**.

### Cómo se mide ahora el presupuesto de §5 — y la deuda que deja

**`/costeo` está bien: p95 ≈ 85 ms contra 400 en la topología de producción.** Lo que estaba mal era dónde se medía. Las tres suites de rendimiento corren en el host y hablan con la base por el proxy de Docker Desktop, que se atasca ~300 ms cuando cruza volumen: **nunca han medido el sistema.**

Lo implementado:

1. **La medición se ejecuta siempre y su número se imprime siempre**, en cualquier máquina.
2. **El presupuesto solo se exige en CI**, que corre sobre Linux con el mismo `docker-compose.yml` y sin ese proxy.
3. Fuera de ahí la aserción se salta **con el motivo escrito en la salida**.
4. Las aserciones de **plan** (`EXPLAIN`, uso de índice) siguen corriendo en todas partes: el plan no depende del transporte.

**Se intentó antes una sonda** que midiera el transporte y decidiera sola. No funciona: el atasco va y viene por minutos, así que medirlo veinte segundos antes no predice nada. Daba falsos verdes y falsos rojos **pareciendo rigurosa**. Está contado en INC-016 para que nadie lo reintente.

**Y una regla operativa que sale de ahí:** `docker compose stop api` antes de correr la suite. Con `costeo-api` levantado, el transporte del host pasa de un máximo de 20 ms a uno de **60 segundos**, y la suite de 18 en verde a cinco archivos en rojo distintos cada vez.

> **Deuda técnica, con fecha de pago en P9.** El presupuesto queda guardado por CI y por nadie más. Lo que corresponde es **`npm run bench`**: un banco que levante la API en la red de compose y mida ahí. P9 lo necesita de todos modos — trae su propio presupuesto de 800 ms para el consolidado de diez ubicaciones, y medirlo a través del proxy no serviría de nada.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | Cuatro proyectos: API, interfaz del back office, tooling y `apps/web` |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | **47 reglas sobre 483 archivos** (P16-C: `ensayo-local-con-las-variables-obligatorias`, INC-017). Antes: **46 reglas sobre 477 archivos** (P16-B: `regex-de-numero-solo-en-el-vocabulario`; P16-A2 añadió `403-de-integracion-sin-su-code`). Antes: **44 reglas sobre 433 archivos** (P16-A1). En P14 pasó de 346 a 359 (los `.tsx` no los miraba nadie); P14b añadió dos reglas (INC-018, INC-020); el commit 0 de P16 añadió las tres del frontend (`no-fecha-a-medianoche`, `no-number-en-frontend`, `no-tipti`) y `override-de-npm-reflejado-en-el-lock` (INC-021): 40 sobre 361; P16-A1 añade las cuatro de `correo.rules.mjs` (`conexion-del-despachador-solo-en-correo`, `cadena-del-despachador-solo-en-correo`, `correo-no-lo-monta-la-app`, `despachador-sin-ganchos-de-nest`) y 72 archivos |
| `audit:arch` | ✅ | **390 módulos, 1751 dependencias** (P16-C). **386 módulos, 1712 dependencias** (P16-B; 368 / 1608 en P16-A2, 351 / 1529 en P16-A1, 291 / 1284 antes). Dos reglas nuevas aíslan `modules/correo` en los dos sentidos |
| `audit:deadcode` | ✅ | Sin lista blanca |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11 · **18 migraciones** (P16-C: `p16c_version_del_periodo`; P16-B: `p16b_versiones_y_ajustes`; P16-A2: `p16a2_csrf`; P16-A1: dos) |
| `audit:secrets` | ✅ | Sobre `**/*`, incluidos los `.woff2` |
| `audit:deps` | ✅ | 4 vulnerabilidades aceptadas y documentadas. **`multer` va forzado a 2.3.0 por `overrides`** (P16 commit 0, INC-021): se retira cuando `@nestjs/platform-express` fije `multer ≥ 2.3.0` |
| `audit:sec-headers` | ✅ | 19 pruebas |
| `audit:tests` | ✅ | **891 unitarias** (sin base) + **541 de integración: 536 en verde y 5 saltadas con motivo** (INC-016), 33 archivos. P16-C; P16-B: 889 + 515; eran 870 + 460 en P16-A2 y 823 + 395 en P16-A1 |

> **`npm run bench` sigue fuera de `npm run audit`, a propósito** (documentado en `docs/AUDITORIA.md`
> I8): siembra una base de 220.000 movimientos y tarda minutos. Se corre a mano. **Desde P16-B compila
> la API antes de medir** (INC-007, caso 12); en P16-B el consolidado marcó **919,4 ms de 800**.

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | ✅ Completado | `0f2d606` | 2026-08-27 |
| P1 — IAM · tenants · ubicaciones · roles | ✅ Completado | `3555c9c` | 2026-09-04 |
| P2 — Catálogo · ítems · artículos · unidades | ✅ Completado | `1cd10a5` | 2026-09-04 |
| P3 — Precios de referencia con vigencia | ✅ Completado | `6f4a3be` | 2026-09-04 |
| P4 — Recetas · productos · combos | ✅ Completado | `1529f5d` | 2026-09-04 |
| P5 — MOTOR DE COSTEO ⭐ | ✅ Completado | `e5e3f7d` | 2026-09-04 |
| P6 — Inventario · libro mayor append-only | ✅ Completado | `16200e5` | 2026-09-04 |
| P7 — Períodos · conteo físico | ✅ Completado | `72f0ba1` | 2026-09-04 |
| P8 — Vistas analíticas | ✅ Completado | `0067bd1` | 2026-09-04 |
| P9 — Consolidado y comparativa | ✅ Completado | `47f1e7d` | 2026-09-06 |
| **P10 — Importación de catálogo, acotada** | ✅ Completado | *(el de este paquete)* | 2026-09-07 |
| **P11 — Back office** | ✅ Completado | *(el de este paquete)* | 2026-09-08 |
| P12 — Frontend app cliente | ✅ **Completado, recortado a 5 pantallas** | Fase C | 2026-09-08 |
| **P13 — Frontend back office** | ✅ Completado | *(el de este paquete)* | 2026-09-08 |
| **P14 — Capa visual** | ✅ Completado | *(el de este paquete)* | 2026-09-08 |
| **P15 — Endurecimiento** | ✅ Completado | *(el de este paquete)* | 2026-09-08 |

Estados: ⬜ Pendiente · 🟡 En curso · ✅ Completado · ⏸️ Pospuesto con motivo

---

## Decisiones tomadas durante la construcción

> Toda decisión técnica que no estaba en el SPEC y se resolvió al implementar.

| # | Decisión | Paquete | Razón |
|---|---|---|---|
| 1 | **Prisma 7.10.0**, versión exacta, con las políticas RLS como SQL manual en las migraciones | P0 | El RLS nativo existe solo en Prisma 8, que es RC. Y no habría eliminado la Barrera 2. **Confirmada por el usuario.** ADR-001 |
| 2 | **`decimal.js` dentro de `domain`**, con excepción acotada a `shared/domain/decimal/` | P0 | **Decisión del usuario.** Mitigada con `Decimal.clone()`, escala explícita obligatoria en toda división, y prohibición de importarla fuera de esa carpeta. ADR-003 |
| 3 | **Vitest** como runner, con plugin SWC | P0 | La capa `domain` no tiene decoradores y corre sin transformación; NestJS 12 va hacia Vitest por defecto en proyectos ESM |
| 4 | **P0 entrega `Money`, `Ratio`, `Count` y `Quantity`. Solo `UnitCost` se aplaza** | P0 | `Quantity` se adelantó **por decisión del usuario**: el criterio de aceptación de P2 exige que una conversión inválida se rechace en el dominio |
| 5 | **`argon2` se aplaza a P1** | P0 | No se usa hasta que haya sesiones |
| 6 | Dos checks nuevos: **`audit:migrations`** y **`audit:sec-headers`** | P0 | La reversibilidad de migraciones y SEGURIDAD.md §11 no eran verificables con los nueve originales |
| 7 | La regla de marcadores pendientes vive en `audit:forbidden`, no en ESLint | P0 | `no-warning-comments` marcaría cada comentario en español que contenga la palabra «todo» |
| 8 | Las reglas de `dependency-cruiser` se anclan **por capa**, no por ubicación | P0 | Siguen valiendo si el código se mueve |
| 9 | `audit:forbidden` enmascara comentarios antes de buscar | P0 | La prosa que **explica** una regla contiene por necesidad lo que la regla prohíbe |
| 10 | `allowScripts` versionado en `package.json` para 4 paquetes | P0 | npm 11 bloquea los install scripts por defecto |
| 11 | `src/shared/application/` para puertos transversales | P0 | CLAUDE.md §2 no lo lista, pero es preferible a inventar un módulo `audit` que tampoco está |
| 12 | **El empaque es un ÍTEM**, no una tabla propia | P5 | `T4_EMPAQUES` duplicaría la cadena de costo entera y R13. **ADR-008** |
| 13 | **Si hay receta, manda la receta** sobre el precio estándar de un `PRODUCIDO` | P5 | Es el problema que el LEEME del Excel declara como deuda. R10 sigue entera. **ADR-008** |
| 14 | **El combo suma componentes ya costeados**, sin volver a aplicar merma ni dividir por porciones | P5 | Volver a aplicarla es cobrar la merma dos veces (R12). **ADR-008** |
| 15 | **R6 cierta por construcción**: se divide una vez y el margen es el complemento | P5 | Dos divisiones que caigan a la vez en un empate en el decimal 13 dan `1.000000000001` |
| 16 | **Costear uno pasa por costear todos** | P5 | Dos rutas para el mismo número son dos oportunidades de que difieran |
| 17 | La receta de una subpreparación se expresa **por unidad de uso**, no por lote | P5 | **Confirmado en P6: no se añade columna de rendimiento por lote** |
| 18 | **La cantidad del movimiento lleva SIGNO**, garantizado por `CHECK` + FK compuesta `(type, direction)` | P6 | Sin signo el saldo deja de ser una suma. Sin la FK, `('COMPRA','SALIDA')` cuela una cantidad negativa. **ADR-009** |
| 19 | **Se guarda el importe TOTAL, no el unitario** | P6 | Al comprar el hecho es la factura; reconstruirla con una división pierde centavos. **ADR-009** |
| 20 | **La corrección conserva el TIPO** del movimiento que anula | P6 | Como `AJUSTE`, el mes cerraría contando compras que nadie hizo. **ADR-009** |
| 21 | **La producción se valora al precio de referencia**, no al costo de la receta | P6 | El valor de un inventario no puede cambiar porque alguien edite una receta. **ADR-009** |
| 22 | **`inventory.read` no se concede a `BODEGA`**, y ninguna escritura devuelve el saldo | P6 | Con el saldo despeja el consumo, y de ahí la receta (§4.3). **ADR-009** |
| 23 | **`exigirUbicacionEnAlcance` se muda de `recipes` a `iam`** | P6 | Es autorización de sesión, no una regla de recetas |
| 24 | **El período es de una UBICACIÓN**, no de la company | P7 | El conteo se hace por ubicación (R2); uno de company obligaría a diez ubicaciones a contar el mismo día. **ADR-010** |
| 25 | **La frontera del mes son dos instantes**, resueltos al abrirlo | P7 | Con la zona aplicada en cada consulta, cambiarla movería de mes movimientos ya cerrados. Y hace que el corte use el índice de P6. **ADR-010** |
| 26 | **La ausencia de fila en `period` es el estado ABIERTO** | P7 | Exigir abrir el mes pararía el sistema el día 1 de cada mes. **ADR-010** |
| 27 | **El conteo NO ajusta el libro** | P7 | Un `AJUSTE` por la diferencia haría que `diferencia = conteo − teórico` diera cero siempre. **ADR-010** |
| 28 | **Un ítem sin contar vale su TEÓRICO, no cero** | P7 | Valorarlo en cero equivale a declararlo consumido entero, e infla el consumo real de todo conteo parcial. **ADR-010** |
| 29 | **Confirmar CONGELA** teórico y costo por línea | P7 | Los precios tienen vigencia (R5): recalcular mañana daría otro número para un mes ya informado. **ADR-010** |
| 30 | **Un solo conteo confirmado por período**, con columna anulable única en vez de índice parcial | P7 | Prisma no declara índices parciales y aparecería como deriva en `migrate:verify`. **ADR-010** |
| 31 | **Cerrar el mes es un paso del conteo**, no un endpoint suelto | P7 | Es lo que D6 describe, y evita el ciclo `periods ↔ inventory` que `audit:arch` pararía. **ADR-010** |
| 32 | **`BODEGA` cuenta y no concilia** | P7 | La conciliación lleva stock teórico, diferencia y valorización (§4.3). Y hace el conteo ciego, que SPEC §4 pide. **ADR-010** |
| 33 | **El consumo teórico se DIVIDE por el rendimiento por lote** | P8 | La receta es del lote y la venta es de porciones (SPEC §14). **Corrige un fallo de P6** que R7 destapó. **ADR-011** |
| 34 | **El índice de popularidad se calcula con UNA división**, no desde `popularidad` | P8 | Tres redondeos encadenados dan `0.999999999999` donde debe dar `1`, e invierten el cuadrante. **ADR-011** |
| 35 | **`CONSUMO_POR_VENTA` no entra en los agregados del libro** | P8 | El Excel no tiene movimientos de consumo; este sistema sí. Sumarlos y además restar el teórico lo descuenta dos veces. **ADR-011** |
| 36 | **El signo del libro se SUMA**, no se resta como en el Excel | P8 | Aquí una merma ya es negativa (ADR-009); restarla la sumaría. **ADR-011** |
| 37 | **T6 lleva clasificación explícita**, no el prefijo del concepto | P8 | Lo pide el propio SPEC §17: «Nómina» quedaría fuera del prime cost sin avisar. **ADR-011** |
| 38 | **`BODEGA` no recibe ninguna de las seis vistas**, solo el semáforo | P8 | Todas llevan consumo o stock teórico (§4.3). Tercera vez que aparece la misma asimetría. **ADR-011** |
| 39 | **Las unidades vendidas son un entero** (`Count`), con `CHECK` en la base | P8 | Es lo que P5 ya asumía en `totalesDelMes` y lo que menu engineering necesita para contar |
| 40 | **La escritura en lote es un método de repositorio nuevo por módulo**, no un envoltorio | P10 | `ClienteDeTransaccion` no expone `$transaction`: una transacción no puede contener a otra |
| 41 | **La atomicidad es POR PASADA, no entre módulos.** Se compensa validando todo antes de escribir nada | P10 | Limitación del ORM, no del diseño. Documentada en el puerto y en `CONSTRUCCION.md` |
| 42 | **Una línea es receta o es combo según el TIPO DEL PRODUCTO DESTINO**, no según una columna | P10 | SPEC §8 ya lo dice. Pedírselo al archivo sería pedirle que repita algo con opción a contradecirse. **ADR-014** |
| 43 | **Un combo no puede contener otro combo** | P10 | Es lo que «componentes que son productos simples» significa, y hace innecesario validar ciclos ahí |
| 44 | **Los precios importados se confirman en bloque, a petición explícita** | P10 | R5 exige que alguien decida, no que decida 149 veces. Queda en `audit_log` con su nombre |
| 45 | **El CLI abre sesión con contraseña, por el camino del login** | P10 | Un atajo que fabricara sesiones sería una puerta que no existe en ningún otro sitio |
| 46 | **`import_job` no tiene ninguna FK hacia lo importado** | P10 | Si la tuviera, borrar un ítem obligaría a decidir qué hacer con su historia |
| 47 | **El análisis vive en `jsonb` y no se lee de vuelta** | P10 | Es caché de algo reproducible. Leerlo tipado exigía un `as unknown as` que `audit:forbidden` para |
| 48 | **El panel operativo va en CLARO, sin vidrio y sin sombra** | P14 | Lo decide el manual, p. 30, con su motivo: «un panel oscuro con vidrio gana en portafolio y pierde al chef en la cocina». **ADR-019** |
| 49 | **El semáforo usa Jade, Persimmon PROFUNDO y Oxblood**, no verde-ámbar-rojo | P14 | Persimmon vivo reprueba como texto (3,93:1) y el manual lo declara color de señal. Su variante profunda da 5,64:1, calculado aquí. **ADR-019** |
| 50 | **Fraunces no se sirve en la aplicación** | P14 | Es nivel Display, de 66 a 172 px, para «aperturas». La app no tiene aperturas. Usarla a 24 px sería inventar un tamaño. **Reversible en diez minutos.** ADR-019 |
| 51 | **Las fuentes se autoalojan**, sin `next/font/google` | P14 | Ese descarga en tiempo de build, y `apps/web` no tiene cadena de despliegue todavía. Y así el navegador del cliente no habla con un tercero. **ADR-019** |
| 52 | **El logotipo se EXTRAJO de las curvas del PDF**, no se redibujó desde las fórmulas | P14 | Redibujar desde una fórmula es interpretar, y una interpretación de un logo es otro logo. **ADR-019** |
| 53 | **El producto se llama Platise; el repositorio sigue siendo `costeo-saas`** | P14 | El nombre comercial es un texto visible; el nombre de trabajo es infraestructura y tocarlo movería roles de base de datos y cadenas de conexión. **Cierra D1** |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` | P0 | Nada hoy |
| 4 | ~~La explosión del consumo no aplica el rendimiento del ítem~~ | P6 | ✅ **CERRADA: verificado contra el Excel.** `T3_RECETAS.N` usa la cantidad de la receta tal cual; el rendimiento del ítem (`T1.L`) aparece **solo** en el costo (`T1.M = K/L`). El rendimiento encarece la unidad, no aumenta lo que sale de la bodega. **ADR-011 §1** |
| 7 | ~~El MC promedio de menu engineering: el SPEC y el Excel se contradicen~~ | P8 | ✅ **CERRADA en P10 por decisión del usuario: se queda PONDERADO**, como dice SPEC §319 y como es el Kasavana-Smith canónico. El `AVERAGE` del Excel es el atajo que la hoja hace fácil, y con cola larga desplaza el eje y reclasifica platos entre cuadrantes. La implementación actual era correcta. **ADR-015**, que además hace visible el MC de referencia y sus dos operandos para que el cliente pueda reproducirlo |
| 5 | **Las seis vistas no se pueden contrastar contra el Excel celda a celda**, porque el Excel no tiene dimensión temporal (SPEC §3). La aritmética está probada con casos a mano y R7 cierra sobre el sistema entero | P7 · P8 | Nada. Es una limitación del origen, no una tarea pendiente |
| 8 | ✅ **RESUELTA: `/costeo` cumple §5 con holgura. La que fallaba era la medición.** En la topología de producción —API y base en la misma red— el p95 es **~85 ms contra un presupuesto de 400** (21 %). El modo de 370 ms era **el proxy de Docker Desktop en Windows**, que se atasca ~300 ms cuando cruza un resultado grande: la misma consulta de 1.600 filas tarda 2 ms dentro del contenedor y pega picos de 320 ms desde el host. **INC-016** trae las once cosas que se descartaron midiendo | P8 | **Pero deja una decisión abierta: las tres suites de rendimiento corren en el host y nunca han medido el sistema.** Ver abajo |
| 6 | **El coste de armar el contexto de las vistas no está medido.** Cinco consultas más el costeo de la carta, por (ubicación, mes) | P8 | Nada hoy. **P9 lo multiplica por el número de ubicaciones** y tiene presupuesto de 800 ms |

---

| 9 | **El consolidado de diez ubicaciones ya no cabe en su presupuesto de §5: 940,9 ms contra 800.** Medido con `npm run bench` al cerrar P16-A1, dos corridas con la máquina en reposo (940,9 y 962,6 ms). **No es regresión del paquete**: las consultas y sus recuentos de llamada son los mismos que en P15, y normalizado al «suelo del entorno» que el propio bench mide (validar sesión: 4,5 ms en P15, 6,5 ms hoy) el consolidado cuesta 143,7 suelos frente a los 149,6 de entonces — relativamente, igual. Lo que cambió es la máquina. **Pero el número absoluto es rojo y el umbral no se sube** (AUDITORIA.md I8). **P16-B: 919,4 ms** (suelo 10,0 ms), la primera medición que se sabe hecha sobre el código de su commit —hasta entonces el bench no compilaba el `dist` que medía (INC-007, caso 12)— | P16-A1 | **Decisión tuya.** El arreglo está diseñado desde P9: vistas materializadas para períodos cerrados (ADR-012 §7), que es la deuda #2 de abajo y cuya condición de pago era exactamente esta. Las opciones: (a) pagarla ahora, en un paquete propio; (b) medirla primero en CI o en el VPS —donde no hay 5,7 GB de base de desarrollo compitiendo— y decidir con ese número; (c) aceptarla hasta el piloto, que tiene **dos** ubicaciones y no la toca. **Mi recomendación: (c) ahora y (b) en el ensayo de despliegue**, porque el piloto no lo necesita y medirlo en la máquina donde va a correr es más barato que optimizar a ciegas |
| 11 | **La hoja de conteo (`PUT /conteos/:id/lineas`) es un reemplazo total sin versión** (D-16.129). Si dos personas cuentan la misma hoja a la vez —la cámara fría y el almacén seco—, la segunda en guardar borra lo de la primera. D-16.11 pide concurrencia optimista en los reemplazos totales y D-16.13 no le dio columna; y una versión le daría a quien cuenta un 409 que le haría perder lo contado | P16-C | **Decisión tuya.** (a) Guardado por línea (`PUT /conteos/:id/lineas/:itemId`): dos personas no se pisan salvo en el mismo ítem, que es lo correcto — **mi recomendación**; (b) versión en `physical_count` con 409, como el resto; (c) aceptarlo hasta el piloto, que tiene una bodega y quizá una sola persona contando |
| 12 | **`GET /costeo` en una sucursal donde el producto no tiene receta devuelve costos `0.00`**, con la nota de «sin PVP» y sin decir que falta la receta. Visto al capturar el armazón: la dueña en la bodega ve «Arroz marinero 0.00 · 0.00 · 0.00». El SPEC define la receta por par (producto, ubicación) (§184) y no dice qué se enseña sin ella. Un costo cero parece un dato | Armazón | ✅ **CERRADA por el usuario el 2026-09-14: opción (a).** La API marca `sinReceta` y las pantallas lo pintan como estado, con la misma regla que «sin contar» no es cero. Se construye en **P16-D**, antes de Inicio, porque el costeo que ya está en pantalla lo enseña hoy |
| 13 | **Un plato vendido sin receta entra a la ingeniería de menú con un margen igual a su venta neta** —sin costo, todo es margen—, así que la matriz lo coloca como estrella o rompecabezas; y suma cero al costo de ventas del food cost real y del consolidado. P16-D solo lo marca en el costeo | P16-D | **Decisión tuya, antes de la pantalla 25.** (a) La matriz lo pone en `SIN_DATOS` (como un activo sin PVP) y el resumen cuenta cuántos platos vendidos no tienen receta, como ya cuenta los ítems sin costo —**mi recomendación**—; (b) se deja y se avisa en pantalla; (c) se deja |
| 15 | **Una persona no puede estar en dos companies**: `app_user.email` es único global (D-16.197), así que el mismo correo no puede ser dueña de un restaurante e invitada en otro. Hoy no molesta —cada piloto es una company—, pero el día que un cliente abra una segunda razón social, o que un contador externo lleve dos clientes, hace falta decidir: (a) el correo se repite y la identidad es `(company, correo)`; (b) el usuario es global y pertenece a N companies con un selector al entrar; (c) se queda como está y cada company exige un correo distinto | Verificación multi-tenant | **Nada de esta pasada.** Plazo: **antes de la segunda licencia vendida**. (b) es lo que hacen los SaaS multi-tenant, y es el que más cambia: sesión, invitación, roles y back office |
| 14 | **Un producto no se puede renombrar, recategorizar ni archivar**: la API de P4/P16-B no tiene `PUT /productos/:id`, solo la configuración por sucursal, el empaque y los componentes. Un error de tipeo en el nombre queda para siempre, y un plato que sale de la carta solo se puede desactivar sucursal por sucursal. Visto al construir la pantalla 11 (el producto de ensayo se quedó en el tenant sintético) | Pantalla 11 | **Nada de las pantallas 12–27.** Recomendación: un paquete de API corto, **P16-E**, con `PUT /productos/:id` `{nombre, categoria, estado, version}` (409 por nombre repetido y por versión) y la edición en la ficha, **antes de la entrega al piloto** |
| 10 | **`npm run bench` no lo ejecuta CI.** Corre `npm run audit` y `migrate:verify`, no el bench. El presupuesto del consolidado no lo vigila nada automático — es el riesgo que la propia fila I8 de `AUDITORIA.md` declaraba en voz alta, y que se cumplió: el bench llevaba **dos paquetes sin poder arrancar** (INC-017, recurrencia 1) | P16-A1 | Añadirlo a CI cuesta ~3 minutos por corrida (crea y destruye una base con 220.000 movimientos). ¿Se añade, o se queda como paso manual obligatorio de los paquetes que tocan lectura? |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| 1 | **`npm run bench`** — el presupuesto de tiempo de §5 solo se exige en CI, porque el proxy de Docker en Windows falsea la medición en local (INC-016). Falta el banco que mida en la topología de producción | P8 | ⚠️ **VENCIDA DOS VECES.** Se fijó para P9 (no se pagó) y se re-fechó a P10 (tampoco). **Nueva fecha: después del lanzamiento**, y el motivo se dice en voz alta — este sprint no añade ningún presupuesto p95 nuevo y el tiempo sale del frontend. **Decisión del usuario, no un olvido** |
| 2 | **Vistas materializadas para períodos cerrados** — el plan de P9 las listaba; no se construyeron porque el criterio de aceptación se cumple sin ellas y una caché de números es una fuente de números rancios | P9 | **Cuando aparezca una company con más de diez ubicaciones**, o cuando el número de CI se acerque al techo. El umbral está medido, no supuesto: ADR-012 §7 |

| 3 | **Los alias del dialecto real del cliente** en los descriptores de importación | P10 | Cuando llegue su archivo. La pasada de análisis **no escribe nada** y ya reporta columnas no reconocidas y obligatorias ausentes: ajustarlo es media hora sin tocar el camino de escritura |
| 4 | **Prueba de similitud dominio ↔ `pg_trgm`** — el dominio quita tildes y `pg_trgm` no. Medido: `similarity('tomate riñón','tomate rinon') = 0.53`, por encima del umbral de 0.3, así que el criterio de aceptación se sostiene; lo que no está probado es que coincidan siempre | P10 | Después del lanzamiento |
| ~~5~~ | ~~**`apps/web` no tiene cadena de despliegue**~~ | ~~P14~~ | ✅ **Cerrada en P14b.** `Dockerfile` multi-stage con salida autocontenida, servicio en el compose de producción, enrutado en Caddy con un solo origen, y comprobación de los recursos estáticos en `desplegar.sh` |
| ~~6~~ | ~~**El margen de referencia se muestra con 12 decimales**~~ | ~~P14~~ | ✅ **Cerrada en P14b**, y en el sitio correcto: la API manda la escala exacta **a propósito** —«quien la muestre decide cuántos decimales pinta»— así que redondear es trabajo del frontend. Vive en `apps/web/src/lib/decimales.ts`, con el comparador y el porcentaje |
| 7 | **La pantalla de menú tiene prosa interpolada dentro del componente**, contra D11 | P14 | Cuando haya un ayudante de formato. No es visual, y por eso P14 no lo tocó |
| 8 | **No hay pruebas automatizadas de la capa visual** | P14 | Se verifica con Chrome sin cabeza y capturas, que es lo que encontró los dos fallos reales de P14. Una prueba de regresión visual es un paquete propio. *(Desde Inicio, lo de `lib/` que es función pura sí tiene pruebas —ADR-027—; los componentes siguen sin ellas)* |

> **Resuelto en P11.** `audit_log` ya tiene lector: `costeo_backoffice` tiene `SELECT` sobre ella y `LeerAuditoria` la sirve. Leer la auditoría de un tenant es un acceso cross-tenant como cualquier otro — pide motivo y deja su línea. Estuvo diez paquetes escribiéndose sin que nadie pudiera leerla: cumplía la letra de SEGURIDAD.md §10 y no su propósito.

> **Pendiente nuevo, y con fecha de revisión: el back office no tiene segundo factor.** Con un operador y acceso por túnel SSH —que ya exige una clave— añadirlo ahora sería proteger la segunda cerradura antes que la primera. **En cuanto haya un segundo operador, se reevalúa.** Está en ADR-017 y aquí para que no se pierda.

> **Una tabla con lectura y sin escritura no la ve ningún check.** `combo_component` llevó seis paquetes así. `audit:deadcode` mira exports de TypeScript, no rutas de escritura a la base.

---

## Convenciones establecidas

| Ámbito | Convención |
|---|---|
| Estructura de módulos | `apps/api/src/modules/<modulo>/{domain,application,infrastructure}` + `src/shared/{domain,application,infrastructure}` |
| Nombres de archivo | `kebab-case.ts`, sin excepciones (`forceConsistentCasingInFileNames`) |
| Idioma | Identificadores en inglés; comentarios, mensajes de error y documentación en español (CLAUDE.md §3) |
| Imports | Sin extensión (`from './escalas'`): `module: commonjs` + `moduleResolution: node` |
| Aserciones de compilación | `*.type-contract.ts` — no se ejecutan, las verifica `tsc` |
| Pruebas unitarias | `src/**/*.spec.ts`, corren **con la base apagada**, con guardián que lo hace cumplir |
| Pruebas de integración | `apps/api/test/integracion/**/*.spec.ts` |
| **Fechas en pruebas y cargas** | **Hora `12:00Z`**, que cae en el mismo día natural en toda América. Las cinco primeras horas UTC de un día 1 son del mes anterior en Ecuador (INC-013) |
| Opcionales | `\| null` explícito, nunca `?`, por `exactOptionalPropertyTypes` |
| Escalas decimales | `PRESENTACION` 2 · `ALMACENAMIENTO` 12 · `DIVISION` 12 · `MAXIMA` 30 |
| **Decimales en respuestas** | **Todos a escala de ALMACENAMIENTO.** `_sum` de Prisma normaliza y leer la columna no |
| Comparar importes | API completa en el tipo. **Nunca** `.toNumber()` ni operadores relacionales |
| Cantidades | Siempre `Quantity` con su `UnidadDeUso`. Mezclar unidades lanza `UnidadIncompatibleError` |
| **`Quantity` → escalar** | `magnitude(): Ratio` es el **único** puente, explícito y con nombre |
| Redondeo | Medio hacia arriba (*half away from zero*), el `ROUND()` de Excel |
| **Intervalos de período** | **Semiabiertos `[inicio, fin)`.** El instante exacto de `finEn` es del mes siguiente, en SQL, en el trigger y en TypeScript |
| Nombres de tablas | `snake_case` singular (`audit_log`, `inventory_movement`, `physical_count_line`) |
| Nombres de migraciones | `<timestamp>_<slug>/` con `migration.sql` y `down.sql` |
| Bloques SQL manuales | `-- MANUAL: BEGIN/END` en el up, `-- MANUAL-REVERSE: BEGIN/END` en el down. **Los triggers se sueltan antes que sus funciones**: las tablas se borran después |
| **Globs de migraciones en las reglas** | `apps/*/prisma/migrations/**/*.sql`, **nunca** `prisma/migrations/...` (INC-007 caso 9) |
| Formato de commits | `P{n}: {nombre}` — ver `docs/PROTOCOLO.md` |

---

## Notas de contexto

- El SPEC completo está en `docs/SPEC.md`; las reglas obligatorias en `CLAUDE.md`; el protocolo en `docs/PROTOCOLO.md`; la checklist en `docs/AUDITORIA.md`
- **`docs/incidencias/README.md` tiene CATORCE fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. **INC-007 (9 recurrencias), INC-008, INC-012 e INC-013 no son de una herramienta concreta**, y merecen leerse aunque no se esté diagnosticando nada
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete
- **La misma forma de fallo lleva tres paquetes seguidos apareciendo**: P5 con R7, P6 con el saldo, P7 con la cobertura. **Un invariante agregado que se cumple tapando un desglose que no.** Cuando un número global esté verde, pregúntate qué desglose lo estaría tapando, y comprueba **cifras absolutas** contra casos calculados a mano — no relaciones entre ellas
- **El contador de archivos de `audit:forbidden` no es decorativo.** Cuando una regla cambia de alcance, ese número tiene que moverse (INC-007 caso 9)
- **Una prueba de plan de ejecución necesita volumen REALISTA, no solo mucho volumen** — y tiene que **aceptar el plan bueno**: exigir `Index Scan` sobre una tabla diminuta rompe la prueba por un plan que está bien. Es la otra mitad de la misma lección
- **`docs/sistema/guardas-de-dominio.md` cubre P0–P7.** M11 falla si una migración nueva con `CHECK` o `RAISE EXCEPTION` no tiene su sección. **Ha parado las dos migraciones a las que se ha enfrentado**, y es la razón de que INC-012 no haya reaparecido
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** Toda validación que sea control de seguridad va en el CAMPO
- **Y la lección que las engloba: un check que FALLA tampoco está verificado.** Hay que preguntarse en **cuántos** sitios falla. El verde no es el único color sospechoso
