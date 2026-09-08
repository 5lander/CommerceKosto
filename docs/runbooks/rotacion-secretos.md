# Runbook — rotación de secretos

> Comandos exactos, sin prosa. `SEGURIDAD.md` §9: **secretos jamás en el repositorio.**

---

## Qué secretos existen

| Secreto | Quién lo usa | Dónde vive en producción |
|---|---|---|
| `POSTGRES_SUPERUSER_PASSWORD` | Solo el arranque de la base y los respaldos | `/etc/costeo/.env`, modo `600`, dueño `root` |
| `COSTEO_MIGRATOR_PASSWORD` | `migrate deploy`, en su propio paso | idem |
| `COSTEO_APP_PASSWORD` | El proceso de la API | idem |
| `COSTEO_IMPORT_PASSWORD` | Solo cuando se carga un catálogo | **No se guarda**: se exporta en la sesión y se va con ella |
| Contraseñas de usuarios de la app | Las personas | `app_user.password_hash`, Argon2id. No son nuestras y no se rotan desde aquí |

**Los tres primeros no están en el mismo sitio que el código.** El archivo `.env` de producción vive
en el VPS, fuera del `git clone`, y se monta en el contenedor. `.gitignore` lo excluye y
`audit:secrets` corre sobre cada diff.

**El superusuario no está en el entorno de la API.** El esquema de entorno rechaza el arranque si
`DATABASE_URL` no usa exactamente `costeo_app`, y `MIGRATION_DATABASE_URL` no puede estar presente en
el proceso de la aplicación. Eso no es política: no arranca.

---

## Generar un secreto

```sh
openssl rand -base64 48 | tr -d '\n/+=' | head -c 48; echo
```

Sin `/`, `+` ni `=`: la contraseña viaja dentro de una URL de conexión, y esos tres caracteres
obligan a escaparla. Un secreto que hay que escapar es un secreto que alguien escapará mal.

---

## Rotar `COSTEO_APP_PASSWORD` — sin corte

Es el único que se puede rotar sin parar el servicio, porque PostgreSQL acepta la contraseña nueva de
inmediato y las conexiones ya abiertas siguen valiendo.

```sh
NUEVA=$(openssl rand -base64 48 | tr -d '\n/+=' | head -c 48)

# 1. Cambiarla en la base
docker compose exec -T db psql -U postgres -d costeo \
  -c "ALTER ROLE costeo_app PASSWORD '$NUEVA';"

# 2. Cambiarla en el archivo de entorno del VPS
sudo sed -i "s|^COSTEO_APP_PASSWORD=.*|COSTEO_APP_PASSWORD=$NUEVA|" /etc/costeo/.env
sudo sed -i "s|postgresql://costeo_app:[^@]*@|postgresql://costeo_app:$NUEVA@|g" /etc/costeo/.env

# 3. Reiniciar solo la API
docker compose -f docker-compose.prod.yml up -d --force-recreate api

# 4. Comprobar que arrancó y responde
curl -fsS https://<dominio>/ready
```

Si el paso 4 falla, la contraseña del archivo y la de la base no coinciden. Repite el paso 2 —
`DATABASE_URL` y `PGBOUNCER_DATABASE_URL` llevan la contraseña **dentro de la cadena**, y es fácil
cambiar una y olvidar la otra.

---

## Rotar `COSTEO_MIGRATOR_PASSWORD`

No hay conexiones vivas salvo durante un despliegue, así que se rota en cualquier momento.

```sh
NUEVA=$(openssl rand -base64 48 | tr -d '\n/+=' | head -c 48)
docker compose exec -T db psql -U postgres -d costeo \
  -c "ALTER ROLE costeo_migrator PASSWORD '$NUEVA';"
sudo sed -i "s|^COSTEO_MIGRATOR_PASSWORD=.*|COSTEO_MIGRATOR_PASSWORD=$NUEVA|" /etc/costeo/.env
sudo sed -i "s|postgresql://costeo_migrator:[^@]*@|postgresql://costeo_migrator:$NUEVA@|g" /etc/costeo/.env
```

Comprobación: el siguiente `npm run migrate:deploy` tiene que funcionar. **No esperes al despliegue
para descubrir que no.**

---

## Rotar `POSTGRES_SUPERUSER_PASSWORD`

```sh
NUEVA=$(openssl rand -base64 48 | tr -d '\n/+=' | head -c 48)
docker compose exec -T db psql -U postgres -d postgres \
  -c "ALTER ROLE postgres PASSWORD '$NUEVA';"
sudo sed -i "s|^POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=$NUEVA|" /etc/costeo/.env
```

**Y comprueba el respaldo en el acto**, porque es el único que lo usa:

```sh
npm run respaldo
```

Si no lo compruebas ahora, lo descubres el día que necesites restaurar.

---

## Cuándo rotar

| Situación | Qué se rota | Cuándo |
|---|---|---|
| Rutina | Los tres de la base | Cada 6 meses |
| **Alguien dejó el equipo o el proyecto** | Los tres, **y se revocan las sesiones** | El mismo día |
| **Un secreto se pegó en un chat, un ticket o una captura** | Ese, de inmediato | En minutos, no en horas |
| Un `.env` llegó a un commit | Ese, **y se reescribe el historial** | De inmediato. `audit:secrets` debería haberlo parado; si no lo hizo, abre una incidencia |

Revocar todas las sesiones activas tras una rotación por incidente:

```sh
docker compose exec -T db psql -U postgres -d costeo \
  -c "UPDATE user_session SET revoked_at = now() WHERE revoked_at IS NULL;"
```

---

## Lo que NO se hace nunca

- **Poner un secreto en `docker-compose.yml`, en el `Dockerfile` o en una variable de GitHub Actions
  que no sea un secreto del repositorio.** `audit:secrets` corre sobre cada diff y sobre el historial.
- **Reutilizar la misma contraseña para `costeo_app` y `costeo_migrator`.** Son roles con privilegios
  distintos justamente para que comprometer uno no dé el otro.
- **Dejar `COSTEO_IMPORT_PASSWORD` en el archivo de entorno.** Se exporta en la sesión que carga el
  catálogo y se va al cerrarla.
