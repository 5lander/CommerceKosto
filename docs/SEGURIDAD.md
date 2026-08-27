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
- Archivos (archivos de usuarios) se guardan con **nombre generado por el sistema (UUID)**, nunca con el nombre original del archivo
- El nombre original se guarda como metadato en base de datos, escapado
- Ninguna ruta de filesystem se construye con entrada del usuario; acceso a archivos solo por ID → lookup en base → URL firmada

---

## 2. Autenticación y fuerza bruta

### 2.1 Anti fuerza bruta (login, códigos, tokens)
| Superficie | Límite | Acción al exceder |
|---|---|---|
| Login de empresa | 5 intentos / 15 min por cuenta **y** por IP | Bloqueo incremental: 1 min → 5 → 15 → 60; aviso por correo al titular |
| Código de verificación (correo) | 5 intentos por código | El código se **invalida**; hay que pedir otro |
| Solicitud de códigos | 3 por hora por usuario | Rechazo con espera |
| Token de invitación de usuario y de restablecimiento de contraseña | Es de 256 bits — infuerzabrutable — pero: | 10 tokens inválidos desde una IP / hora → bloqueo de IP en esa ruta |
| Recuperación de cuenta | 3 intentos / 24 h por perfil | Escala a revisión manual (SPEC 2.4) |
| Back office | 3 intentos → bloqueo + alerta al equipo | 2FA obligatorio siempre |

- Contador de intentos en **Redis con TTL**, por cuenta y por IP simultáneamente (evita que una botnet distribuya intentos)
- Respuesta de login fallido **idéntica** exista o no la cuenta, y con **tiempo constante** (comparación con `timingSafeEqual`, hash dummy cuando el usuario no existe) — corta la enumeración de usuarios y los timing attacks
- CAPTCHA (o proof-of-work) a partir del tercer fallo en superficies públicas

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
- **IDOR** (CLAUDE.md §4.2): pertenencia al tenant verificada en la consulta misma (`WHERE id = $1 AND tenant_id = $2`) — no en un `if` posterior, y con RLS como red de seguridad
- **Sin mass assignment**: los esquemas de entrada (Zod) declaran **exactamente** los campos aceptados con `.strict()` — un `role: "admin"` o un `tenant_id` inyectado en el body se rechaza, no se ignora
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

## 5. Carga de archivos (archivos de usuarios) — superficie de ataque directa

1. **Tamaño máximo** (ej. 5 MB) rechazado antes de bufferizar
2. **Tipo real verificado por magic bytes**, no por extensión ni `Content-Type` del cliente — solo `.xlsx`, `.csv` y `.tsv` para importación; imágenes solo si un paquete futuro las requiere
3. Nombre original descartado; almacenamiento con UUID en **bucket privado**, nunca en el filesystem del servidor web ni bajo una ruta pública
4. **El parser de PDF corre aislado**: proceso separado con timeout y límite de memoria (los PDFs maliciosos que explotan parsers son un vector conocido) — idealmente en el worker de cola, jamás en el proceso del webhook
5. PDFs se sirven solo por **URL firmada de vigencia corta**, con `Content-Disposition: attachment` (nunca render inline desde nuestro dominio)
6. Sin ejecución posible: el bucket no sirve nada como HTML/JS
7. Escaneo antivirus (ClamAV o servicio) como capa adicional antes de parsear

---

## 6. Webhooks y APIs de terceros

- **Firma verificada con `crypto.timingSafeEqual`** (no `===`) antes de tocar el payload — no aplica a este proyecto: no hay webhooks entrantes en el alcance. Si se añade uno, esta regla se activa sin excepción
- Payload sin firma válida → `401` **sin procesar nada**, con log
- **Anti-replay**: idempotencia por `message_id`/`transaction_id` + rechazo de timestamps viejos donde el proveedor lo permita
- El body crudo se preserva para verificar la firma (el JSON re-serializado no coincide)
- Endpoints de webhook con rate limiting propio y sin exponer errores internos

---

## 7. Denegación de servicio y abuso

- **Rate limiting por capas**: global por IP → por cuenta → por endpoint sensible (login, búsqueda, vista previa, contador de vacante)
- **Límite de tamaño de body** en todas las rutas (JSON: 100 KB; upload: su límite propio)
- Timeouts en todo: peticiones entrantes, llamadas salientes, consultas SQL (`statement_timeout`), trabajos de cola
- Validación por esquema **antes** de cualquier trabajo costoso — un payload gigante o malformado se rechaza en el borde
- Protección de regex: sin regex con backtracking catastrófico sobre entrada de usuario (ReDoS); validar patrones con herramientas o usar RE2
- La cola (BullMQ) con reintentos acotados y dead-letter — un mensaje venenoso no tumba el worker en bucle
- Paginación con límite máximo servidor (`limit ≤ 100` aunque pidan 10.000)
- Anti-scraping del negocio: ver SPEC 5.8 (patrones anómalos, identificadores por sesión)

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
| `actor` | Usuario/usuario/sistema + su tenant si aplica |
| `ip` | Dirección de origen |
| `geo` | País/ciudad aproximados por IP (para detectar anomalías) |
| `user_agent` | Navegador/dispositivo |
| `device_id` | Huella básica de dispositivo (cookie de dispositivo de larga vida) |
| `correlation_id` | Trazabilidad de punta a punta |
| `outcome` | success / failure / blocked |
| `detail` | IDs implicados — **jamás datos personales en claro ni secretos** |
| `at` | timestamptz |

