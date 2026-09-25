#!/usr/bin/env bash
#
# Respaldo diario. Va en cron:
#
#   0 3 * * * cd /opt/costeo && bash scripts/vps/respaldo-diario.sh >> /var/log/costeo-respaldo.log 2>&1
#
# LO QUE ESTE SCRIPT ANADE A `npm run respaldo`: sacar el archivo de la maquina.
# Un respaldo en el disco que puede morir no es un respaldo, es una copia.
#
# Y FALLA RUIDOSAMENTE. `set -euo pipefail` mas un aviso explicito si no hay
# comando de subida configurado: el modo de fallo que mata es el silencioso.

set -euo pipefail

ENV_PRODUCCION=/etc/costeo/.env
set -a
# shellcheck disable=SC1090
. "$ENV_PRODUCCION"
set +a

echo "=== $(date -Is) ==="

# Vuelca, RESTAURA sobre una base desechable y compara recuentos. Si no cuadra,
# sale distinto de cero y el archivo no se guarda.
npm run respaldo

ARCHIVO=$(ls -t .respaldos/*.dump | head -1)

if [ -z "${RESPALDO_COMANDO_SUBIDA:-}" ]; then
  echo "AVISO GRAVE: RESPALDO_COMANDO_SUBIDA esta vacio." >&2
  echo "El respaldo se ha quedado en ESTA maquina, que es la que puede morir." >&2
  echo "Configuralo en $ENV_PRODUCCION. Ver docs/runbooks/respaldos-y-restauracion.md." >&2
  exit 1
fi

echo "[respaldo-diario] subiendo $ARCHIVO fuera de la maquina"
# El comando recibe la ruta del archivo como unico argumento.
# shellcheck disable=SC2086
$RESPALDO_COMANDO_SUBIDA "$ARCHIVO"

# Los segmentos de WAL que PostgreSQL ya archivo. Se suben y se limpian los que
# son mas viejos que el ultimo volcado completo: sin esa poda, el volumen crece
# hasta llenar el disco y **PostgreSQL deja de aceptar escrituras**.
echo "[respaldo-diario] subiendo los segmentos de WAL"
docker run --rm -v costeo-wal:/wal alpine:3 sh -c 'ls -1 /wal | head -200' | while read -r segmento; do
  docker run --rm -v costeo-wal:/wal alpine:3 cat "/wal/$segmento" > "/tmp/$segmento"
  # shellcheck disable=SC2086
  $RESPALDO_COMANDO_SUBIDA "/tmp/$segmento"
  rm -f "/tmp/$segmento"
done

echo "[respaldo-diario] limpiando WAL anterior al ultimo volcado"
docker run --rm -v costeo-wal:/wal alpine:3 sh -c 'find /wal -type f -mtime +2 -delete'

echo "[respaldo-diario] listo"
