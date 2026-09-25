# SEGURIDAD.md — Estándar completo de defensa

> **Cumplimiento obligatorio.** Complementa `CLAUDE.md` §4: aquel define las reglas de alto nivel; este documento cubre **cada vector de ataque** y cómo se corta. La sección C de la auditoría verifica esto en cada paquete.
> Principio rector: **defensa en profundidad** — ninguna protección es la única; si una capa falla, la siguiente detiene el ataque. Y ante la duda, siempre la opción más restrictiva.

---

## 1. Inyección

### 1.1 SQL Injection — riesgo máximo (las recetas, los costos y los márgenes de un comercio son su secreto competitivo; una fuga entrega a un competidor la estructura completa del negocio)
- **Consultas parametrizadas SIEMPRE.** Prohibida toda concatenación o interpolación de valores en SQL, incluyendo `ORDER BY`, `LIMIT` y nombres de columna dinámicos
- Orden dinámico: **lista blanca** de columnas permitidas mapeada en código (`{ "score": "match_score" }`), nunca el string del cliente
- El usuario de base de datos de la aplicación tiene **privilegios mínimos**: sin `SUPERUSER`, sin `CREATE`, sin `DROP`; las migraciones corren con un rol distinto
- RLS activo (CLAUDE.md §4.1): incluso una inyección exitosa queda confinada al tenant de la sesión
- `pg_trgm` y búsquedas fuzzy: el término del usuario entra **solo como parámetro** de `similarity()`, jamás interpolado
- **Check automatizado**: `audit:forbidden` falla ante template literals con `${` dentro de strings SQL y ante llamadas `query(` con concatenación

### 1.2 NoSQL / Command / Log injection
- Sin `eval`, `Function()`, `child_process.exec` con entrada de usuario. Si un proceso externo es imprescindible: `execFile` con argumentos en array
- **Log injection**: todo dato de usuario que se registre pasa por sanitización de saltos de línea (`\n`, `\r`) — evita forjar entradas falsas en los logs de auditoría
- Cabeceras de respuesta jamás construidas con entrada de usuario sin validar (CRLF injection)

### 1.3 Path traversal
- Los archivos subidos (importaciones Excel/CSV) se guardan con **nombre generado por el sistema (UUID)**, nunca con el nombre original del archivo
- El nombre original se guarda como metadato en base de datos, escapado
- Ninguna ruta de filesystem se construye con entrada del usuario; acceso a archivos solo por ID → lookup en base → URL firmada

---

## 2. Autenticación y fuerza bruta

### 2.1 Anti fuerza bruta (login, códigos, tokens)
| Superficie | Límite | Acción al exceder |
|---|---|---|
| Login de la app cliente | 5 intentos / 15 min **por cuenta** | Bloqueo incremental: 1 min → 5 → 15 → 60; aviso por correo al titular |
| Login — eje de IP *(P16-F, ADR-028; umbral de D-16.199)* | **50 cuentas distintas con fallos / 60 min** desde la misma IP — cuentas, nunca intentos | **429 con `Retry-After`, 15 min fijos**. No bloquea y no escala |
| Código de verificación (correo) | 5 intentos por código | El código se **invalida**; hay que pedir otro |
| Solicitud de códigos | 3 por hora por usuario | Rechazo con espera |
| Token de invitación de usuario y de restablecimiento de contraseña | Es de 256 bits — infuerzabrutable — pero: | 10 tokens inválidos desde una IP / hora → bloqueo de IP en esa ruta |
| Recuperación de cuenta | 3 intentos / 24 h por cuenta | Escala a revisión manual por el back office, con motivo registrado |
| Back office | 3 intentos → bloqueo + alerta al equipo | 2FA obligatorio siempre |

- Contador de intentos en **Redis con TTL**, por cuenta y por IP simultáneamente (evita que una botnet distribuya intentos)

