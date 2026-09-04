# API de la aplicación cliente

> Superficie que consume la app de dueños, gerentes y bodegueros. **Estado: P1.**
> El contrato de errores es único en toda la API: `{ code, message }` (CLAUDE.md §8).

## Reglas que valen para toda la superficie

**Ningún endpoint acepta `company_id`.** El tenant sale de la sesión, y solo de ahí (Barrera 3, ADR-006). Todos los esquemas de entrada son `.strict()`: una clave de más **se rechaza con 400**, no se limpia en silencio. Mandar `companyId` es un error, no un campo ignorado.

**Autenticación por cookie, nunca por cabecera.** La sesión viaja en una cookie `HttpOnly; SameSite=Strict; Path=/` (más `Secure` en producción). No se acepta `Authorization: Bearer`: admitir las dos vías reabriría el CSRF que `SameSite=Strict` cierra.

**Deny by default.** Toda ruta exige sesión salvo las cuatro marcadas como públicas abajo.

**Autorización por capacidades, no por rol.** El endpoint declara qué hace falta *poder hacer*; qué rol tiene esa capacidad es una fila en `role_permission`.

## Códigos de error

| `code` | HTTP | Significa |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | El cuerpo no cumple el esquema. El detalle dice qué campo |
| `CREDENCIALES_INVALIDAS` | 401 | Correo o contraseña incorrectos. **Idéntico** exista o no la cuenta |
| `SESION_INVALIDA` | 401 | Sin sesión, caducada, inactiva o revocada |
| `PERMISO_DENEGADO` | 403 | Autenticado, pero le falta la capacidad. El mensaje dice cuál |
| `RECURSO_NO_ENCONTRADO` | 404 | No existe **en tu company** |
| `LIMITE_DEL_PLAN` | 409 | El permiso está bien; lo que no da es el plan |
| `ACCESO_BLOQUEADO` | 429 | Demasiados intentos de login fallidos. Escala: 1 → 5 → 15 → 60 min |
| `TOO_MANY_REQUESTS` | 429 | El limitador de peticiones. **No es lo mismo** que el anterior |
| `INTERNAL_ERROR` | 5xx | Fallo inesperado. Cita `x-correlation-id` en el ticket |

Los dos 429 son mecanismos distintos y el `code` es cómo se distinguen: uno dice «espera un momento», el otro «tu cuenta está bloqueada».

---

## Sesión

### `POST /auth/login` — público

```json
{ "email": "ana@snacklab.ec", "contrasena": "tres cebollas moradas" }
```

**200** → `{ "expiraEn": "2026-09-05T00:00:00.000Z" }` más `Set-Cookie: sesion=…`.

**El token no viaja en el cuerpo.** Devolverlo además en el JSON anularía el `HttpOnly`: cualquier script de la página podría leerlo de la respuesta.

**401** con el mismo cuerpo exista o no la cuenta, y con el mismo coste en tiempo. **429** `ACCESO_BLOQUEADO` tras cinco fallos de la cuenta en quince minutos.

### `POST /auth/logout` — sesión

**204.** Marca `revoked_at` en el servidor y borra la cookie. La misma cookie reenviada a mano da 401: no es «borrar la cookie del navegador».

### `POST /auth/password` — sesión

```json
{ "email": "ana@snacklab.ec", "actual": "…", "nueva": "…" }
```

**200** → `{ "sesionesRevocadas": 3 }`. Revoca **todas** las sesiones, la que hace la petición incluida: hay que volver a entrar. La contraseña actual se exige aunque ya haya sesión, para que una sesión robada no deje al titular fuera de su cuenta.

La nueva debe tener 12–128 caracteres, no estar en la lista de filtradas y no contener la parte local del correo. **No hay reglas de composición**: `Password1!` está en cualquier diccionario.

---

## Ubicaciones

### `GET /ubicaciones` — `location.read`

**200** → lista **acotada al alcance del usuario**. Un rol de nivel company (`OWNER`, `ADMIN`, `LECTURA`) ve todas las de su company; un `GERENTE_LOCAL` o un `BODEGA` ven solo las suyas. El filtro es del servidor, no de la UI.

### `POST /ubicaciones` — `location.create`

```json
{ "nombre": "Centro", "tipo": "LOCAL" }
```

`tipo` ∈ `BODEGA` · `LOCAL` · `AMBOS`. **201** con la ubicación creada. **409** `LIMITE_DEL_PLAN` al llegar al máximo del plan — comprobado dentro de la misma transacción que inserta, así que dos pestañas abiertas no lo saltan.

---

## Usuarios y roles

### `POST /usuarios` — `user.invite`

```json
{ "email": "nuevo@snacklab.ec" }
```

**202**, siempre, con cuerpo vacío. **No dice si el correo ya existe**: la unicidad es global, y una respuesta franca convertiría el endpoint en un oráculo para averiguar quién más usa el sistema. Si el correo estaba libre, se envía una invitación con un código de un solo uso que caduca en siete días.

### `POST /usuarios/activacion` — público

```json
{ "token": "…", "contrasena": "higos secos en almibar" }
```

**204.** El token es de un solo uso: la activación exige `status = INVITED`, así que el mismo enlace usado dos veces no cambia nada la segunda. **401** para token inexistente, ya usado o caducado — los tres dan la misma respuesta.

### `POST /usuarios/roles` · `DELETE /usuarios/roles` — `user.update`

```json
{ "userId": "…", "rol": "GERENTE_LOCAL", "locationId": "…" }
```

`locationId` es **anulable, no opcional**: hay que escribir `"locationId": null` para un rol de nivel company. Roles: `ADMIN`, `GERENTE_LOCAL`, `BODEGA`, `LECTURA`.

**204.** Asignar dos veces el mismo rol es idempotente.

**403** si: el rol es `OWNER` (la cesión de propiedad es otra operación), el objetivo **es** el `OWNER`, el objetivo es uno mismo, o el rol lleva ubicación cuando no debe (o al revés).

**404** si el usuario no existe **en tu company** — incluido el caso de que exista en otra.

---

## Salud

`GET /health` (liveness, no toca la base) y `GET /ready` (readiness, sí la toca). Públicas y fuera del limitador: las sondea el orquestador cada pocos segundos.
