# P1 — Documento de construcción

## Resumen

| Campo | Valor |
|---|---|
| Paquete | P1 — IAM · tenants · ubicaciones · roles |
| Fecha inicio / fin | 2026-09-03 / 2026-09-04 |
| Commit final | `P1: IAM · tenants · ubicaciones · roles` |
| Secciones del SPEC implementadas | §2 (ubicaciones), §4 (roles y capacidades) |
| Reglas de negocio | **R1** (aislamiento absoluto entre companies) queda activa desde este paquete |
| Estado | ✅ completado |

## Objetivo del paquete

**Que el aislamiento funcione antes de que exista un dato de negocio.** Al terminar P1, dos companies no se ven entre sí aunque el código de aplicación se equivoque; una ruta nueva está protegida sin que nadie se acuerde de protegerla; y un `GERENTE_LOCAL` no puede ver la ubicación de al lado ni crear una nueva.

**Criterio de aceptación:** dos companies donde A no ve nada de B ni pasando IDs de B · un caso de uso que **olvida** la capa de tenant devuelve cero filas, no filas ajenas · el mismo test pasa con PgBouncer · `GERENTE_LOCAL` recibe 403 sobre otra ubicación · dos `ADMIN` coexisten y ninguno elimina al `OWNER` · **las cuatro condiciones de D12 verificadas**.

---

## Qué se construyó

### Esquema — 14 tablas, 3 funciones, 29 políticas

| Tabla | Tenant | Nota |
|---|---|---|
| `company` | su propio `id` | La aplicación **no tiene INSERT**: dar de alta un tenant es del back office (P11) |
| `company_settings` | `company_id` | Los parámetros de D3 llegan en P3 |
| `location` | `company_id` | `BODEGA` / `LOCAL` / `AMBOS`; el tipo no es decorativo (SPEC §2) |
| `app_user` | `company_id` | Correo único **globalmente**: el login ocurre antes de saber el tenant |
| `user_role` | `company_id` | Clave foránea **compuesta** contra `role(code, requires_location)` |
| `session` | `company_id` | Solo el **hash** del token |
| `login_attempt` | **sin tenant, a propósito** | Se cuenta antes de saber quién entra |
| `role`, `permission`, `role_permission` | catálogo | Capacidades, no roles rígidos |
| `company_status`, `location_type`, `location_status`, `user_status` | catálogo | Enums en tabla (D5) |

Restricciones que llevan una regla dentro, no solo un tipo:

- `app_user_email_en_minusculas` — sin ella, `Ana@x.com` y `ana@x.com` son dos cuentas y el bloqueo por fuerza bruta se esquiva con una mayúscula.
- `app_user_credencial_coherente` — un `INVITED` no tiene contraseña; un `ACTIVE` siempre la tiene.
- `user_role_has_location_coherente` + la clave foránea compuesta — asignar `GERENTE_LOCAL` sin ubicación, o `ADMIN` con una, es **imposible en la base**.
- `user_role_owner_unico_por_company` — índice único parcial, no un trigger: dos altas simultáneas se serializan en el índice, mientras que un trigger que consulta y decide tiene una ventana de carrera.
- `user_role_unico_sin_ubicacion` — índice único parcial para `location_id IS NULL`. Sin él, el `@@unique` de Prisma **no impide duplicar un rol de nivel company**, porque en PostgreSQL dos `NULL` son distintos para un índice único.

### Las tres funciones `SECURITY DEFINER`

Son los tres —y solo tres— momentos en que el sistema lee antes de saber el tenant. Detalle y justificación en **ADR-006**.

| Función | Cuándo | Se entra por |
|---|---|---|
| `auth_lookup(email)` | Login | el correo |
| `session_lookup(token_hash)` | Cada petición autenticada | el hash del token |
| `invitation_lookup(token_hash)` | Activación de una invitación | el hash del token |

`session_lookup` devuelve el **contexto entero** —vigencia, estados, capacidades efectivas y alcance de ubicaciones— en una sola llamada. Resolverlo en tres consultas triplicaría el coste fijo de toda la API.

### Dominio puro — `modules/iam/domain/`

Todo esto corre con la base apagada, que es el criterio de CLAUDE.md §2.

| Archivo | Qué decide | Pruebas |
|---|---|---|
| `politica-de-intentos.ts` | Bloqueo anti fuerza bruta: dos ventanas (disparo 15 min, escalada 60 min), escala 1→5→15→60 min, **umbral distinto por eje** | 20 |
| `politica-de-sesion.ts` | Vigencia: absoluta 12 h, inactividad 4 h, revocación | 8 |
| `politica-de-contrasenas.ts` | Largo 12–128, **sin reglas de composición** (NIST SP 800-63B), lista local de filtradas, no contiene el correo | 11 |
| `politica-de-roles.ts` | Quién puede tocar el rol de quién: ni al `OWNER`, ni a uno mismo, ni `OWNER` por esta vía | 13 |
| `errores.ts` | Errores tipados; un solo mensaje para los cuatro rechazos del login | — |

