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

echo "[desplegar] 1/8  codigo"
git pull --ff-only

# LAS DOS IMAGENES, EN SU PROPIO PASO Y ANTES DE TOCAR NADA.
#
# Con `set -e`, un build que falle aborta el despliegue aqui, que es lo que tiene
# que pasar. **No se usa `up -d --build`**: cuando el build falla, ese comando
# deja el contenedor ANTERIOR corriendo, su comprobacion de salud sigue en verde
# y el despliegue parece haber funcionado mientras sirve codigo viejo. Paso de
# verdad y esta contado en INC-018.
echo "[desplegar] 2/8  imagenes de la API y de la interfaz"
"${COMPOSE[@]}" build api web

echo "[desplegar] 3/8  base y pooler"
"${COMPOSE[@]}" up -d db pgbouncer

echo "[desplegar] 4/8  esperando a que la base este sana"
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

# LOS ROLES QUE UN CLUSTER YA EN PIE NO CREA SOLO. `roles.sql` corre una unica
# vez, cuando el volumen de datos esta vacio; un rol que un paquete estrena
# despues (costeo_backoffice en P11, costeo_despachador en P16-A1) no existe en
# el VPS desplegado antes, y la migracion que lo necesita FALLA EN ALTO si
# falta. Los dos scripts son idempotentes y no rotan contrasenas: si el rol ya
# existe, solo conceden CONNECT. Necesitan psql, que aqui va por
# `docker compose exec db`, y POSTGRES_SUPERUSER_PASSWORD del .env de arriba.
echo "[desplegar] 5/8  dependencias y roles del cluster (costeo_backoffice, costeo_despachador)"
npm ci --omit=dev --ignore-scripts
npm run rol:backoffice
npm run rol:despachador

# Las migraciones NO corren dentro del contenedor de la API: corren aqui, con
# MIGRATION_DATABASE_URL, que apunta a 127.0.0.1 porque el puerto esta atado ahi.
echo "[desplegar] 6/8  migraciones, como costeo_migrator"
npm exec --yes prisma migrate deploy -- --schema apps/api/prisma/schema.prisma

# `correo` usa la imagen de `api` (misma imagen, otro binario): no se construye
# aparte y arranca en el mismo paso.
echo "[desplegar] 7/8  API, despachador de correo, interfaz y proxy"
"${COMPOSE[@]}" up -d api correo web caddy

echo "[desplegar] 8/8  comprobando"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT:-3000}/ready" >/dev/null 2>&1; then
    listo=si
    break
  fi
  sleep 2
done

if [ "${listo:-}" != "si" ]; then
  echo "La API no respondio a /ready." >&2
  "${COMPOSE[@]}" logs --tail=50 api >&2
  exit 1
fi

# LA INTERFAZ Y SUS RECURSOS, NO SOLO LA PAGINA.
#
# `output: standalone` de Next NO incluye `public/` ni `.next/static`: el
# Dockerfile los copia aparte. Si esas dos lineas se pierden, el servidor arranca
# igual, `/entrar` responde 200 y lo que falta son los recursos — y **el sintoma
# es parcial y por eso cruel**: sin la hoja de estilos con las tipografias la
# aplicacion se ve, solo que con otra letra, y eso no se nota hasta que alguien
# mira de cerca. Sin `/marca/` el logotipo es un icono roto.
#
# Por eso se comprueban los tres, no solo la pagina.
for recurso in /entrar /marca/logotipo.svg /fuentes/inter-400-latin.woff2; do
  if ! curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT:-3001}$recurso"; then
    echo "La interfaz no sirve $recurso." >&2
    "${COMPOSE[@]}" logs --tail=50 web >&2
    exit 1
  fi
done

# Y por el proxy, que es por donde entra el cliente: la API bajo /api y la
# interfaz en la raiz. Si el enrutado esta mal, aqui se ve y no el lunes.
if ! curl -fsSk -o /dev/null "https://${DOMINIO}/api/health"; then
  echo "El proxy no llega a la API en /api/health." >&2
  "${COMPOSE[@]}" logs --tail=50 caddy >&2
  exit 1
fi

# EL DESPACHADOR NO TIENE PUERTO: su salud es el latido que escribe tras cada
# pasada, y el healthcheck del contenedor es quien lo mira. Se espera a que
# Docker lo de por sano; si no lo hace, un despachador caido son invitaciones
# que nunca llegan sin ningun error a la vista del cliente.
for _ in $(seq 1 30); do
  estado_correo=$(docker inspect -f '{{.State.Health.Status}}' costeo-correo 2>/dev/null || echo starting)
  [ "$estado_correo" = "healthy" ] && break
  sleep 3
done
if [ "${estado_correo:-}" != "healthy" ]; then
  echo "El despachador de correo no llego a healthy." >&2
  "${COMPOSE[@]}" logs --tail=50 correo >&2
  exit 1
fi

echo "[desplegar] listo — API, despachador de correo, interfaz y proxy responden"