> **El eje de IP se apartó de esta tabla en P16-F (D-16.196, ADR-028, INC-027).** Contaba *fallos* —25 en una hora— y abría el mismo bloqueo escalonado que el eje de cuenta, así que **veinticinco fallos de una sola cuenta dejaban fuera a todo el que saliera por esa IP**: el resto del personal del local con sus credenciales buenas, o cientos de abonados ajenos si el operador usa CGNAT. Cualquiera podía dispararlo desde la acera sin acertar una contraseña. Ahora cuenta **cuentas distintas con fallos** —que es la firma del rociado, no el síntoma— y responde **429 con espera fija**, nunca un bloqueo escalonado. El eje de cuenta no cambia: es el que protege la credencial. **El umbral son 50 cuentas por hora** (D-16.199): diez las junta un lunes por la mañana detrás de un CGNAT o del wifi de un centro comercial, y dejar fuera a esa gente es el daño que este eje existe para no causar.
- Respuesta de login fallido **idéntica** exista o no la cuenta, y con **tiempo constante** (comparación con `timingSafeEqual`, hash dummy cuando el usuario no existe) — corta la enumeración de usuarios y los timing attacks
- CAPTCHA (o proof-of-work) a partir del tercer fallo en superficies públicas

**Cómo quedó implementado en P16-A1 (ADR-026), y en qué se aparta de la tabla.** Los contadores viven en **PostgreSQL, no en Redis** (decisión del usuario desde P1: un bloqueo sobrevive a un reinicio). Las cuatro rutas que escriben sin sesión o mandan correo tienen límite **por IP y por destinatario**, con la misma regla que el login (ventana de una hora, bloqueo de 60 min que cuenta desde el último golpe), y el golpe cuenta siempre, permitido o no:

| Ruta | `kind` | Por IP | Por destinatario |
|---|---|---|---|
| `POST /auth/password/olvido` | `password.olvido` | 10/h | 3/h |
| `POST /auth/password/restablecimiento` | `password.restablecimiento` | 10/h | — |
| `POST /usuarios` | `usuario.invitar` | 30/h | 3/h |
| `POST /usuarios/:id/reenvio-de-invitacion` | `usuario.reenvio` | 30/h | 3/h |

Contar y anotar el golpe son **una sola transacción por clave** bajo `pg_advisory_xact_lock`: un límite de leer-luego-escribir no limita bajo peticiones simultáneas, y la 🔴 que lo fija las lanza en paralelo. La respuesta es 429 `LIMITE_DE_SOLICITUDES` con `Retry-After`, distinto de `ACCESO_BLOQUEADO` (login) y de `TOO_MANY_REQUESTS` (limitador global). La fila «recuperación de cuenta: escala a revisión manual» y el CAPTCHA siguen sin implementarse.

**La IP es la del cliente, no la del proxy.** Detrás de Caddy toda petición llega con la IP de Caddy (INC-022): `ipDelCliente` toma el último salto de `X-Forwarded-For` **solo si el socket está en `PROXY_DE_CONFIANZA`** (en producción, la IP fija de Caddy `172.28.0.10`, dentro de la subred fija de compose; en desarrollo, vacía = el socket), y lo usan el login, el back office, el limitador global y el límite de tasa. Con par no confiable la cabecera se ignora.

**Registro de exenciones de ámbito de tenant.** Tablas con RLS `ENABLE + FORCE` cuya política es `USING (true)` porque **no hay tenant contra el que filtrar**. No son exenciones de RLS (la lista M6 de `audit:migrations` sigue vacía) ni de auditoría; cada una lleva lo mínimo y la aplicación no la borra:

| Tabla | Desde | Qué guarda | Por qué no tiene tenant |
|---|---|---|---|
| `login_attempt` | P1 | correo, IP, instante | se cuenta antes de saber quién entra |
| `rate_limit_hit` | P16-A1 | `kind`, `ip:<ip>` o `correo:<sha256>`, instante | quien pide un restablecimiento todavía no es nadie; la purga a las 24 h la hace el despachador |