**El umbral por eje merece su párrafo.** SEGURIDAD.md §2.1 da un solo número —5 intentos / 15 min— «por cuenta **y** por IP». Aplicado literalmente, cinco errores repartidos entre cinco empleados de un mismo restaurante bloquean **el local completo**, y la escalada lo deja una hora fuera: cualquiera puede dispararlo desde la acera con el wifi del sitio. Se separó: **5 por cuenta, 25 por IP**, con la misma escalada. Lo que el eje de IP tiene que cortar es el rociado de contraseñas, y 25 fallos en una hora sigue siendo un techo bajísimo. Razonado en ADR-006 y reversible: son dos constantes.

### Casos de uso — `modules/iam/application/casos-de-uso/`

Ninguno conoce NestJS ni Prisma. Se construyen a mano en las pruebas, con dobles.

| Caso de uso | Qué junta |
|---|---|
| `IniciarSesion` | Política de intentos + Argon2id + `auth_lookup` + sesión + auditoría + aviso al titular |
| `ValidarSesion` | Barrera 3: token → contexto. Refresca `last_seen_at` como mucho cada 5 min |
| `CerrarSesion` | Revocación **en el servidor**, no borrar la cookie |
| `CambiarContrasena` | Exige la actual, valida la nueva, revoca **todas** las sesiones |
| `CrearUbicacion` / `ListarUbicaciones` | Límite del plan; alcance por ubicación |
| `InvitarUsuario` / `AceptarInvitacion` | Token de 256 bits hasheado, caducidad de 7 días, un solo uso |
| `AsignarRol` / `RevocarRol` | Política de roles + auditoría |

### El orden del login, que es lo que decide si se filtra información

1. **Bloqueo** — antes de tocar la contraseña. Un atacante bloqueado no debe conseguir que el servidor gaste 64 MiB y decenas de milisegundos: sería una denegación de servicio barata.
2. **`auth_lookup`** — una sola lectura.
3. **Verificar** — **siempre**, exista o no el usuario. Por eso el puerto acepta `hash: null` y el adaptador verifica contra un hash ficticio. Sin esto, el tiempo de respuesta distingue «no existe» de «contraseña incorrecta» y se enumera el padrón sin acertar ninguna contraseña.
4. **Estado** de usuario y company — **después** de verificar. Comprobarlo antes ahorraría el hash y reabriría el canal de tiempo que el paso 3 acaba de cerrar.

Los cuatro motivos de rechazo dan **el mismo mensaje**, y hay una prueba que compara los cuatro entre sí — en una sola prueba, no en cuatro, porque repartida cada una pasaría por su cuenta y la propiedad que importa dependería de que se ejecuten en orden (la trampa de INC-008).

### HTTP

| Elemento | Decisión |
|---|---|
| `SesionGuard` | `APP_GUARD`: **deny by default**. Se salta solo con `@Publico()` |
| `PermisosGuard` | `APP_GUARD`: capacidades con `@Requiere('location.create')` |
| Cookie | `HttpOnly; SameSite=Strict; Path=/`, `Secure` desde configuración |
| DTO | Todos `.strict()`: una clave de más se **rechaza**, no se limpia |
| Errores de dominio | `Record<CodigoDeDominio, HttpStatus>` exhaustivo: un código sin fila **no compila** |

Rutas públicas, la lista completa: `/health`, `/ready`, `POST /auth/login`, `POST /usuarios/activacion`.

---

## Superficie de API

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| `POST` | `/auth/login` | público | 200 + cookie · 401 · 429 |
| `POST` | `/auth/logout` | sesión | 204 |
| `POST` | `/auth/password` | sesión | 200 `{sesionesRevocadas}` · 401 · 400 |
| `GET` | `/ubicaciones` | `location.read` | 200, **acotado al alcance** |
| `POST` | `/ubicaciones` | `location.create` | 201 · 403 · 409 (límite del plan) |
| `POST` | `/usuarios` | `user.invite` | **202** (nunca dice si el correo existe) |
| `POST` | `/usuarios/activacion` | público | 204 · 401 · 400 |
| `POST` | `/usuarios/roles` | `user.update` | 204 · 403 · 404 |
| `DELETE` | `/usuarios/roles` | `user.update` | 204 · 403 · 404 |

