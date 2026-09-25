# Runbook — despliegue

> Comandos exactos, sin prosa.
>
> **Producción: un VPS en Hostinger con `docker compose` — PostgreSQL, PgBouncer, la API y Caddy en
> la misma máquina.** El porqué y lo que se pierde están en **ADR-016**. No hay failover: si la
> máquina cae, el sistema está caído hasta que se levante otra y se restaure.

---

## Entorno local

### Requisitos

- Node **24.x** (`.nvmrc` fija 24.20.0) · npm ≥ 11
- Docker con Compose v2
- Git ≥ 2.9 (por `core.hooksPath`)

### Primer arranque en una máquina limpia

```sh
git clone <repo> && cd CommerceKosto
cp .env.example .env          # y edita las tres contraseñas
npm ci                        # instala, activa los hooks y genera el cliente de Prisma
npm run db:up                 # levanta PostgreSQL 18.6 (crea los CUATRO roles) y PgBouncer
npm run migrate:deploy        # aplica las migraciones como costeo_migrator
npm run audit                 # los doce checks
```

Si algo falla, antes de investigar: `npm run doctor`.

> **Si el volumen `costeo-pgdata` ya existía** antes de P11 o de P16-A1, `roles.sql` no vuelve a
> correr y faltan `costeo_backoffice` y/o `costeo_despachador`: `npm run rol:backoffice` y
> `npm run rol:despachador` (idempotentes) **antes** de `migrate:deploy`, o la migración de P16-A1
> falla en alto con `Falta el rol costeo_despachador`.

### Comandos de trabajo diario

```sh
npm run dev                   # API en caliente, contra la base del contenedor
npm run test:unit             # dominio, con la base APAGADA
npm run test:integration      # aislamiento, roles, cabeceras
npm run audit                 # los doce checks
npm run migrate:new -- <slug> # nueva migración, con su down.sql
npm run migrate:down          # revierte la última
npm run migrate:verify        # la escalera completa de reversibilidad (ADR-004)
npm run respaldo              # vuelca, RESTAURA y compara recuentos
npm run correo:despachar      # el despachador de correo en el host (MAIL_ADAPTER=consola: cada correo, con su enlace, sale por stdout)
npm run rol:despachador       # crea costeo_despachador en un cluster que ya existía (idempotente)
```

Con `MAIL_ADAPTER=consola` (el valor de `.env.example`) una invitación se prueba **sin buzón**:
`POST /usuarios` la encola y la siguiente pasada del despachador imprime el enlace
`APP_URL/activacion?token=…` en la terminal. Con `fake`, el despachador en el host la marca
`ENVIADO` sin enseñar nada, y en compose (`NODE_ENV=production`) **no arranca**.

---

## Producción — primer despliegue

### 1. El VPS

Hostinger KVM 1 (1 vCPU, 4 GiB, 50 GB) o KVM 2. **Región: Sudamérica**, la más cercana a Ecuador.
Sistema: Debian 12.

```sh
scp scripts/vps/preparar.sh root@<ip>:/root/
ssh root@<ip> bash /root/preparar.sh
```

Instala Docker, cierra el cortafuegos (**solo 22, 80 y 443**) y deja la plantilla de secretos en
`/etc/costeo/.env` con permisos `600`.

> **Por qué el cortafuegos no basta, y hay que saberlo.** `ufw` **no ve** el tráfico que Docker
> publica: Docker escribe sus propias reglas en la cadena `DOCKER` de iptables, por delante de las de
> ufw. Un `- '5432:5432'` en el compose abre el puerto a internet aunque `ufw status` diga que está
> cerrado. Por eso los puertos van atados a `127.0.0.1` **en el compose**, que es lo que de verdad
> protege la base.

### 2. Los secretos

```sh
ssh root@<ip>
for _ in 1 2 3; do openssl rand -base64 48 | tr -d '\n/+=' | head -c 48; echo; done
nano /etc/costeo/.env
```

