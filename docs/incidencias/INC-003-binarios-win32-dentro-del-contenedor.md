# INC-003 — Errores incomprensibles de módulos nativos dentro del contenedor

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | despliegue · build |
| **Tiempo perdido** | 0 min — **anticipada en la fase PLAN** |
| **Recurrencias** | 0 |

## Síntoma

Dentro del contenedor de la API, con la aplicación funcionando perfectamente en el host:

```
Error: Cannot find module '@swc/core-linux-x64-gnu'
Error: Failed to load native binding
```

o bien:

```
Error: Cannot find module '/app/node_modules/argon2/build/Release/argon2.node'
Was this module built for a different platform?
```

o, con Prisma:

```
Error: Query engine library for current platform "debian-openssl-3.0.x" could not be found.
```

Lo desconcertante es que el mensaje apunta a un módulo que **sí está** en `node_modules`.

## Contexto

`docker compose up` con un bind mount del código fuente del proyecto, del estilo:

```yaml
volumes:
  - .:/app          # ← esto es el problema
```

Es el patrón habitual para tener recarga en caliente. En un proyecto sin dependencias nativas funciona; aquí no.

## Causa raíz

El bind mount monta el `node_modules` del **host Windows** dentro de un contenedor **Linux**. Los paquetes con binarios compilados por plataforma —`@swc/core`, `argon2`, los engines de Prisma— traen la variante `win32-x64` y no la `linux-x64-gnu`. El módulo existe, pero su binding nativo es para otro sistema operativo.

El mensaje apunta al lugar equivocado: parece un problema de instalación de dependencias, y no lo es. Es un problema de qué `node_modules` está viendo el proceso.

Como efecto secundario, un bind mount de `node_modules` entre Windows y Linux es **muy lento** en Docker Desktop, así que además de romper, arrastra.

## Solución

**No montar el código fuente en el contenedor de la API.** Dos comandos claramente separados, con propósitos distintos:

| Comando | Qué levanta | Para qué |
|---|---|---|
| `npm run db:up` → `docker compose up -d db` | Solo PostgreSQL | Desarrollo diario: `npm run dev` corre en el host, contra esa base |
| `docker compose up` | `db` + `api` | Verificar que la aplicación arranca tal como correrá en producción |

La imagen de la API se construye con un `Dockerfile` multi-stage **sin ningún montaje**: las dependencias se instalan dentro, para Linux. Complementos obligatorios:

- `.dockerignore` que excluya `node_modules`, `dist` y `.git` — si no, el contexto de build sube el `node_modules` de Windows y `COPY . .` lo mete igual.
- `CMD ["node", "dist/main.js"]` en forma exec, sin scripts `.sh` intermedios: elimina de raíz cualquier problema de CRLF dentro de la imagen (ver INC-001; Alpine no trae `dos2unix`).
- Usuario no-root y sin herramientas de build en la imagen final (SEGURIDAD.md §9).

Esto es además lo que satisface el criterio de aceptación de P0: *"`docker compose up` levanta la aplicación sin una sola credencial real"*, con `MAIL_ADAPTER=fake` y `STORAGE_ADAPTER=fake`.

## Qué NO era

- **No era falta de `npm install`.** El módulo estaba instalado; era para la plataforma equivocada.
- **No se arregla con `npm rebuild` dentro del contenedor.** Puede funcionar una vez, pero se rompe en cuanto el host reinstala, y deja el `node_modules` del host contaminado con binarios de Linux — el mismo problema al revés.
- **No es un volumen anónimo mal puesto.** El truco de montar `/app/node_modules` como volumen anónimo encima del bind mount lo esconde, pero deja dos árboles de dependencias desincronizados y errores fantasma cuando cambia el `package-lock.json`.
- **No es específico de Prisma.** Prisma solo es el primero en quejarse porque carga su engine al arrancar.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí.** `audit:forbidden` incluye la regla `sin-bind-mount-de-codigo`: falla si `docker-compose.yml` monta `.` o `./src` sobre el servicio `api`.
- [x] ¿Se puede convertir en una prueba automatizada? **Sí.** El job de CI construye la imagen y levanta `docker compose up` sobre Ubuntu; si alguien reintroduce el montaje, falla ahí.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? Ya está cubierta por §12 (contenedores con versiones fijadas) y por SEGURIDAD.md §9.
- [ ] ¿Es una decisión que merece un ADR? Se registra dentro del ADR de la fundación del repositorio.

## Referencias

- `npm` documenta que los paquetes opcionales por plataforma se resuelven con los campos `os` y `cpu` — consultado 2026-08-27