### Catálogo de eventos auditables (obligatorio, ampliable)
| Dominio | Eventos |
|---|---|
| **Autenticación** | `auth.login.success` · `auth.login.failure` · `auth.login.blocked` (rate limit) · `auth.logout` · `auth.session.revoked` · `auth.2fa.success/failure` · `auth.password.changed` · `auth.password.reset_requested` |
| **Cuenta** | `account.email.changed` · `account.phone.changed` · `account.recovery.started/completed/denied` |
| **Usuario** | `candidate.created` · `candidate.updated` (qué campos) · `candidate.paused` · `candidate.deleted` (derecho al olvido) · `candidate.viewed_by_company` · **`candidate.unlocked`** (por quién, con qué crédito) · `candidate.exported` |
| **Vacante** | `vacancy.created/edited/paused/closed` · `vacancy.results.viewed` |
| **Pagos** | `billing.package.purchased` · `billing.credit.consumed` · `billing.credit.refunded` · `billing.webhook.received/rejected` |
| **Back office** | **TODA acción**: `admin.company.approved/rejected/suspended` · `admin.candidate.searched` (con justificación obligatoria) · `admin.catalog.created/edited` · `admin.credit.adjusted` · `admin.login.*` |
| **Sistema** | `webhook.signature.invalid` · `ratelimit.exceeded` · `config.changed` · `migration.applied` |

### Auditoría de login reforzada
- **Cada login registra IP, geo aproximada, user agent y device_id** — éxitos Y fallos
- **Login desde dispositivo o ubicación nueva → correo de aviso al titular** ("Nuevo inicio de sesión en costeo-saas desde {ciudad} · {dispositivo}. ¿No fuiste tú? Asegura tu cuenta aquí")
- El usuario de empresa puede ver sus **sesiones activas** (dispositivo, ubicación, última actividad) y **cerrar cualquiera** desde su perfil
- Panel de actividad de la cuenta: historial de logins visible al admin de la empresa
- Anomalías que generan alerta interna: login exitoso tras ráfaga de fallos · misma cuenta desde dos países en ventana corta · admin de back office fuera de horario habitual

### Retención y acceso
- Retención mínima: **12 meses** en caliente, luego archivo cifrado (ajustar con asesoría legal LOPDP)
- El acceso al log de auditoría es de solo lectura, restringido al back office, **y consultar el log también se audita**
- Exportable para responder a un reclamo de un usuario (LOPDP) o a una investigación

## 10b. Detección y respuesta

- **Alertas automáticas** ante: ráfagas de login fallido, ráfagas de 403 (alguien probando IDOR), tokens de registro inválidos en serie, picos de 429, firma de webhook inválida repetida, consultas que tocan volúmenes anómalos
- Log de auditoría **inmutable y append-only** (tabla sin UPDATE/DELETE para el rol de la app)
- Reloj sincronizado (NTP) — sin esto los logs no sirven como evidencia
- Runbook de incidentes con el procedimiento de **brecha de datos**: contención, evaluación, notificación a la autoridad LOPDP en plazo, notificación a afectados
- Revisión de accesos del back office: quién vio qué perfil, exportable

---

## 11. Verificación continua

| Cuándo | Qué |
|---|---|
| Cada commit | `npm run audit` completo (incluye `audit:sec-headers`, `audit:forbidden`, `audit:secrets`, deps) |
| Cada paquete | Sección C de la auditoría con evidencia + tests de authz del paquete |
| P10 | **Pentest interno guiado**: recorrer OWASP Top 10 contra el sistema completo con los fakes; suite de pruebas de abuso (fuerza bruta simulada, IDOR masivo, payloads malformados, uploads maliciosos) |
| Pre-producción | Escaneo externo (ZAP baseline o similar) + revisión de configuración TLS |
| Continuo | Dependabot/renovate para parches de dependencias |

### Tests de seguridad obligatorios en el repositorio
- `security/idor.test` — cada endpoint con ID probado cruzando tenants
- `security/blocked-fields.test` — respuesta cruda de toda ruta sin campos bloqueados
- `security/bruteforce.test` — los límites de §2.1 se aplican de verdad
- `security/webhook-signature.test` — payload sin firma o con firma inválida se rechaza sin efectos
- `security/mass-assignment.test` — campos extra en el body se rechazan
- `security/rls.test` — con RLS activo, una consulta sin tenant no devuelve filas

---

## 12. Mapa de amenazas → defensa (resumen)

| Ataque | Defensas (en capas) |
|---|---|
| SQL injection | Parametrización + lista blanca de orden + privilegios mínimos + RLS |
| Fuerza bruta | Límites por cuenta+IP + bloqueo incremental + tiempo constante + CAPTCHA |
| Enumeración de usuarios | Respuestas idénticas + tiempo constante |
| Session hijacking/fixation | Cookies HttpOnly/Secure/Strict + rotación + revocación + detección de reuso |
| XSS | Escapado por defecto + CSP con nonce + HttpOnly |
| CSRF | SameSite=Strict + token CSRF + verificación de Origin |
| SSRF | Sin fetch de URLs de usuario + lista blanca de destinos |
| IDOR / escalada | Tenant en la consulta + RLS + tests por endpoint |
| Mass assignment | Esquemas `.strict()` con campos explícitos |
| Path traversal | Nombres UUID + acceso solo por ID + bucket privado |
| Upload malicioso | Magic bytes + tamaño + parser aislado + AV + URLs firmadas |
| Replay de webhooks | Firma timing-safe + idempotencia + ventana temporal |
| DoS / ReDoS | Rate limiting en capas + timeouts + límites de body + regex seguras |
| Fuga por errores/logs | Errores genéricos + minimización + DTOs explícitos |
| Supply chain | Audit en CI + lockfile + revisión de dependencias + digest fijado |
| Robo de secretos | Gestor de secretos + escáner + rotación documentada |
| Timing attacks | `timingSafeEqual` en toda comparación de secretos |
| Scraping del negocio | Rate limiting + patrones anómalos + datos bloqueados nunca enviados |
