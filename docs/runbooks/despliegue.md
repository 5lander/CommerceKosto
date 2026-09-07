# Runbook — despliegue

> Comandos exactos, sin prosa. **Estado: P0.** Cubre el entorno local y el arranque del contenedor; el despliegue a producción se completa en P15.

## Requisitos

- Node **24.x** (`.nvmrc` fija 24.20.0) · npm ≥ 11
- Docker con Compose v2
- Git ≥ 2.9 (por `core.hooksPath`)

## Primer arranque en una máquina limpia

```sh
git clone <repo> && cd CommerceKosto
cp .env.example .env          # y edita las tres contraseñas
npm ci                        # instala, activa los hooks y genera el cliente de Prisma
npm run db:up                 # levanta PostgreSQL 18.6 (crea los roles) y PgBouncer
npm run migrate:deploy        # aplica las migraciones como costeo_migrator
npm run audit                 # los once checks
```

Si algo falla, antes de investigar:

```sh
npm run doctor                # revisa el entorno y dice qué arreglar
```

## Comandos de trabajo diario

```sh
npm run dev                   # API en caliente, contra la base del contenedor
npm run test:unit             # dominio, con la base APAGADA
npm run test:integration      # aislamiento, roles, cabeceras
npm run audit                 # los once checks
npm run migrate:new -- <slug> # nueva migración, con su down.sql
npm run migrate:down          # revierte la última
npm run migrate:verify        # la escalera completa de reversibilidad (ADR-004)
```

## Levantar el stack completo

Es el criterio de aceptación de P0: **sin una sola credencial real.**

```sh
docker compose up -d --build
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
docker compose logs -f api
docker compose down           # sin -v: conserva el volumen de datos
```

## Migraciones en producción

**Corren en su propio paso, con su propia credencial, antes de arrancar la aplicación.**

```sh
MIGRATION_DATABASE_URL=... npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Reglas que el esquema de entorno hace cumplir por su cuenta:

- El proceso de la API **no** puede tener `MIGRATION_DATABASE_URL` ni `SHADOW_DATABASE_URL` en su entorno. Si las tiene, no arranca.
- `DATABASE_URL` debe usar el rol `costeo_app`. Con cualquier otro, no arranca.
- `costeo_shadow` **no existe en producción**: `migrate deploy` no la usa.

## Cargar el catálogo de un cliente en producción

El importador **se niega a correr con `NODE_ENV=production`**. Es deliberado: un `--company` copiado
del sitio equivocado escribe cientos de filas en la base de otro. Para la carga inicial de un cliente
—que sí ocurre en producción— la vía es explícita y queda registrada.

```bash
export COSTEO_IMPORT_PASSWORD='<la contrasena del usuario que carga>'

npm run importar -- <archivo.csv> --tipo=ITEMS   --company=<uuid> --ubicacion=<uuid> --usuario=<correo>   --operacion-supervisada --confirmar
```

`--operacion-supervisada` **no basta por sí sola**: sin `--confirmar` sigue sin escribir. Antes de
tocar nada imprime contra qué base va, con qué company y con qué usuario — **léelo**:

```
*** OPERACION SUPERVISADA CONTRA PRODUCCION ***
Base:    postgresql://<host>:5432/costeo
Company: 0198...
Usuario: admin@cliente.ec
```

**Orden de las pasadas.** No es arbitrario: cada una necesita lo que puso la anterior.

```
ITEMS  ->  ARTICULOS  ->  PRECIOS  ->  PRODUCTOS  ->  RECETAS  ->  MOVIMIENTOS
```

**Corre cada pasada primero SIN `--confirmar`.** Imprime el informe con fila y columna de cada
problema y no escribe nada. Solo cuando el informe salga limpio, repite con `--confirmar`.

**Los precios nacen sugeridos.** Añade `--confirmar-precios` en la pasada de `PRECIOS` para dejarlos
vigentes; sin eso el costeo no devuelve número. Es un acto explícito porque R5 lo exige, y queda en
el log de auditoría con el nombre de quien lo hizo.

**Si una pasada falla, no escribió nada** — es todo o nada dentro de la pasada. Lo que sí puede pasar
es que fallen las pasadas 3 en adelante con las dos primeras ya dentro: el comando dice cuáles se
aplicaron.

---

## Revertir un despliegue

```sh
npm run migrate:down          # revierte la última migración aplicada
```

El `down.sql` borra su propia fila de `_prisma_migrations`, así que es atómico y no hace falta `migrate resolve`. **No se revierte restaurando un respaldo**: el libro de inventario es append-only y un respaldo destruiría los movimientos posteriores (ADR-004).

## Solución de problemas conocidos

| Síntoma | Ficha |
|---|---|
| `bad interpreter: /bin/sh^M` | [INC-001](../incidencias/INC-001-hook-pre-commit-bad-interpreter.md) |
| `psql: command not found` | [INC-002](../incidencias/INC-002-psql-no-esta-en-el-path.md) |
| `Cannot find module '@swc/core-linux-x64-gnu'` en el contenedor | [INC-003](../incidencias/INC-003-binarios-win32-dentro-del-contenedor.md) |
| `migrate diff` da un `down.sql` vacío | [INC-004](../incidencias/INC-004-migrate-diff-genera-down-vacio.md) |
| El contenedor de PostgreSQL queda `unhealthy` al arrancar | [INC-005](../incidencias/INC-005-postgres-18-cambia-el-directorio-de-datos.md) |
| Un script de Node recibe el SQL partido, o falla con `stderr` vacío | [INC-006](../incidencias/INC-006-spawn-en-windows-parte-los-argumentos.md) |

## Pendiente para P15

- Estrategia de despliegue (azul/verde o rolling) y comprobación de `/ready` antes de dar tráfico
- Gestor de secretos: hoy las contraseñas salen de `.env`, en producción no pueden
- Respaldos y su restauración probada (`respaldos-y-restauracion.md`)
- PgBouncer en modo transacción, con el escenario probado (ADR-002)