Rellena las **cinco** contraseñas de base (`POSTGRES_SUPERUSER_PASSWORD`, `COSTEO_MIGRATOR_PASSWORD`,
`COSTEO_APP_PASSWORD`, `COSTEO_BACKOFFICE_PASSWORD`, `COSTEO_DESPACHADOR_PASSWORD`), `DOMINIO`,
`CORREO_TLS`, `RESPALDO_COMANDO_SUBIDA`, y desde P16-A1 **`APP_URL`** (`https://<dominio>`, sin barra
final: de ahí salen los enlaces de los correos), **`RESEND_API_KEY`** y **`RESEND_REMITENTE`**
(`MAIL_ADAPTER=resend` ya viene puesto; sin las dos claves el servicio `correo` no arranca). **Las
contraseñas van también dentro de sus cadenas** —`DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`BACKOFFICE_DATABASE_URL`, `DESPACHADOR_DATABASE_URL`— y es el olvido más frecuente.

`PROXY_DE_CONFIANZA` ya viene puesta en la plantilla (`172.28.0.10`) y **no se toca**: es la IP
**fija** de Caddy en la red de compose (`docker-compose.prod.yml`, `ipv4_address` dentro de la
subred fija `172.28.0.0/24`), desde la que Caddy llega a la API. Con ella la API cree el último
salto de `X-Forwarded-For` y el bloqueo por IP del login, el límite de tasa y el limitador global
cuentan **por cliente**; sin ella, contarían a todos como la IP de Caddy (INC-022). Una entrada que
no sea una dirección hace que la API **no arranque**. **No pongas la subred entera**: incluiría la
pasarela `172.28.0.1` —lo que la API ve cuando algo del propio VPS entra por `127.0.0.1:3000`— y
los demás contenedores, y cualquiera de ellos podría entonces poner la cabecera que quisiera.

> **Si algún día cambia la subred o la IP de Caddy** —en `docker-compose.prod.yml` y en
> `PROXY_DE_CONFIANZA` a la vez—, hay que hacer **`docker compose down` y después `up`** con los
> dos archivos: la configuración IPAM de una red que ya existe no se modifica en caliente y un
> `restart` (o un `up -d` sobre la red viva) **no la toca**. El síntoma de olvidarlo es silencioso:
> el socket de Caddy deja de casar con la lista y todo vuelve a contar como una sola IP. Comprobación:
> `docker inspect costeo-caddy --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`
> debe imprimir exactamente lo que dice `PROXY_DE_CONFIANZA`.

Comprueba que quedó cerrado:

```sh
ls -l /etc/costeo/.env      # -rw------- root root
```

### 3. El DNS, antes de levantar nada

Apunta el dominio (registro `A`) a la IP del VPS y **espera a que propague**:

```sh
dig +short <dominio>
```

Let's Encrypt valida por HTTP en el puerto 80. Si el DNS no ha propagado, el certificado falla y
Caddy reintenta con espera creciente — y si se reintenta demasiado, Let's Encrypt limita.

### 4. Desplegar

```sh
ssh root@<ip>
git clone <repo> /opt/costeo && cd /opt/costeo
bash scripts/vps/desplegar.sh
```

Hace ocho pasos en este orden, y **el orden no es negociable**: código, **las dos imágenes**, base,
espera a que esté sana, **dependencias y los roles que el cluster no crea solo** (`npm run
rol:backoffice` y `npm run rol:despachador`), **migraciones en su propio paso con su propia
credencial**, luego API, despachador de correo, interfaz y proxy, y por último la comprobación.

> **Por qué los roles van en un paso propio, antes de migrar.** `roles.sql` corre **una sola vez**,
> cuando el volumen de datos está vacío. Un rol que un paquete estrena después —`costeo_backoffice`
> en P11, `costeo_despachador` en P16-A1— no existe en un VPS desplegado antes, y la migración que lo
> necesita **falla en alto** (`Falta el rol costeo_despachador…`). Los dos scripts son idempotentes:
> si el rol ya existe no tocan su contraseña y solo conceden `CONNECT`. Necesitan
> `POSTGRES_SUPERUSER_PASSWORD`, `POSTGRES_DB` y las dos `COSTEO_*_PASSWORD` de `/etc/costeo/.env`
> (que `preparar.sh` deja en la plantilla), y `psql`, que en el VPS va por `docker compose exec db`.

> Si la aplicación arrancara antes de migrar, atendería tráfico contra un esquema viejo. Si migrara
> ella misma, tendría en su entorno la credencial del dueño de las tablas y la Barrera 1 sería
> decorativa. El esquema de entorno lo hace cumplir: la API **no arranca** si encuentra
> `MIGRATION_DATABASE_URL`.

#### ⚠️ Nunca despliegues con `up -d --build`

El script construye con **`docker compose build` como paso propio** y `set -e` aborta si falla. No es
manía:

> **`docker compose up -d --build` no aborta cuando el build falla.** Deja el contenedor anterior
> corriendo, su comprobación de salud sigue en verde y `docker compose ps` dice `healthy`. El
> despliegue parece haber funcionado y sirve el código de la última vez que el build salió bien.

Pasó de verdad: la imagen de la API llevaba **dos días sin poder construirse** —el `Dockerfile` no
copiaba `apps/api/parser/`, que P10 añadió— y nada lo dijo. Está en **INC-018**, y ahora lo caza
también `audit:forbidden` con la regla `dockerfile-no-copia-lo-que-el-codigo-importa`.

#### Qué comprueba el paso 8, y por qué esos tres recursos

Además de `/ready`, el script pide a la interfaz `/entrar`, `/marca/logotipo.svg` y
`/fuentes/inter-400-latin.woff2`, y a través del proxy `/api/health`.

`output: standalone` de Next **no incluye `public/` ni `.next/static`**: los copia el `Dockerfile` en
dos líneas aparte. Si se pierden, el servidor arranca, la página responde 200 y **lo que falta son
los recursos**. El síntoma es parcial y por eso cruel: sin la hoja de estilos la aplicación se ve,
solo que con otra letra, y eso no se nota hasta que alguien mira de cerca.

#### Un solo origen: la interfaz en `/`, la API en `/api`

Caddy sirve la interfaz en la raíz y manda a la API todo lo que empiece por `/api/`, **quitando el
prefijo** (`handle_path`). Consecuencias que conviene tener presentes:

- **`CORS_ORIGENES` se queda vacío**, que es su valor más restrictivo. No hay petición cruzada.
- La cookie de sesión sigue siendo `SameSite=Strict`, que solo se sostiene sin origen cruzado.
- El prefijo hace falta de verdad: **la interfaz tiene una página en `/costeo` y la API un endpoint
  en `/costeo`**. Sin separarlos, una de las dos desaparece.
- `NEXT_PUBLIC_API_URL` es `/api`, una ruta **relativa**, y se hornea en el paquete del navegador en
  tiempo de build. Ponerla en el `environment:` del compose no hace nada. Al ser relativa, **la misma
  imagen sirve para cualquier dominio**.

#### El servicio `correo`: qué es, cómo se mira, cómo se sabe que está sano

Desde P16-A1 la pila tiene un **tercer proceso**: `costeo-correo`, la misma imagen que `api` con
`command: node apps/api/dist/despachador.js`, `restart: unless-stopped`, sin puertos, con su propio
rol de base (`costeo_despachador`, `DESPACHADOR_DATABASE_URL`: puerto directo, nunca PgBouncer) y
un `healthcheck` sobre la edad de un archivo de latido que el proceso toca tras cada pasada
completa. **La API encola y no envía nada**: si `correo` no está en pie, las invitaciones y los
restablecimientos se quedan `PENDIENTE` y ningún endpoint del cliente lo dice (ADR-025).

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file /etc/costeo/.env ps correo
#   costeo-correo   ...   Up ... (healthy)     ← sano: latido de menos de 60 s

docker compose ... logs --tail 50 correo
#   despachador de correo: adaptador resend, una pasada cada 5000 ms, lote de 20, latido en /tmp/costeo-correo.latido
#   [correo] tomados 1 · enviados 1 · fallidos 0 · cedidos 0 · golpes purgados 0
#   (solo escribe una línea cuando hubo trabajo; una pasada fallida sale por stderr como «[correo] pasada fallida: …»)
```

