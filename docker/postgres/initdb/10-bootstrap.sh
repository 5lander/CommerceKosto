#!/bin/bash
#
# Se ejecuta UNA sola vez, cuando el volumen de datos esta vacio.
#
# El entrypoint de la imagen de PostgreSQL solo ejecuta lo que esta en el primer
# nivel de /docker-entrypoint-initdb.d, asi que los .sql viven en sql/ y se
# aplican desde aqui, con las contrasenas pasadas como variables de psql.
#
# OJO CON LOS FINALES DE LINEA. Este archivo DEBE estar en LF: con CRLF, el
# contenedor Linux falla con `$'\r': command not found` y la base arranca sin
# roles, sin que nada lo avise hasta que la aplicacion no puede conectarse.
# Lo garantiza .gitattributes y lo verifica la regla `sin-crlf-en-archivo-posix`
# de audit:forbidden. Ver docs/incidencias/INC-001.

set -euo pipefail

: "${COSTEO_MIGRATOR_PASSWORD:?falta COSTEO_MIGRATOR_PASSWORD}"
: "${COSTEO_APP_PASSWORD:?falta COSTEO_APP_PASSWORD}"
: "${COSTEO_BACKOFFICE_PASSWORD:?falta COSTEO_BACKOFFICE_PASSWORD}"
: "${COSTEO_DESPACHADOR_PASSWORD:?falta COSTEO_DESPACHADOR_PASSWORD}"

# OJO CON $0: NO SIRVE AQUI. El entrypoint de la imagen ejecuta los .sh que
# tienen bit de ejecucion y SOURCEA los que no. Cuando sourcea, $0 sigue siendo
# /usr/local/bin/docker-entrypoint.sh, asi que `dirname "$0"` da /usr/local/bin
# y psql muere con `/usr/local/bin/sql/roles.sql: No such file or directory`.
# La base arranca sin roles y solo se ve en un volumen VACIO, que es justo lo
# que local nunca tiene y CI siempre. Ver docs/incidencias/INC-033.
# ${BASH_SOURCE[0]} es la ruta de ESTE archivo en los dos casos.
directorio="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sql"

echo "[initdb] creando roles costeo_migrator, costeo_app, costeo_backoffice y costeo_despachador"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v migrator_password="$COSTEO_MIGRATOR_PASSWORD" \
     -v app_password="$COSTEO_APP_PASSWORD" \
     -v backoffice_password="$COSTEO_BACKOFFICE_PASSWORD" \
     -v despachador_password="$COSTEO_DESPACHADOR_PASSWORD" \
     -f "$directorio/roles.sql"

# La base sombra que Prisma necesita para `migrate dev` y para generar los
# `down.sql` con `migrate diff`. Se crea aqui porque costeo_migrator es
# NOCREATEDB y no puede crearla al vuelo. Ver docs/incidencias/INC-004.
echo "[initdb] creando la base sombra costeo_shadow"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -c "CREATE DATABASE costeo_shadow OWNER costeo_migrator;"

for base in "$POSTGRES_DB" costeo_shadow; do
  echo "[initdb] aplicando privilegios en $base"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$base" \
       -f "$directorio/grants.sql"
done

echo "[initdb] listo"
