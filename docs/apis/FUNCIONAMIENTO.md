# APIs — funcionamiento general

> Un archivo por superficie. Cada endpoint se documenta con `docs/plantillas/API-ENDPOINT.md`, **en el mismo commit** en que se implementa.

## Superficies

| Superficie | Archivo | Consumidor |
|---|---|---|
| API de la aplicación cliente | `app-cliente.md` | Frontend de comercios |
| API del back office | `back-office.md` | Frontend interno |

## Reglas transversales

- **El tenant nunca viaja en la petición.** Sale siempre de la sesión autenticada
- Toda respuesta es una **proyección por rol**, no un objeto completo filtrado. Ver `CLAUDE.md` §4.3
- Errores con formato único; el mensaje al usuario y el detalle del log son cosas distintas
- Paginación por cursor, nunca por offset
- Validación por esquema en todo límite externo