El estado de la cola, **sin mirar `datos`** (lleva el token en claro mientras el correo está en
vuelo; con el superusuario se puede leer, y por eso no se hace):

```sh
docker compose ... exec -T db psql -U postgres -d costeo -c \
  "SELECT estado, count(*), min(created_at) AS mas_antiguo, max(sent_at) AS ultimo_envio
     FROM email_outbox GROUP BY estado ORDER BY estado;"

docker compose ... exec -T db psql -U postgres -d costeo -c \
  "SELECT id, destinatario, plantilla, intentos, error, siguiente_intento_en, created_at
     FROM email_outbox WHERE estado <> 'ENVIADO' ORDER BY created_at DESC LIMIT 20;"
```

Lo mismo lo enseña el back office: `GET /correo/salud` → `{pendientesAntiguos, fallidos,
ultimoEnvio}` y la tarjeta «Cola de correo» al principio de la vista *Cartera*, en aviso si hay
`PENDIENTE` con más de `CORREO_MINUTOS_DE_ALERTA` (15) minutos o algún `FALLIDO`.

Cómo se lee lo que se ve:

| Lo que se ve | Qué significa | Qué hacer |
|---|---|---|
| `PENDIENTE` con `intentos = 0` y más de un minuto | El despachador no está pasando | `ps correo`; si no está `healthy`, `logs correo`. Suele ser `DESPACHADOR_DATABASE_URL` mal, el rol sin crear (paso 5/8) o `RESEND_*` vacías con `MAIL_ADAPTER=resend` |
| `PENDIENTE` con `intentos > 0` y `error` | El proveedor rechazó o no respondió; se reintenta a `siguiente_intento_en` (1 → 2 → 4 → 8 min) | Leer `error`: `Resend respondio 401` es la clave; `403` suele ser el remitente sin dominio verificado; `Resend no respondio en 10000 ms` es red |
| `FALLIDO` | Cinco intentos sin éxito; `datos` ya está saneado y **no se reintenta solo** | Arreglar la causa y **reenviar** desde la aplicación (`POST /usuarios/:id/reenvio-de-invitacion`) o pedir otro enlace de restablecimiento. La fila queda como evidencia |
| `unhealthy` con la base sana | Una pasada no termina: rol sin privilegios, cadena con otro usuario | `logs correo`; `npm run rol:despachador`; comprobar que la cadena lleva `costeo_despachador` |

