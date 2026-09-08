#!/usr/bin/env bash
#
# Despliegue. Se ejecuta en el VPS, dentro del clon del repositorio.
#
#   cd /opt/costeo && bash scripts/vps/desplegar.sh
#
# EL ORDEN NO ES NEGOCIABLE, y es el mismo que el runbook de P0 ya fijaba:
# las migraciones corren en SU PROPIO PASO, con SU PROPIA credencial, ANTES de
# arrancar la aplicacion. Si la aplicacion arrancara primero, atenderia trafico
# contra un esquema viejo; si migrara ella misma, tendria en su entorno la
# credencial del dueno de las tablas, y la Barrera 1 seria decorativa.

set -euo pipefail

ENV_PRODUCCION=/etc/costeo/.env
COMPOSE=(docker compose --env-file "$ENV_PRODUCCION" -f docker-compose.yml -f docker-compose.prod.yml)

if [ ! -f "$ENV_PRODUCCION" ]; then
  echo "Falta $ENV_PRODUCCION. Ejecuta antes scripts/vps/preparar.sh." >&2
  exit 1
fi

# Se cargan aqui para los pasos que no pasan por compose (las migraciones).
set -a
# shellcheck disable=SC1090
. "$ENV_PRODUCCION"
set +a

echo "[desplegar] 1/6  codigo"
git pull --ff-only

echo "[desplegar] 2/6  imagen de la API"
"${COMPOSE[@]}" build api

echo "[desplegar] 3/6  base y pooler"
"${COMPOSE[@]}" up -d db pgbouncer

echo "[desplegar] 4/6  esperando a que la base este sana"
for _ in $(seq 1 60); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' costeo-db 2>/dev/null || echo starting)
  [ "$estado" = "healthy" ] && break
  sleep 2
done
if [ "${estado:-}" != "healthy" ]; then
  echo "La base no llego a healthy." >&2
  "${COMPOSE[@]}" logs db >&2
  exit 1
fi

# Las migraciones NO corren dentro del contenedor de la API: corren aqui, con
# MIGRATION_DATABASE_URL, que apunta a 127.0.0.1 porque el puerto esta atado ahi.
echo "[desplegar] 5/6  migraciones, como costeo_migrator"
npm ci --omit=dev --ignore-scripts
npm exec --yes prisma migrate deploy -- --schema apps/api/prisma/schema.prisma

echo "[desplegar] 6/6  API y proxy"
"${COMPOSE[@]}" up -d api caddy

echo "[desplegar] comprobando"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT:-3000}/ready" >/dev/null 2>&1; then
    echo "[desplegar] listo — /ready responde"
    exit 0
  fi
  sleep 2
done

echo "La API no respondio a /ready." >&2
"${COMPOSE[@]}" logs --tail=50 api >&2
exit 1