**El token de restablecimiento y de invitación en vuelo.** Vive en claro solo en `email_outbox.datos` mientras el correo es `PENDIENTE`, y esa columna la lee únicamente `costeo_despachador` (`SELECT` por columnas para la app y el back office); al cerrar el correo se reemplaza por `{plantilla, destinatario}`. Las dos funciones `SECURITY DEFINER` que lo crean y lo gastan son las únicas que escriben, y están inventariadas con las tres de P1 en `docs/sistema/seguridad.md` (ADR-025).

### 2.2 Credenciales y sesiones
- Argon2id (§4.4 de CLAUDE.md); verificación contra listas de contraseñas filtradas (k-anonimato de HIBP o lista local) al crearlas
- Sesión: token opaco aleatorio de 256 bits en cookie `HttpOnly + Secure + SameSite=Strict`; **rotación del ID de sesión al iniciar sesión** (corta session fixation)
- Vida corta + refresh rotativo con **detección de reuso**: un refresh token usado dos veces revoca toda la familia de sesiones
- Logout del lado servidor (invalidación real, no solo borrar la cookie)
- Al cambiar contraseña o correo: **todas** las sesiones activas se revocan
- Enumeración en registro/recuperación: misma respuesta ("si la cuenta existe, enviamos un correo") exista o no

### 2.3 Códigos de verificación (OTP por correo)
- 6 dígitos, generados con `crypto.randomInt` (CSPRNG, jamás `Math.random`)
- Un solo uso, TTL 5–10 min, **hasheados en base** (un dump de la base no expone códigos vigentes)
- Ligados al canal y a la operación que los pidió (un código de "actualizar" no sirve para "recuperar")

---

## 3. Autorización

- **Deny by default**: toda ruta exige autenticación salvo lista blanca explícita (login, registro, webhooks firmados, healthcheck)
- **IDOR** (CLAUDE.md §4.4): pertenencia verificada en la consulta misma (`WHERE id = $1 AND company_id = $2`, más `AND location_id = $3` cuando el rol es de ubicación) — no en un `if` posterior, y con RLS como red de seguridad
- **Sin mass assignment**: los esquemas de entrada (Zod) declaran **exactamente** los campos aceptados con `.strict()` — un `role: "OWNER"` o un `company_id` inyectado en el body se rechaza, no se ignora
- Escalada horizontal y vertical probadas por test: BODEGA no accede a recursos de GERENTE_LOCAL ni a ningún campo de receta o costo; GERENTE_LOCAL no accede a otra ubicación ni propaga recetas; ADMIN no elimina al OWNER; ningún rol accede a otra company; un tenant/cuenta no ve nada de otro
- Los permisos se evalúan **en el servidor por operación**, nunca inferidos de lo que el frontend muestra u oculta

---

## 4. Web clásico: XSS, CSRF, SSRF, clickjacking

### 4.1 XSS
- React/Next escapan por defecto — **prohibido `dangerouslySetInnerHTML`** con cualquier dato que haya tocado a un usuario
- **CSP estricta**: `default-src 'self'`, sin `unsafe-inline` ni `unsafe-eval`; scripts con nonce
- Los datos de usuarios (descripciones libres, nombres de empresa) se tratan como hostiles: escapados al renderizar, nunca interpretados como HTML
- Cookies de sesión `HttpOnly` — un XSS exitoso no roba la sesión

### 4.2 CSRF
- `SameSite=Strict` en cookies + **token CSRF** en toda mutación del panel (double-submit o synchronizer)
- Los webhooks no usan cookies: su protección es la firma (§6)
- Verificación de `Origin`/`Referer` en mutaciones como capa extra

**Cómo quedó implementado en P16-A2 (U4, ADR-021), y en qué se aparta de las tres líneas de arriba.**
El patrón elegido es **synchronizer**, no double-submit: el token vive en la fila de la sesión
(`session.csrf_token` y `backoffice_session.csrf_token`), en claro, y el servidor lo compara con la
cabecera. Una segunda cookie legible habría metido el token en el canal del que defiende, y habría
dependido de que nadie pueda escribir cookies del sitio — que es justo lo que un subdominio
comprometido sí puede.