**Un redespliegue no duplica correos.** Cada fila tomada queda reservada cinco minutos y la reserva
se renueva antes de cada envío; el contenedor viejo termina su pasada al recibir `SIGTERM`
(`docker stop` da diez segundos) antes de cerrar el pool.

### 5. El respaldo diario, el mismo día

```sh
crontab -e
```

```
0 3 * * * cd /opt/costeo && bash scripts/vps/respaldo-diario.sh >> /var/log/costeo-respaldo.log 2>&1
```

Y **compruébalo a mano una vez**, sin esperar a las 3:00:

```sh
cd /opt/costeo && bash scripts/vps/respaldo-diario.sh
```

Si `RESPALDO_COMANDO_SUBIDA` está vacío, **sale con error a propósito**: un respaldo que se queda en
la máquina que puede morir no es un respaldo. Ver `respaldos-y-restauracion.md`.

---

## Crear el tenant del cliente

**El archivo con los datos del cliente NO entra al repositorio.** Se escribe fuera del clon y se
borra después: lleva contraseñas en claro.

```json
{
  "company": "<nombre comercial>",
  "ubicaciones": [
    { "nombre": "<nombre del local>", "tipo": "LOCAL" },
    { "nombre": "<nombre de la bodega>", "tipo": "BODEGA" }
  ],
  "usuarios": [
    { "correo": "<correo>", "rol": "OWNER", "contrasena": "<12+ caracteres>" },
    { "correo": "<correo>", "rol": "GERENTE_LOCAL", "ubicacion": "<nombre del local>", "contrasena": "<12+>" },
    { "correo": "<correo>", "rol": "BODEGA", "ubicacion": "<nombre de la bodega>", "contrasena": "<12+>" }
  ]
}
```