El `202` de la invitación no es estilo: `201` diría «he creado un usuario», y este endpoint responde igual cuando el correo ya estaba en uso. `202` dice lo único cierto en ambos casos.

---

## Prueba manual

```bash
npm run db:up              # levanta PostgreSQL Y PgBouncer
npm run migrate:deploy
npm run migrate:verify     # cuatro pasos sobre bases limpias
npm run test               # 227 unitarias + 102 de integración
npm run audit              # los 12 checks
```

Alta de un tenant de prueba (lo hace el rol dueño, como hará el back office en P11):

```sql
INSERT INTO company (name, status) VALUES ('SnackLab', 'ACTIVE') RETURNING id;
INSERT INTO app_user (company_id, email, password_hash, status)
  VALUES ('<company>', 'ana@snacklab.ec', '<hash argon2id>', 'ACTIVE') RETURNING id;
INSERT INTO user_role (company_id, user_id, role_code, has_location)
  VALUES ('<company>', '<user>', 'OWNER', false);
```

```bash
curl -i -X POST localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ana@snacklab.ec","contrasena":"tres cebollas moradas"}'
# 200 + Set-Cookie: sesion=...; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200

curl -s localhost:3000/ubicaciones -H 'Cookie: sesion=<token>'
# [] — todavía no hay ubicaciones

curl -i -X POST localhost:3000/ubicaciones -H 'Cookie: sesion=<token>' \
  -H 'content-type: application/json' -d '{"nombre":"Centro","tipo":"LOCAL"}'
# 201
```

---

## Lo que se descubrió por el camino

**Cinco hallazgos**, tres de ellos con ficha.

1. **El repositorio de auditoría de P0 no había funcionado nunca** ([INC-010](../../incidencias/INC-010-returning-bajo-rls-exige-politica-de-select.md)). `create()` de Prisma emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` exige pasar también la política de `SELECT`. La de `audit_log` es `USING (false)` a propósito. Se descubrió al escribirle la primera prueba de integración: **un repositorio sin prueba de integración no está verificado**, por evidente que parezca su código.

2. **El `down.sql` funcionaba en `migrate:verify` y fallaba en la base real** ([INC-011](../../incidencias/INC-011-el-down-solo-se-probaba-en-base-vacia.md)). `migrate:verify` trabaja sobre bases **limpias**, donde ninguna fila referencia nada. Y la guarda `NOT EXISTS` que se añadió para arreglarlo tampoco servía: bajo RLS, «no hay filas» y «no puedo verlas» son la misma respuesta. Prevención: comprobación **M10** de `audit:migrations`.

3. **M10 entró en verde sin medir nada** — séptima recurrencia de [INC-007](../../incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md). El patrón se escribió con un carácter de retroceso donde iba `\b`. Lo cazó la prueba del guardián en el mismo minuto. Sin ese paso, M10 habría entrado como regla decorativa — peor que no tenerla, porque INC-011 diría que el problema está prevenido.

4. **El limitador de peticiones no tenía ninguna prueba**, y se vio por accidente: empezó a estorbar a la suite de autenticación y los fallos esperados salían como `expected 429 to be 400`. Ese efecto colateral fue la única prueba que había tenido nunca de que funcionara. P0 ya lo listaba como pendiente. Ahora tiene `limitador.spec.ts` — y hubo que escribirlo dos veces, porque el primer intento usaba `POST /auth/login` y acabó midiendo **el otro mecanismo que devuelve 429**: el bloqueo por fuerza bruta.

5. **El bloqueo por IP habría dejado fuera a restaurantes enteros.** Ver arriba, «umbral por eje».

También se afinó una regla de seguridad en la dirección correcta: `no-sql-interpolado` marcaba la forma **segura** de llamar a una función (`$queryRaw` con plantilla etiquetada) y obligaba a exenciones por archivo. Ahora distingue la plantilla etiquetada, se añadió `no-prisma-raw` para el único hueco que deja, y **la exención de `tenant-transaction.ts` desapareció**: el repositorio no tiene ninguna.

---

## Deuda registrada

| Qué | Cuándo se paga |
|---|---|
| Refresh rotativo con detección de reuso (SEGURIDAD.md §2.2) | **P12**, cuando exista el cliente que pueda rotarlo. Riesgo residual en ADR-006 |
| Limitador en memoria → Redis | **P15** (decisión del usuario) |
| Excepción `enmiendasAutorizadas` de `sin-migracion-commiteada-modificada` | **P2** |
| Lista blanca de knip para `shared/domain/**` | **P5**, y P5 no cierra con ella puesta |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado; hoy la puerta está cerrada |