| Pieza | Cómo quedó |
|---|---|
| Generación | Segundo token de 256 bits del mismo CSPRNG que el de sesión, **no derivado** de él. Nace con la sesión y muere con ella; no rota dentro de la sesión |
| Entrega | En el **cuerpo** de `POST /auth/login` y de `GET /auth/sesion`. Nunca en una cookie |
| Exigencia | Cabecera **`X-CSRF-Token`** en `POST`, `PUT`, `PATCH` y `DELETE` de los **dos procesos** (app cliente y back office, cada uno con su guard y su tabla) |
| Comprobación | `CsrfGuard` global, **entre** el de sesión y el de permisos. `timingSafeEqual` sobre los SHA-256 de los dos lados: hashear iguala la longitud, que si no sería un oráculo del tamaño del token |
| Fallo | **403 `CSRF_INVALIDO`**, distinguible de `PERMISO_DENEGADO`: la reacción del cliente es opuesta |
| Sesiones anteriores a la migración | Sin token ⇒ **401 `SESION_INVALIDA`**, no un 403 al mutar. El despliegue cierra las sesiones abiertas |
| Logs | `X-CSRF-Token` entra en `redact` junto a `authorization`, `cookie` y `set-cookie`; `logger.options.spec.ts` clava la lista (C14) |

**Fuera del guard, y por qué:** las lecturas (`GET`/`HEAD`/`OPTIONS`) —un CSRF provoca un efecto y el
sitio cruzado no lee la respuesta— y las cuatro rutas `@Publico()`, donde no hay sesión que
suplantar y cuyo problema real es el abuso, que cubre el límite de tasa (§2.1). **El login es la
excepción que sí necesitaba respuesta**: una petición cruzada allí no *usa* una credencial, la
**crea** (login CSRF / fijación), y `SameSite` gobierna el envío de la cookie, no su almacenamiento.
Lo que lo cierra es que **la API analiza solo `application/json`** (`bootstrap.ts`:
`bodyParser: false` + `useBodyParser('json')`), que es lo único que un `<form>` cruzado no puede
emitir. `POST /auth/logout` **no** queda fuera.

**Lo que NO se implementó, dicho aquí y no solo en el ADR: la verificación de `Origin`/`Referer`**
—la tercera línea de esta sección, la «capa extra»— (D-16.69). Cuatro razones, por orden de peso:
duplicaría la lista blanca de CORS y derivaría de ella; en desarrollo y en las pruebas esa lista
está **vacía** (`cors: false`), así que la comprobación necesitaría un «si está vacía, pasa» que
**falla abierto**, que es la forma de condicional que este documento rechaza en todas partes; el
back office no tiene lista que consultar (`cors: false` y un puerto de loopback variable), de modo
que la capa extra solo cubriría la mitad menos expuesta; y `supertest` no manda `Origin`, así que
exigirla rompería las 32 suites y aceptar su ausencia dejaría el hueco abierto. **Señal para
reabrirlo:** un cliente que no sea `apps/web` —una app móvil, una integración— o el back office
publicado fuera de loopback. Hasta entonces, la fila «CSRF» del mapa de §12 se cumple en sus dos
primeros términos y no en el tercero.

### 4.3 SSRF
- El backend **no hace peticiones a URLs provistas por usuarios**. Los enlaces a proveedores o documentos de compra que registre el usuario se guardan y se muestran como texto/enlace — **jamás se fetchean del lado servidor**
- Las únicas llamadas salientes son a servicios conocidos (correo transaccional y almacenamiento de archivos) con URLs de configuración, no de entrada
- Si a futuro se necesita fetchear algo del usuario: lista blanca de esquemas/hosts + bloqueo de IPs privadas y metadata endpoints (169.254.169.254)