`OWNER`, `ADMIN` y `LECTURA` mandan en toda la company y **no llevan** `ubicacion`. `GERENTE_LOCAL` y
`BODEGA` **la necesitan**. El script rechaza el archivo si se confunden.

```sh
npm run build                                     # el seed usa el Argon2Hasher compilado
npm run seed:tenant -- --archivo=/root/tenant.json
shred -u /root/tenant.json
```

Imprime el id de la company y el de cada ubicación: son los que pide `npm run importar`.

---

## Cargar el catálogo del cliente en producción

El importador **se niega a correr con `NODE_ENV=production`**. Es deliberado: un `--company` copiado
del sitio equivocado escribe cientos de filas en la base de otro.

```sh
cd /opt/costeo
set -a && . /etc/costeo/.env && set +a
export COSTEO_IMPORT_PASSWORD='<la contraseña del usuario que carga>'
```

> **`COSTEO_IMPORT_PASSWORD` no se guarda en `/etc/costeo/.env`.** Vive en la sesión que carga el
> catálogo y se va al cerrarla (`rotacion-secretos.md`).

**Primero SIN escribir**, para leer el informe:

```sh
npm run importar -- items.csv --tipo=ITEMS \
  --company=<uuid> --ubicacion=<uuid> --usuario=<correo>
```

**Y solo cuando el informe salga limpio**, con las dos banderas:

```sh
npm run importar -- items.csv --tipo=ITEMS \
  --company=<uuid> --ubicacion=<uuid> --usuario=<correo> \
  --operacion-supervisada --confirmar
```

`--operacion-supervisada` no basta por sí sola. Antes de tocar nada imprime contra qué base va —
**léelo**:

```
*** OPERACION SUPERVISADA CONTRA PRODUCCION ***
Base:    postgresql://127.0.0.1:5432/costeo
Company: 0198...
Usuario: admin@cliente.ec
```

**Orden de las pasadas.** Cada una necesita lo que puso la anterior:

```
ITEMS  ->  ARTICULOS  ->  PRECIOS  ->  PRODUCTOS  ->  RECETAS  ->  MOVIMIENTOS
```

**La columna `iva` (P16-A1).** `ARTICULOS`, `PRECIOS` y `MOVIMIENTOS` admiten `iva` (alias `tarifa iva`,
`iva compra`, `tarifa de iva`) como fracción —`0.15`, nunca `15`—; sin tarifa en ningún nivel la fila se
rechaza en el análisis. En `MOVIMIENTOS` el importe de una `COMPRA` es **el total de la factura con IVA**.
El detalle por archivo está en `puesta-en-marcha.md`, Paso 7.

**Los precios nacen sugeridos.** Añade `--confirmar-precios` en la pasada de `PRECIOS`; sin eso el
costeo no devuelve número. Es un acto explícito porque R5 lo exige, y queda en `audit_log`.

**Si una pasada falla, no escribió nada** — es todo o nada dentro de la pasada. Lo que sí puede pasar
es que fallen las pasadas 3 en adelante con las dos primeras dentro: el comando dice cuáles se
aplicaron.

**Haz un respaldo antes de la primera carga y otro después.** Es gratis y es la única forma de volver
atrás si el archivo estaba mal.

---

## Despliegues siguientes

```sh
ssh root@<ip> 'cd /opt/costeo && bash scripts/vps/desplegar.sh'
```

---

## Revertir

### La aplicación, sin tocar la base

```sh
cd /opt/costeo
git checkout <commit anterior>
bash scripts/vps/desplegar.sh
```

**Solo vale si el commit anterior es compatible con el esquema actual.** Si el despliegue traía una
migración, hay que revertirla también, y en este orden: primero la aplicación, después la migración.

### Una migración

```sh
npm run migrate:down          # revierte la última aplicada
```

El `down.sql` borra su propia fila de `_prisma_migrations`, así que es atómico y no hace falta
`migrate resolve`.

> **NO se revierte restaurando un respaldo.** El libro de inventario es append-only y un respaldo
> destruiría los movimientos posteriores (ADR-004). Restaurar es para una pérdida de datos, no para
> deshacer un despliegue.

