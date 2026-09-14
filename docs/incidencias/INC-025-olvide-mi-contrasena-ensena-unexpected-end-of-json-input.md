# INC-025 — «Olvidé mi contraseña» enseña «Failed to execute 'json' on 'Response': Unexpected end of JSON input»

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-14 |
| **Paquete** | P16 · pantalla 1b (el cliente lo arrastraba desde P1) |
| **Área** | frontend |
| **Tiempo perdido** | ~5 min |
| **Recurrencias** | 0 |

> **El error lo enseña la pantalla, y la petición salió bien.** El correo con el enlace estaba en el
> outbox; lo que falló fue leer la respuesta.

## Síntoma

En `/olvide`, al pedir el enlace, con cualquier correo:

```
Failed to execute 'json' on 'Response': Unexpected end of JSON input
```

## Contexto

Primer recorrido en el navegador de la pantalla 1b. `POST /auth/password/olvido` responde **202 sin
cuerpo**, siempre, para no delatar si el correo existe (P16-A1).

## Causa raíz

`lib/api.ts` solo trataba como vacío el **204**:

```ts
if (respuesta.status === SIN_CONTENIDO) return undefined as T;   // 204
return (await respuesta.json()) as T;                            // 202 vacío → revienta
```

Hasta la pantalla 1b ninguna llamada del cliente recibía un 202, así que nunca se vio.

## Solución

`cuerpoDe(respuesta)`: se lee el **texto** y se decide por lo que trae —vacío es `undefined`—, no por el
código de estado.

## Prevención

- [x] **¿Prueba automatizada?** Sí: `lib/api.spec.ts`, con `fetch` simulado y `node --test` (ADR-027).
  Para poder cargar `api.ts` sin compilar, su importe pasa a `./csrf.ts` y `ErrorDeApi` deja las
  propiedades de parámetro, que no son sintaxis borrable; `erasableSyntaxOnly` en `apps/web/tsconfig.json`
  convierte esa incompatibilidad en un error de `tsc`. Guardián: devolver `respuesta.json()` pone en rojo
  «un 202 sin cuerpo es `undefined`».
- [x] **Y la de INC-023, de paso**: el mismo archivo de pruebas fija que sin sesión la mutación sale sin
  cabecera. Guardián: devolver el `throw` en `SESION_INVALIDA` la pone en rojo.

## Referencias

- INC-023 · ADR-027 · `apps/web/src/lib/api.ts` → `cuerpoDe`.
