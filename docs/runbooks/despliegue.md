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
npm run db:up                 # levanta PostgreSQL 18.6 (crea los roles) y PgBouncer
npm run migrate:deploy        # aplica las migraciones como costeo_migrator
npm run audit                 # los doce checks
```

Si algo falla, antes de investigar: `npm run doctor`.

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
```

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

Rellena las tres contraseñas, `DOMINIO`, `CORREO_TLS` y `RESPALDO_COMANDO_SUBIDA`. **Las contraseñas
van también dentro de `DATABASE_URL` y `MIGRATION_DATABASE_URL`** — es el olvido más frecuente.

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

Hace seis pasos en este orden, y **el orden no es negociable**: código, imagen, base, espera a que
esté sana, **migraciones en su propio paso con su propia credencial**, y por último API y proxy.

> Si la aplicación arrancara antes de migrar, atendería tráfico contra un esquema viejo. Si migrara
> ella misma, tendría en su entorno la credencial del dueño de las tablas y la Barrera 1 sería
> decorativa. El esquema de entorno lo hace cumplir: la API **no arranca** si encuentra
> `MIGRATION_DATABASE_URL`.

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

---

## Pendiente

- **Estrategia de despliegue sin corte.** Hoy `desplegar.sh` recrea el contenedor de la API: hay unos
  segundos de 502. Con un cliente es aceptable; con varios, no
- **`npm run bench`** — re-fechado a P15
- **Sin failover** (ADR-016). Se revisa con el segundo cliente de pago
