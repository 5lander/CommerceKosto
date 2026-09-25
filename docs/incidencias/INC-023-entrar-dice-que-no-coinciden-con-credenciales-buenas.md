# INC-023 — «Entrar» dice «El correo o la contraseña no coinciden» con credenciales correctas

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-13 |
| **Paquete** | Introducido en P16-A2 · encontrado en P16 · Armazón |
| **Área** | frontend · seguridad |
| **Tiempo perdido** | ~15 min |
| **Recurrencias** | 0 |

> **El mensaje acusa a las credenciales, y las credenciales estaban bien.** `curl` contra
> `POST /auth/login` con el mismo correo y la misma contraseña respondía 200. El fallo no estaba en el
> login: el login **no llegaba a salir del navegador**.

## Síntoma

En `/entrar`, con un usuario recién sembrado y su contraseña correcta:

```
El correo o la contraseña no coinciden.
```

En el log de la API **no hay ningún `POST /auth/login`** del navegador. Hay, en cambio, un
`GET /auth/sesion` con 401 por cada intento:

```
     60 "method":"GET","url":"/auth/sesion"
      1 "method":"POST","url":"/auth/login"      ← el de curl
     54 "statusCode":401
```

## Contexto

Capturando el armazón con Chrome sin cabeza contra el build de producción, con tres usuarios
sintéticos del tenant de ensayo (`duena@`, `gerente@`, `bodega@ensayo.invalid`). Es la primera vez
desde P16-A2 que alguien entra en `apps/web` **desde un navegador sin cookie de sesión**: las pruebas
de integración de la API usan `supertest`, que no pasa por `lib/api.ts`, y P16-A2, B y C no tocaban
pantallas.

## Causa raíz

P16-A2 (ADR-021) añadió el token anti-CSRF a toda mutación. `lib/api.ts` lo obtenía así:

```ts
async function cabecerasDe(metodo, cuerpo) {
  if (metodo !== 'GET') cabeceras['X-CSRF-Token'] = await tokenDeMutacion();
}
async function tokenDeMutacion() {
  const enMemoria = csrfEnMemoria();
  if (enMemoria !== null) return enMemoria;
  const sesion = await llamar({ ruta: '/auth/sesion' });   // ← sin cookie: 401, y el error sube
  …
}
```

`POST /auth/login` es una mutación, así que antes de mandarla el cliente pedía un token a
`GET /auth/sesion`. **Sin sesión esa lectura es 401**, el error subía, el login no se enviaba, y
`Entrar` —que convierte todo error que no sea el bloqueo en el mensaje deliberadamente vago— pintaba
«no coinciden».

En la API todo estaba bien: las cuatro rutas `@Publico()` están fuera del guard de CSRF. **Lo que no
sabía la API lo tenía que saber el cliente, y no lo sabía.**

## Solución

`lib/api.ts`: si `GET /auth/sesion` responde `SESION_INVALIDA`, `tokenDeMutacion` devuelve `null` y la
mutación sale **sin** cabecera. La API decide: una ruta pública funciona y una protegida contesta
`SESION_INVALIDA`.

```ts
try {
  const sesion = await intentar<SesionDeLaApi>({ ruta: '/auth/sesion' });
  guardarCsrf(sesion.csrf);
  return sesion.csrf;
} catch (fallo) {
  if (codigoDe(fallo) === SESION_INVALIDA) return null;
  throw fallo;
}
```

Verificado en el navegador: los tres usuarios entran, eligen sucursal y navegan; guardar ventas y
anotar un conteo llevan el token y persisten tras recargar.

## Qué NO era

- **Contraseña mal hasheada por `seed:tenant`** → descartada: `curl` con la misma contraseña da 200.
- **CORS entre `localhost:3100` y `localhost:3000`** → descartada: el `GET /auth/sesion` del mismo
  navegador sí llega a la API, con `Access-Control-Allow-Origin` correcto.
- **El formulario rellenado antes de hidratar React** → descartada: el mensaje «no coinciden» lo pinta
  React, luego el manejador corrió.

## Prevención

- [x] **¿Se puede eliminar el modo de fallo en vez de vigilarlo?** Sí, y es lo que se hizo. Descartado
  un flag `sinSesion: true` en las llamadas públicas: es una lista en el cliente, y la quinta ruta
  pública —`/olvide`, `/restablecer`, `/activacion` llegan en la pantalla 1b— es la que alguien
  olvida. Sin lista, no hay nada que olvidar (ADR-022, decisión 4).
- [x] **¿Prueba automatizada?** *Desde la pantalla 1b, sí*: `lib/api.spec.ts` —«sin sesión, la mutación
  sale SIN cabecera y llega a la API»—, con guardián (INC-025). Lo que sigue es la historia. No en el commit del armazón: `apps/web` no tiene ejecutor de pruebas —la deuda #8 de
  `ESTADO.md` lo dice de la capa visual, y tampoco lo hay para `lib/`—, y montar uno para una función es la abstracción especulativa de `OPTIMIZACION.md` §1.
  **Si vuelve un fallo del cliente que ninguna prueba de la API puede ver, se monta.** *(Volvió un
  commit después —INC-024, el signo en `lib/decimales`— y se montó: `node --test`, ADR-027. Este fallo
  en concreto quedó con prueba en la pantalla 1b, simulando `fetch` en `globalThis`.)*
- [x] **¿Regla de proceso?** Ya existía y es la que lo cazó: cada commit de pantalla se verifica
  **entrando de verdad** con los roles, no con una cookie pegada a mano. P16-A2, B y C no tocaban
  pantallas y por eso nadie entró.

## Referencias

- ADR-021 (el token anti-CSRF; las rutas `@Publico()`), ADR-022 (decisión 4).
- `apps/web/src/lib/api.ts` → `tokenDeMutacion`.
