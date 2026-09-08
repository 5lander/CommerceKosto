#!/usr/bin/env bash
#
# Primer arranque de un VPS limpio. Se ejecuta UNA vez, como root.
#
#   curl -fsSL https://.../preparar.sh | bash    <- NO. Descargalo y leelo.
#   scp scripts/vps/preparar.sh root@<ip>:/root/ && ssh root@<ip> bash preparar.sh
#
# QUE HACE Y QUE NO. Instala Docker, cierra el cortafuegos, crea el directorio de
# secretos y deja el esqueleto del `.env`. **No arranca nada** y **no genera las
# contrasenas**: eso es el paso siguiente, y va con una persona delante.

set -euo pipefail

DIRECTORIO_SECRETOS=/etc/costeo
DIRECTORIO_APP=/opt/costeo

echo "[vps] paquetes del sistema"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw

echo "[vps] Docker desde el repositorio oficial"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# --- Cortafuegos -------------------------------------------------------------
#
# SOLO TRES PUERTOS. El 22 para entrar, el 80 para que Let's Encrypt valide, el
# 443 para el trafico. PostgreSQL **no** aparece: esta atado a 127.0.0.1 en el
# compose, que es lo que de verdad lo protege.
#
# OJO, Y ESTO ES LO QUE MUERDE: `ufw` NO ve el trafico que Docker publica.
# Docker escribe sus propias reglas en la cadena DOCKER de iptables, por delante
# de las de ufw. Un `- '5432:5432'` en el compose abre el puerto a internet
# aunque ufw diga que esta cerrado, y `ufw status` sigue diciendo que todo va
# bien. Por eso los puertos van atados a 127.0.0.1 en el compose y no se confia
# el aislamiento a este cortafuegos.
echo "[vps] cortafuegos"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'ssh'
ufw allow 80/tcp   comment 'let s encrypt'
ufw allow 443/tcp  comment 'https'
ufw --force enable
ufw status verbose

echo "[vps] directorios"
mkdir -p "$DIRECTORIO_SECRETOS" "$DIRECTORIO_APP"
chmod 700 "$DIRECTORIO_SECRETOS"

if [ ! -f "$DIRECTORIO_SECRETOS/.env" ]; then
  cat > "$DIRECTORIO_SECRETOS/.env" <<'PLANTILLA'
# Secretos de produccion. NUNCA en el repositorio (SEGURIDAD.md 9).
# Genera cada contrasena con:
#   openssl rand -base64 48 | tr -d '\n/+=' | head -c 48; echo

POSTGRES_DB=costeo
POSTGRES_PORT=5432
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=
COSTEO_MIGRATOR_PASSWORD=
COSTEO_APP_PASSWORD=

DATABASE_URL=postgresql://costeo_app:@db:5432/costeo?schema=public&connection_limit=10&pool_timeout=10
MIGRATION_DATABASE_URL=postgresql://costeo_migrator:@localhost:5432/costeo?schema=public

NODE_ENV=production
LOG_LEVEL=info
PORT=3000
REQUEST_TIMEOUT_MS=15000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
MAIL_ADAPTER=fake
STORAGE_ADAPTER=fake

DOMINIO=
CORREO_TLS=

# Como se sube el respaldo FUERA de esta maquina. Recibe la ruta del archivo.
# Sin esto, el respaldo se queda en el disco que puede morir.
RESPALDO_COMANDO_SUBIDA=
RESPALDO_RETENCION_DIAS=14
PLANTILLA
  chmod 600 "$DIRECTORIO_SECRETOS/.env"
  echo "[vps] plantilla en $DIRECTORIO_SECRETOS/.env — RELLENALA antes de desplegar"
fi

echo
echo "[vps] listo. Lo que falta, y lo haces tu:"
echo "  1. Rellenar $DIRECTORIO_SECRETOS/.env (las tres contrasenas, DOMINIO, CORREO_TLS)"
echo "  2. Apuntar el DNS del dominio a la IP de esta maquina y ESPERAR a que propague"
echo "  3. git clone del repositorio en $DIRECTORIO_APP"
echo "  4. bash scripts/vps/desplegar.sh"