### La máquina entera

Es el caso sin failover (ADR-016). Con el runbook delante es una hora larga:

```sh
# 1. VPS nuevo
scp scripts/vps/preparar.sh root@<ip-nueva>:/root/ && ssh root@<ip-nueva> bash /root/preparar.sh
# 2. Los secretos, del gestor de contraseñas
# 3. El código
ssh root@<ip-nueva> 'git clone <repo> /opt/costeo'
# 4. La base y las migraciones, SIN la API
ssh root@<ip-nueva> 'cd /opt/costeo && docker compose --env-file /etc/costeo/.env -f docker-compose.yml -f docker-compose.prod.yml up -d db'
# 5. Restaurar el último respaldo (ver respaldos-y-restauracion.md)
# 6. El resto
ssh root@<ip-nueva> 'cd /opt/costeo && bash scripts/vps/desplegar.sh'
# 7. Apuntar el DNS a la IP nueva
```

---

## Solución de problemas conocidos

| Síntoma | Ficha |
|---|---|
| `bad interpreter: /bin/sh^M` | [INC-001](../incidencias/INC-001-hook-pre-commit-bad-interpreter.md) |
| `psql: command not found` | [INC-002](../incidencias/INC-002-psql-no-esta-en-el-path.md) |
| `Cannot find module '@swc/core-linux-x64-gnu'` en el contenedor | [INC-003](../incidencias/INC-003-binarios-win32-dentro-del-contenedor.md) |
| `migrate diff` da un `down.sql` vacío | [INC-004](../incidencias/INC-004-migrate-diff-genera-down-vacio.md) |
| El contenedor de PostgreSQL queda `unhealthy` al arrancar | [INC-005](../incidencias/INC-005-postgres-18-cambia-el-directorio-de-datos.md) |
| Un script de Node recibe el SQL partido | [INC-006](../incidencias/INC-006-spawn-en-windows-parte-los-argumentos.md) |
| `connect ETIMEDOUT` contra la base con el contenedor sano | [INC-015](../incidencias/INC-015-el-puerto-5432-del-host-llega-a-pgbouncer.md) |
| El certificado no se emite | El DNS no ha propagado. `dig +short <dominio>` y espera |
| Un usuario bloqueado por IP en el login bloquea a **todos**, o el límite de tasa salta para todo el mundo a la vez | [INC-022](../incidencias/INC-022-detras-del-proxy-toda-peticion-llega-con-la-ip-de-caddy.md): `PROXY_DE_CONFIANZA` vacía o que no casa con la subred de la red de compose; comprobar `docker network inspect costeo-saas_default` |
| `Falta el rol costeo_despachador` (o `costeo_backoffice`) al migrar | El cluster ya existía cuando el paquete estrenó el rol. `desplegar.sh` los crea en el paso 5/8; a mano: `npm run rol:backoffice && npm run rol:despachador` con el `.env` de producción exportado (`set -a; . /etc/costeo/.env; set +a`) |
| Las invitaciones no llegan y `email_outbox` acumula `PENDIENTE` | El servicio `correo` no está sano, o `RESEND_*` vacías con `MAIL_ADAPTER=resend`. Ver «El servicio `correo`» arriba y `docker compose logs correo` |
| El servicio `correo` no arranca: `MAIL_ADAPTER … en produccion no puede ser fake` | Deliberado (ADR-025): `fake` marcaría `ENVIADO` lo que nadie recibió. `resend` con sus dos claves, o `consola` mientras no haya cuenta |
| La invitación llega a spam | El dominio del remitente no tiene DKIM/SPF/DMARC verificados en Resend. `puesta-en-marcha.md`, Paso 3b |

---

## Pendiente

- **Estrategia de despliegue sin corte.** Hoy `desplegar.sh` recrea el contenedor de la API: hay unos
  segundos de 502. Con un cliente es aceptable; con varios, no
- **`npm run bench`** — re-fechado a P15
- **Sin failover** (ADR-016). Se revisa con el segundo cliente de pago
