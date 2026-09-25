# API del back office

> Proceso aparte (`npm run backoffice`, `apps/api/src/backoffice.ts`), en loopback, al que se llega por túnel SSH. Toda ruta exige sesión de operador (`POST /sesion`), y toda ruta que mira datos de **un** cliente exige además la cabecera `X-Motivo` (≥ 20 caracteres) y deja fila en `backoffice_access_log`. Las rutas de companies, planes, auditoría y accesos están descritas en `docs/pasos/P11/CONSTRUCCION.md` y `docs/pasos/P13/CONSTRUCCION.md`; aquí van las que se añadieron después.

> **Y desde P16-A2, toda mutación exige la cabecera `X-CSRF-Token`** (U4, ADR-021). El back office
> tiene **su propio** token: lo devuelve `POST /sesion` en el cuerpo, junto a `expiraEn`, vive en
> `backoffice_session.csrf_token` y no vale en la app cliente ni al revés. Lo comprueba
> `CsrfDeOperadorGuard`; sin él, o con uno ajeno, **403 `CSRF_INVALIDO`**. Las lecturas no lo
> necesitan. Una sesión de operador abierta **antes** de la migración no tiene token y se trata como
> inválida (401): hay que volver a entrar. **Por qué el panel más protegido de hecho lo lleva
> igualmente:** hoy lo defienden el `cors: false`, el `Content-Type: application/json` de su propia
> página y el loopback tras el túnel SSH — tres propiedades del despliegue de hoy, no del contrato.
> El día que alguien sirva un `<form method="post">` desde estas rutas, esas tres desaparecen sin que
> ningún check avise.

## Correo (P16-A1)

### `GET /correo/salud` — sesión de operador, sin motivo

La salud de la cola de correo transaccional (D-16.27c). Tres contadores para saber si el despachador corre y si el proveedor entrega, **sin abrir la cola**.

**Respuesta `200`:**

```json
{ "pendientesAntiguos": 0, "fallidos": 2, "ultimoEnvio": "2026-09-10T05:21:35.150Z" }
```

| Campo | Qué es |
|---|---|
| `pendientesAntiguos` | Correos `PENDIENTE` creados hace más de `CORREO_MINUTOS_DE_ALERTA` minutos (15 por defecto). Más de cero: el despachador no corre, o lleva reintentando |
| `fallidos` | Correos `FALLIDO` (cinco intentos agotados). Cada uno es una invitación o un restablecimiento que alguien tendrá que reenviar desde la aplicación |
| `ultimoEnvio` | `sent_at` del último `ENVIADO`, o `null` si nunca salió ninguno |

**Lo que NUNCA lleva (D-16.34):** `datos`, destinatarios, ids, companies. Son agregados sobre la cola entera; el rol `costeo_backoffice` ni siquiera tiene `SELECT` sobre la columna `datos`, así que la garantía no depende del código. Una prueba de integración lo comprueba sobre la respuesta cruda (`backoffice-interfaz.spec.ts`: sin `datos`, sin `@`, sin `token`).

**No pide `X-Motivo` ni deja fila en `backoffice_access_log`**, y es la segunda excepción del back office (la primera es `GET /accesos`): el motivo existe para dejar rastro de quién miró datos de un cliente, y aquí no se mira ninguno. Un motivo obligatorio para tres números de operación se rellenaría con «salud» y enterraría los accesos que sí importan.

**Errores:** `401 SESION_INVALIDA` sin cookie de operador.

**Dónde se ve:** tarjeta «Cola de correo» al principio de la vista *Cartera* de la interfaz; se pinta en aviso cuando hay pendientes con retraso o fallidos.