### 4.4 Clickjacking y cabeceras
Obligatorias en toda respuesta HTML:
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: (estricta, con nonce)
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store        ← en toda respuesta con datos personales
```
CORS: lista blanca exacta de orígenes propios; jamás `*`; `credentials` solo con origen verificado.

---

## 5. Carga de archivos de importación — superficie de ataque directa

La única carga de archivos del alcance es la **importación Excel/CSV** de P10: ítems, artículos, productos, recetas y movimientos.

1. **Tamaño máximo** (ej. 5 MB) y **límite de filas** rechazados antes de bufferizar
2. **Tipo real verificado por magic bytes**, no por extensión ni `Content-Type` del cliente — solo `.xlsx`, `.csv` y `.tsv`; imágenes solo si un paquete futuro las requiere
3. Nombre original descartado; almacenamiento con UUID en **bucket privado**, nunca en el filesystem del servidor web ni bajo una ruta pública
4. **El parser de hoja de cálculo corre aislado**: proceso separado con timeout y límite de memoria. Un `.xlsx` es un ZIP de XML y los vectores son conocidos —zip bomb, expansión de entidades XML, fórmulas y macros—, así que el parseo va **siempre en el worker de cola**, jamás en el proceso HTTP
5. Los archivos se sirven solo por **URL firmada de vigencia corta**, con `Content-Disposition: attachment` (nunca render inline desde nuestro dominio)
6. Sin ejecución posible: el bucket no sirve nada como HTML/JS
7. Escaneo antivirus (ClamAV o servicio) como capa adicional antes de parsear
8. **Previsualización antes de escribir** y escritura en una sola transacción reversible (CLAUDE.md §4.6): un archivo con una fila inválida en la posición 150 no escribe ninguna de las 149 anteriores

---

## 6. Webhooks y APIs de terceros

- **Firma verificada con `crypto.timingSafeEqual`** (no `===`) antes de tocar el payload — no aplica a este proyecto: no hay webhooks entrantes en el alcance. Si se añade uno, esta regla se activa sin excepción
- Payload sin firma válida → `401` **sin procesar nada**, con log
- **Anti-replay**: idempotencia por `message_id`/`transaction_id` + rechazo de timestamps viejos donde el proveedor lo permita
- El body crudo se preserva para verificar la firma (el JSON re-serializado no coincide)
- Endpoints de webhook con rate limiting propio y sin exponer errores internos

---

## 7. Denegación de servicio y abuso

- **Rate limiting por capas**: global por IP → por cuenta → por endpoint sensible (login, búsqueda difusa de ítems, previsualización de importación, propagación de recetas, vistas analíticas)
- **Límite de tamaño de body** en todas las rutas (JSON: 100 KB; upload: su límite propio)
- Timeouts en todo: peticiones entrantes, llamadas salientes, consultas SQL (`statement_timeout`), trabajos de cola
- Validación por esquema **antes** de cualquier trabajo costoso — un payload gigante o malformado se rechaza en el borde
- Protección de regex: sin regex con backtracking catastrófico sobre entrada de usuario (ReDoS); validar patrones con herramientas o usar RE2
- La cola (BullMQ) con reintentos acotados y dead-letter — un mensaje venenoso no tumba el worker en bucle
- Paginación con límite máximo servidor (`limit ≤ 100` aunque pidan 10.000)
- **Anti-extracción del recetario**: un usuario legítimo con acceso a recetas podría recorrerlas todas para llevárselas. Detección de patrones anómalos (volumen de consultas de receta muy por encima del uso normal, recorrido secuencial de IDs, exportaciones masivas) con alerta interna y registro en el log de auditoría. La receta es el secreto competitivo del cliente

---

## 8. Datos: cifrado, minimización, fuga

- **Cifrado en campo** (AES-256-GCM) para las líneas de receta con sus cantidades, y los precios de referencia; claves en gestor de secretos, **rotables** (el esquema guarda `key_version` por registro)
- **Campos bloqueados jamás salen del backend** (CLAUDE.md §4.3) — con test que inspecciona la respuesta cruda de **todas** las rutas
- **Minimización en logs**: nunca contraseñas, tokens, códigos, cédulas, ni cuerpos completos de peticiones; los IDs sí, los datos no
- **Errores al exterior genéricos** (`{ code, message }`): sin stack traces, sin SQL, sin rutas de archivos, sin versiones de librerías
- Sin `X-Powered-By` ni banners de versión
- Respuestas de API con los campos **explícitamente serializados** (DTO por endpoint) — nunca devolver la entidad completa "y que el frontend ignore lo demás"
- Backups cifrados, acceso restringido, restauración probada, incluidos en el borrado del derecho al olvido

---

## 9. Cadena de suministro y secretos

- `npm audit` + escáner de dependencias en CI: **falla el build ante vulnerabilidad alta/crítica** sin excepción aprobada y registrada (ADR)
- `package-lock.json` versionado; instalaciones con `npm ci`
- Dependencias nuevas requieren autorización (CLAUDE.md §8) y revisión: mantenimiento activo, popularidad, sin install scripts sospechosos
- **Secretos jamás en el repositorio**: `.env` en `.gitignore` desde el primer commit; escáner de secretos (`audit:secrets`) en pre-commit y CI sobre todo el historial del diff
- Rotación documentada por secreto (runbook `rotacion-secretos.md`); la clave de cifrado de campos con procedimiento específico de re-cifrado
- Contenedores: imagen base fijada por digest, usuario no-root, sin herramientas de build en la imagen final (multi-stage)

---

## 10. Auditoría total de accesos — "nada entra sin saberlo"

**Principio: todo acceso y toda acción quedan registrados con quién, qué, cuándo y desde dónde.** El log de auditoría es una tabla append-only (sin UPDATE/DELETE para el rol de la aplicación), con `correlation_id` que atraviesa petición → cola → base.

### Registro de cada evento
| Campo | Contenido |
|---|---|
| `event_type` | Del catálogo de eventos (abajo) |
| `actor` | Usuario / sistema / operador de back office, con su `company_id` cuando aplica |
| `ip` | Dirección de origen |
| `geo` | País/ciudad aproximados por IP (para detectar anomalías) |
| `user_agent` | Navegador/dispositivo |
| `device_id` | Huella básica de dispositivo (cookie de dispositivo de larga vida) |
| `correlation_id` | Trazabilidad de punta a punta |
| `outcome` | success / failure / blocked |
| `detail` | IDs implicados — **jamás datos personales en claro ni secretos** |
| `at` | timestamptz |

### Catálogo de eventos auditables (obligatorio, ampliable)

Los eventos de negocio se introducen **en el paquete que crea la funcionalidad** (check C28 de la auditoría). La columna «Desde» dice cuál.

| Dominio | Eventos | Desde |
|---|---|---|
| **Autenticación** | `auth.login.success` · `auth.login.failure` · `auth.login.blocked` (rate limit) · `auth.logout` · `auth.session.revoked` · `auth.2fa.success/failure` · `auth.password.changed` · `auth.password.reset_requested` | P1 |
| **Cuenta** | `account.email.changed` · `account.recovery.started/completed/denied` | P1 |
| **Company y ubicaciones** | `company.settings.changed` (qué parámetro, valor anterior y nuevo) · `location.created/edited/deactivated` | P1 |
| **Usuarios de la company** | `user.invited` · `user.accepted_invitation` · `user.role.changed` (rol anterior y nuevo) · `user.deactivated` | P1 |
| **Catálogo** | `catalog.item.created/edited/deactivated` · `catalog.article.created/edited` · `catalog.unit.created` · `catalog.conversion.created/edited` | P2 |
| **Precios** | `pricing.reference_price.suggested` (con origen) · **`pricing.reference_price.confirmed`** (quién confirmó y desde qué valor — R5) | P3 |
| **Recetas y productos** | `product.created/edited` · `product_location.activated/deactivated` · `product_location.price.changed` · `recipe.created` · `recipe.version.created` · **`recipe.propagated`** (a qué ubicaciones, cuáles estaban personalizadas — R11) · `recipe.propagation.reverted` | P4 |
| **Inventario** | `inventory.movement.recorded` (tipo, ubicación, ítem) · `inventory.transfer.completed` · `inventory.production.recorded` (con la varianza contra el costo estándar) · `inventory.correction.recorded` (el movimiento de signo contrario, nunca una edición) | P6 |
| **Períodos y conteo** | `period.closed` · **`period.reopened`** (solo `OWNER`, con motivo) · `count.started/submitted` (con el porcentaje del valor contado) | P7 |
| **Importación** | `import.uploaded` · `import.previewed` (filas válidas y rechazadas) · `import.committed/rolled_back` | P10 |
| **Back office** | **TODA acción**: `admin.login.*` · `admin.tenant.accessed` (**con motivo obligatorio**) · `admin.company.created/suspended` · `admin.plan.changed` · `admin.data.loaded` (carga dentro de un tenant) | P11 |
| **Sistema** | `system.migration.applied` · `system.config.changed` · `system.ratelimit.exceeded` · **`system.audit_log.read`** (consultar el log también se audita — C30) | **P0** |

Nota sobre `webhook.signature.invalid`: se reactiva el día que exista un webhook entrante. Hoy no hay ninguno en el alcance (§6).

### Auditoría de login reforzada
- **Cada login registra IP, geo aproximada, user agent y device_id** — éxitos Y fallos
- **Login desde dispositivo o ubicación nueva → correo de aviso al titular** ("Nuevo inicio de sesión en {nombre del producto} desde {ciudad} · {dispositivo}. ¿No fuiste tú? Asegura tu cuenta aquí"). El nombre sale de `apps/web/src/textos/es.ts` → `TEXTOS.producto` (D1, cerrada en P14: **Platise**), nunca literal en el código
- El usuario puede ver sus **sesiones activas** (dispositivo, ubicación, última actividad) y **cerrar cualquiera** desde su perfil
- Panel de actividad de la cuenta: historial de logins visible al `OWNER` y a los `ADMIN` de la company
- Anomalías que generan alerta interna: login exitoso tras ráfaga de fallos · misma cuenta desde dos países en ventana corta · operador de back office fuera de horario habitual · recorrido masivo de recetas

### Retención y acceso
- Retención mínima: **12 meses** en caliente, luego archivo cifrado (ajustar con asesoría legal LOPDP — ítem A4 de `docs/FASE0-CHECKLIST.md`)
- El acceso al log de auditoría es de solo lectura, restringido al back office, **y consultar el log también se audita** (`system.audit_log.read`), con guarda anti-recursión: leer el log no genera a su vez otro evento de lectura
- Exportable para responder a un reclamo de un usuario (LOPDP) o a una investigación

## 10b. Detección y respuesta

- **Alertas automáticas** ante: ráfagas de login fallido, ráfagas de 403 (alguien probando IDOR), tokens de invitación inválidos en serie, picos de 429, recorrido masivo de recetas o de precios, consultas que tocan volúmenes anómalos
- Log de auditoría **inmutable y append-only**: sin `UPDATE`/`DELETE`/`TRUNCATE` para el rol de la app **por privilegio**, y con trigger `BEFORE UPDATE OR DELETE OR TRUNCATE ... FOR EACH STATEMENT` que alcanza también al dueño de la tabla. El trigger es de **sentencia**, no de fila: con `FORCE ROW LEVEL SECURITY` activo, un `DELETE` sin política afecta a cero filas y un trigger de fila nunca se dispararía — el borrado «tendría éxito» en silencio
- Reloj sincronizado (NTP) — sin esto los logs no sirven como evidencia
- Runbook de incidentes con el procedimiento de **brecha de datos**: contención, evaluación, notificación a la autoridad LOPDP en plazo, notificación a afectados
- Revisión de accesos del back office: quién vio qué perfil, exportable

---

## 11. Verificación continua

| Cuándo | Qué |
|---|---|
| Cada commit | `npm run audit` completo (incluye `audit:sec-headers`, `audit:forbidden`, `audit:secrets`, `audit:migrations`, deps) |
| Cada paquete | Sección C de la auditoría con evidencia + tests de authz del paquete |
| P15 | **Pentest interno guiado**: recorrer OWASP Top 10 contra el sistema completo con los fakes; suite de pruebas de abuso (fuerza bruta simulada, IDOR masivo, payloads malformados, uploads maliciosos) |
| Pre-producción | Escaneo externo (ZAP baseline o similar) + revisión de configuración TLS |
| Continuo | Dependabot/renovate para parches de dependencias |

### Tests de seguridad obligatorios en el repositorio
- `security/db-roles.test` — el rol de la aplicación **no** es superusuario, no es dueño de ninguna tabla y no puede crear ni destruir objetos *(desde P0)*
- `security/append-only.test` — `audit_log` (P0) e `inventory_movement` (P6) rechazan `UPDATE`, `DELETE` y `TRUNCATE`, tanto para el rol de la app como para el dueño *(desde P0)*
- `security/sec-headers.test` — las cabeceras de §4.4 están presentes en toda respuesta *(desde P0)*
- `security/rls.test` — con RLS activo, una consulta sin company efectiva devuelve **cero filas**, no las de otro tenant *(desde P1)*
- `security/idor.test` — cada endpoint con ID probado cruzando companies **y ubicaciones** *(desde P1)*
- `security/blocked-fields.test` — respuesta cruda de toda ruta, autenticado como `BODEGA`, sin ninguno de los campos de CLAUDE.md §4.3 *(desde P1)*
- `security/bruteforce.test` — los límites de §2.1 se aplican de verdad, por cuenta **y** por IP *(desde P1)*
- `security/mass-assignment.test` — campos extra en el body se rechazan, no se ignoran *(desde P1)*
- `security/backoffice-isolation.test` — ningún módulo de la app cliente importa la conexión privilegiada *(desde P11)*

`security/webhook-signature.test` se añade el día que exista un webhook entrante. Hoy no hay ninguno en el alcance (§6).

---

## 12. Mapa de amenazas → defensa (resumen)

| Ataque | Defensas (en capas) |
|---|---|
| SQL injection | Parametrización + lista blanca de orden + privilegios mínimos + RLS |
| Fuerza bruta | Límites por cuenta+IP + bloqueo incremental + tiempo constante + CAPTCHA |
| Enumeración de usuarios | Respuestas idénticas + tiempo constante |
| Session hijacking/fixation | Cookies HttpOnly/Secure/Strict + rotación + revocación + detección de reuso |
| XSS | Escapado por defecto + CSP con nonce + HttpOnly |
| CSRF | SameSite=Strict + token CSRF *(synchronizer, P16-A2)* + **la verificación de Origin NO está implementada** (§4.2, D-16.69) — en su lugar, la API solo analiza `application/json`, que cierra el login CSRF |
| SSRF | Sin fetch de URLs de usuario + lista blanca de destinos |
| IDOR / escalada | `company_id` (y `location_id`) en la consulta + RLS + tests por endpoint |
| Mass assignment | Esquemas `.strict()` con campos explícitos |
| Path traversal | Nombres UUID + acceso solo por ID + bucket privado |
| Upload malicioso | Magic bytes + tamaño + límite de filas + parser aislado en worker + AV + URLs firmadas |
| Replay de webhooks | *No aplica hoy*: no hay webhooks entrantes. Si se añade uno: firma timing-safe + idempotencia + ventana temporal |
| DoS / ReDoS | Rate limiting en capas + timeouts + límites de body + regex seguras |
| Fuga por errores/logs | Errores genéricos + minimización + DTOs explícitos |
| Supply chain | Audit en CI + lockfile + revisión de dependencias + digest fijado |
| Robo de secretos | Gestor de secretos + escáner + rotación documentada |
| Timing attacks | `timingSafeEqual` en toda comparación de secretos |
| **Extracción del recetario** | Rate limiting + detección de recorrido masivo + **los campos de CLAUDE.md §4.3 nunca salen del backend para `BODEGA`** + cifrado en campo de las líneas de receta |
| **Alteración de la evidencia** | Log de auditoría append-only por privilegio **y** por trigger de sentencia + libro de inventario sin `UPDATE`/`DELETE` + reloj sincronizado |
