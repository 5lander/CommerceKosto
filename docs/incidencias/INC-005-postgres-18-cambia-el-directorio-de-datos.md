# INC-005 — El contenedor de PostgreSQL 18 no arranca: "there appears to be PostgreSQL data in /var/lib/postgresql/data (unused mount/volume)"

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | despliegue · base de datos |
| **Tiempo perdido** | ~15 min |
| **Recurrencias** | 1 |

## Síntoma

`docker compose up -d db` deja el contenedor en estado `unhealthy` y en bucle de reinicio. El log no dice "error de configuración" ni "permiso denegado": dice que hay datos donde no debería haberlos.

```
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" (specifically, using
       major-version-specific directory names).  This better reflects how
       PostgreSQL itself works, and how upgrades are to be performed.

       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)

       This is usually the result of upgrading the Docker image without
       upgrading the underlying database using "pg_upgrade" (which requires both
       versions).

       The suggested container configuration for 18+ is to place a single mount
       at /var/lib/postgresql which will then place PostgreSQL data in a
       subdirectory, allowing usage of "pg_upgrade --link" without mount point
       boundary issues.
```

Lo desconcertante: el volumen era **nuevo y vacío**. El mensaje habla de una actualización que nunca ocurrió.

## Contexto

Primer `docker compose up -d db` de P0, con un `docker-compose.yml` escrito con la convención de siempre:

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
```

Esa línea es correcta para PostgreSQL 9 a 17 y aparece así en prácticamente toda la documentación y todos los ejemplos que circulan.

## Causa raíz

**Las imágenes oficiales de PostgreSQL 18 cambiaron el punto de montaje.** A partir de la 18, los datos viven en un subdirectorio con el nombre de la versión mayor (`/var/lib/postgresql/18/docker`), para que `pg_upgrade --link` pueda funcionar sin cruzar un límite de montaje.

El entrypoint detecta que hay un volumen montado exactamente en `/var/lib/postgresql/data` —el sitio de la convención antigua— y **se niega a arrancar por seguridad**: no puede distinguir "volumen vacío en el sitio equivocado" de "datos de una versión anterior que alguien va a perder". Prefiere fallar a arriesgarse, que es lo correcto, pero el mensaje describe el escenario peligroso y no el que de verdad está ocurriendo.

## Solución

Montar el volumen **un nivel más arriba**:

```yaml
volumes:
  # PostgreSQL 18+ cambio la convencion: el montaje va en /var/lib/postgresql,
  # NO en /var/lib/postgresql/data.
  - pgdata:/var/lib/postgresql
```

Si ya se creó el volumen con la ruta antigua, hay que eliminarlo: la estructura interna no coincide y el contenedor seguirá negándose.

```bash
docker compose down -v
docker compose up -d db
```

`down -v` **borra los datos**. En P0 es inocuo porque la base estaba vacía; en cualquier otro momento hay que hacer copia antes.

## Qué NO era

- **No era un volumen sucio de una prueba anterior.** Era la primera creación; el volumen estaba vacío.
- **No era una actualización de versión mal hecha**, aunque el mensaje lo sugiera con insistencia. Nunca hubo una versión anterior.
- **No era `POSTGRES_INITDB_ARGS --data-checksums`.** Fue la primera sospecha por ser la opción menos habitual del compose; se descartó porque el error aparece antes de que `initdb` llegue a ejecutarse.
- **No era un problema de permisos del volumen en Docker Desktop para Windows**, que es el sospechoso habitual cuando un contenedor de base de datos no arranca en esta plataforma.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí.** `audit:forbidden` incluye la regla `postgres-18-monta-en-var-lib-postgresql`: falla si un `docker-compose*.yml` monta un volumen en `/var/lib/postgresql/data`.
- [x] ¿Se puede convertir en una prueba automatizada? **Sí, ya lo está de hecho:** el job de CI levanta el compose y las pruebas de integración no pueden conectarse si la base no arranca. El fallo es ruidoso e inmediato.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No: es específica de la imagen, no del diseño.
- [ ] ¿Es una decisión que merece un ADR? No. La versión ya está justificada en ADR-001.

## Referencias

- `docker-library/postgres` PR #1259 — el cambio de convención en la 18
- `docker-library/postgres` issue #37 — la discusión larga sobre `pg_upgrade` y los límites de montaje
- Consultado el 2026-08-27
