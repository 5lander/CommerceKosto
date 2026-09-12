# Runbook — puesta en marcha, de cero a un cliente entrando

> **Qué es esto.** La secuencia exacta desde que no hay nada hasta que un dueño
> de restaurante escribe su contraseña y ve el costo de sus platos. Ocho pasos,
> con lo que hay que tener a mano en cada uno y **cómo se comprueba que salió
> bien**.
>
> **Qué NO es.** No sustituye a `despliegue.md`, que explica *por qué* cada cosa
> es como es. Esto es la lista para el día.

---

## Antes de empezar: lo que tiene que estar decidido

| # | Qué | Quién lo tiene | Sin esto |
|---|---|---|---|
| 1 | **El dominio** y acceso a su DNS | tú | No hay certificado: Let's Encrypt valida por HTTP contra el dominio |
| 2 | La cuenta del **VPS** (Hostinger, ADR-016) | tú | No hay dónde |
| 3 | Un **gestor de contraseñas** para las tres de base de datos | tú | Se pierden y no se pueden recuperar: no están en ningún sitio más |
| 4 | **Dónde van los respaldos** (`RESPALDO_COMANDO_SUBIDA`) | tú | El respaldo diario **sale con error a propósito** |
| 5 | El archivo del **tenant** | el cliente | No hay con qué entrar. Plantilla: `docs/plantillas/tenant.ejemplo.json` |
| 6 | El **catálogo** del cliente en CSV | el cliente | Se entra a un sistema vacío |
| 7 | Una **cuenta de Resend** con el **dominio del remitente verificado** (DKIM, SPF y DMARC en su panel), su clave de API y el remitente (`Platise <no-responder@<dominio>>`) | tú | Las invitaciones y los restablecimientos **no salen**: la API solo encola y el servicio `correo` no arranca con `resend` sin sus dos claves (ADR-025) |

**Los siete son de negocio, no de código.** El código está escrito y probado.

---

## Paso 0 — El ensayo en local, y no se salta

**Antes de tocar el servidor, la secuencia entera se ejecuta aquí.** No es
prudencia: la primera vez que esto se corrió de punta a punta destapó **tres
fallos** que llevaban días puestos con la auditoría en verde (INC-018, INC-019,
INC-020). Ninguno lo habría encontrado leer el código.

```sh
# La pila de produccion, en local, con un dominio de mentira
DOMINIO=localhost CORREO_TLS=tu@correo.ec \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Y después, los pasos 5, 6 y 7 de abajo con **datos sintéticos**. Nunca con datos
del cliente: `CLAUDE.md` §7 lo prohíbe y aquí no hace falta.

**Comprobación:** las tres respuestas tienen que ser `200`.

```sh
curl -sk -o /dev/null -w '%{http_code} ' https://localhost/entrar
curl -sk -o /dev/null -w '%{http_code} ' https://localhost/api/health
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost/marca/logotipo.svg
```

---

## Paso 1 — El DNS, primero de todo

Es lo que más tarda y **lo único que no se puede acelerar**. Un registro `A` del
dominio a la IP del VPS.

**Comprobación:**

```sh
dig +short <dominio>      # tiene que devolver la IP del VPS
```

> Si Caddy arranca antes de que el DNS haya propagado, Let's Encrypt falla la
> validación y reintenta con espera creciente. No rompe nada, pero el sitio no
> carga y parece otra cosa.

---

## Paso 2 — El VPS

```sh
ssh root@<ip>
git clone <repo> /opt/costeo && cd /opt/costeo
bash scripts/vps/preparar.sh
```

Deja `/etc/costeo/.env` a medio llenar. **Comprobación:** el archivo existe y
tiene las claves vacías que hay que rellenar.

---

## Paso 3 — Los secretos

Rellenar en `/etc/costeo/.env`: las **cinco** contraseñas de base de datos (superusuario,
`costeo_migrator`, `costeo_app`, `costeo_backoffice`, `costeo_despachador`) **y sus cuatro
cadenas**, `DOMINIO`, `CORREO_TLS`, `RESPALDO_COMANDO_SUBIDA`, y las del correo:
`APP_URL=https://<dominio>` (sin barra final), `RESEND_API_KEY` y `RESEND_REMITENTE`.
`MAIL_ADAPTER=resend` y `PROXY_DE_CONFIANZA=172.28.0.10` ya vienen puestos y no se tocan.

**Las contraseñas se generan largas y se guardan en el gestor ANTES de pegarlas
aquí.** No están en ningún otro sitio; perderlas es perder el acceso. La clave de
Resend también va al gestor: Resend la enseña **una sola vez**.

**Comprobación:** ninguna clave del archivo queda con el valor de ejemplo ni
vacía.

```sh
grep -E '^[A-Z_]+=$' /etc/costeo/.env    # no debe devolver nada
```

### Paso 3b — El dominio del remitente, en Resend

Antes de desplegar, porque el servicio `correo` arranca con `resend` y el primer
correo que salga con el dominio sin verificar cae en spam o se rechaza (`403`):

1. En Resend, *Domains → Add domain* con el dominio (o un subdominio: `correo.<dominio>`).
2. Copiar los registros que enseña —**DKIM** (`TXT` o `CNAME`), **SPF** (`TXT` en el
   subdominio de envío) y **DMARC** (`TXT` en `_dmarc.<dominio>`, al menos `v=DMARC1; p=none`)—
   al DNS del Paso 1, y esperar a que Resend los marque *Verified*.
3. Crear la clave de API con permiso de **envío solamente** y copiarla a
   `RESEND_API_KEY`; `RESEND_REMITENTE` con una dirección de ese dominio.

**Comprobación:** los tres registros en verde en el panel de Resend, y
`dig +short TXT _dmarc.<dominio>` devuelve lo que se pegó.

**Depende de ti**, no del código: sin cuenta y sin dominio verificado la evidencia
del Paso 6b no se puede producir, y la entrega al piloto la exige.

---

## Paso 4 — Desplegar

```sh
cd /opt/costeo && bash scripts/vps/desplegar.sh
```

Ocho pasos, y el script **aborta si alguno falla**. Lee `despliegue.md` §4 para
lo que hace cada uno, y sobre todo para por qué **nunca se despliega con
`up -d --build`**. El paso 5/8 crea los roles que el cluster no crea solo
(`costeo_backoffice`, `costeo_despachador`) antes de migrar.

**Comprobación**, y el script ya la hace: `/ready` de la API, tres recursos de la
interfaz, `/api/health` por el proxy y el servicio `correo` sano. Además, a ojo:

```sh
curl -sI https://<dominio>/entrar | head -1     # HTTP/2 200
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file /etc/costeo/.env ps correo   # (healthy)
docker inspect costeo-caddy --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'        # 172.28.0.10 = PROXY_DE_CONFIANZA
```

Y **abre el navegador**. Tiene que verse el logotipo de Platise sobre fondo
Cloud Dancer, no una página en blanco ni con la letra del sistema.

---

## Paso 5 — El respaldo, el mismo día

```sh
crontab -e
# 0 3 * * * cd /opt/costeo && bash scripts/vps/respaldo-diario.sh >> /var/log/costeo-respaldo.log 2>&1
```

Y **ejecútalo a mano una vez, sin esperar a las 3:00**.

**Comprobación, que no es que termine sin error:**

- El volcado **pesa lo que tiene que pesar**. Un respaldo de una base con datos
  no puede ocupar 1 KiB. Si los ocupa, está volcando la base equivocada —pasó, y
  está en **INC-019**.
- Las cinco tablas testigo **cuadran** entre el original y la restauración. El
  script las imprime una a una.
- El archivo **llegó a su destino fuera de la máquina**. Compruébalo en el
  destino, no en el log.

---

## Paso 6 — El tenant del cliente

Necesitas su archivo. Plantilla y explicación de cada campo:
`docs/plantillas/tenant.ejemplo.json`.

```sh
npm run seed:tenant -- --archivo=/ruta/tenant.json
```

Imprime el id de la company y el de cada ubicación. **Anótalos: son los que pide
la importación.**

**Comprobación:** entra por el navegador con uno de los usuarios del archivo. Si
la contraseña no funciona, el hash se generó mal y no hay que seguir.

> **Borra el archivo del tenant en cuanto termines.** Lleva contraseñas en claro.

---

## Paso 6b — El envío real, a mano, y la evidencia que hay que guardar

Es la **evidencia 2** de la parada «entrega al piloto» (`ESTADO.md`): una invitación real,
en una bandeja real, **fuera de spam**. No la produce ninguna prueba automatizada —ninguna
envía correo de verdad— y **depende de ti**: exige la cuenta de Resend del Paso 3b.

1. Con la sesión del dueño creada en el Paso 6, invita a **un buzón tuyo** que no sea del
   dominio del remitente (Gmail, Outlook: los que de verdad filtran):
   `POST /usuarios` desde la aplicación, o `curl` con la cookie de sesión.
2. En menos de un minuto (`CORREO_INTERVALO_MS` = 5 s más el reintento si lo hubo) el correo
   tiene que estar **en la bandeja de entrada, no en spam**, con el asunto «Te han invitado a
   costeo-saas» y un enlace `https://<dominio>/activacion?token=…`.
3. Abre las cabeceras del mensaje («Mostrar original» en Gmail) y comprueba
   `dkim=pass`, `spf=pass` y `dmarc=pass`.
4. Pulsa el enlace y activa la cuenta; después, «Olvidé mi contraseña» con ese mismo correo
   y comprueba que el segundo mensaje llega igual y que el enlace caduca en una hora.
5. En la base, la fila quedó `ENVIADO` con `datos` saneado:

```sh
docker compose ... exec -T db psql -U postgres -d costeo -c \
  "SELECT estado, intentos, sent_at, datos FROM email_outbox ORDER BY created_at DESC LIMIT 2;"
#   ENVIADO | 1 | <instante> | {"plantilla": "INVITACION", "destinatario": "…"}
```

**Guarda como evidencia**, en `docs/pasos/P16-A1/evidencia/` (o donde diga la parada):
una captura del correo en la bandeja de entrada con la carpeta visible, las tres líneas
`dkim/spf/dmarc=pass` de las cabeceras, y la salida del `SELECT` de arriba.
Hasta que exista, `CONSTRUCCION.md` de P16-A1 dice que el envío real **no se ha ejercitado**,
y es verdad.

**Si cae en spam:** el dominio no está verificado o DMARC no ha propagado (Paso 3b). No
insistas mandando más: 3/h al mismo correo es el límite y el cuarto es 429.

## Paso 7 — El catálogo

**El orden importa y no es arbitrario:**

```
ITEMS  →  ARTICULOS  →  PRECIOS  →  PRODUCTOS  →  RECETAS
```

- `PRECIOS` **exige** `ARTICULOS`: el precio de un ítem comprado necesita su
  presentación, porque un importe sin presentación no dice cuánto cuesta la
  unidad de uso.
- `RECETAS` exige `ITEMS` y `PRODUCTOS`.

**Siempre en dos pasadas: primero sin `--confirmar`.** La pasada de análisis **no
escribe nada** y reporta los problemas con su fila y su columna.

```sh
# 1. Analizar. No escribe.
COSTEO_IMPORT_PASSWORD='...' npm run importar -- catalogo/items.csv \
  --tipo=ITEMS --company=<id> --ubicacion=<id> --usuario=<correo>

# 2. Escribir, cuando el informe cuadre.
COSTEO_IMPORT_PASSWORD='...' npm run importar -- catalogo/items.csv \
  --tipo=ITEMS --company=<id> --ubicacion=<id> --usuario=<correo> \
  --confirmar --operacion-supervisada
```

`--operacion-supervisada` es lo que levanta la negativa a escribir contra
producción, e imprime contra qué base va a escribir antes de hacerlo.

**La columna `iva` de los archivos (P16-A1).** La tarifa de IVA de compra es una **fracción** —`0.15`,
nunca `15`— y **nunca se asume**: una fila sin tarifa en ningún nivel se rechaza en el análisis con su
número. Cabecera `iva` o cualquiera de sus alias: `tarifa iva`, `iva compra`, `tarifa de iva`
(`ARTICULOS` y `MOVIMIENTOS`); `iva`, `iva compra`, `% iva compra` (`PRECIOS`).

| Archivo | Qué pasa con la columna |
|---|---|
| `ARTICULOS` | La tarifa **del artículo**. Vacía = la del grupo del ítem; sin ninguna, la fila se rechaza. Es la que heredan después las compras y los precios de ese artículo |
| `PRECIOS` | Vacía = la del artículo o, sin artículo, la del grupo. **Una preparación (`PRODUCIDO`) va vacía o en `0`**: su precio es costo estándar ya neto, y otra tarifa se rechaza |
| `MOVIMIENTOS` | Solo en `COMPRA`, y el importe es **el total de la factura con IVA**: el sistema netea y guarda los cuatro importes. Vacía = la del grupo del ítem (el archivo nunca trae artículo); sin ninguna, la fila se rechaza |

**Los artículos que ya existían antes de P16-A1 llevan `0.15` de semilla, no de verdad.** Antes de la
primera compra con desglose, revisa los exentos (alimentos sin procesar) con
`PUT /catalogo/articulos/:id` o desde la pantalla del artículo. Y si el piloto quiere una base de
ejemplo **entera** con desglose, la forma es rehacerla desde cero —`npm run db:reset -- --si`,
`seed:tenant`, y las pasadas de arriba con la columna `iva` puesta—, no re-importar sobre lo que hay:
el libro es append-only y una segunda pasada de `MOVIMIENTOS` duplicaría las compras.

Para `PRECIOS`, `--confirmar-precios` los deja **vigentes** en vez de sugeridos.
R5 exige que lo decida una persona; esa bandera es esa persona diciéndolo, y
queda en el log de auditoría.

**Errores que vas a ver con un archivo real, y qué significan:**

| Mensaje | Qué hacer |
|---|---|
| `La unidad "l" no está en el catálogo. Las válidas son: doc, g, gal, kg, lb, lt, mg, ml, oz, unid.` | El litro es `lt`. Corrige el CSV |
| `El precio de un ítem comprado necesita su artículo` | Falta cargar `ARTICULOS` antes |
| `Estos ítems ya existen en tu company (…): …` · `Estos artículos de compra ya existen en tu company (…): …` | **Reimportar el mismo archivo no duplica nada: el lote entero se para y no escribe ni una fila** (P16-A2; antes de eso, el de artículos salía como un 500). Quita del CSV las filas que ya están. **El choque ignora mayúsculas y espacios de sobra**, que es más estricto que el índice único de la base: «AZUCAR YA 2KG» choca con «Azucar Ya 2kg» aunque la base las habría aceptado como dos filas distintas, y por eso el nombre del mensaje es el del archivo y puede no estar tal cual en el catálogo |
| Columnas no reconocidas en el informe | Renombra la cabecera del CSV, o dímelo y ajusto los alias: es media hora y no toca el camino de escritura |

---

## Paso 8 — La comprobación final, con los ojos

Entra como el dueño y mira **el costeo de un plato que él conozca de memoria**.

- Si el número le cuadra, el sistema está listo.
- Si no le cuadra, **no discutas el número: reconstrúyelo con él**. La pantalla
  enseña costo bruto, costo neto, costo total, venta neta, margen, food cost y
  multiplicador, en ese orden, para que se pueda seguir la cuenta.
- Las diferencias conocidas contra su Excel están explicadas de antemano en
  `sesion-con-el-cliente.md`, §D.2.

**Y comprueba el semáforo**: un food cost por debajo del 28 % tiene que salir en
verde Jade. Si sale naranja o rojo, algo va mal en la comparación — es el fallo
de **INC-020**, y ahora lo caza `audit:forbidden`.

---

## Si algo falla

| Síntoma | Dónde mirar |
|---|---|
| El despliegue dice `healthy` pero sirve código viejo | **INC-018.** Construye con `docker compose build` y mira su código de salida |
| El respaldo pesa nada | **INC-019.** Está volcando la base administrativa |
| Un umbral decide al revés | **INC-020** |
| La aplicación se ve con otra letra | El `Dockerfile` no copió `.next/static` o `public/` |
| `connect ETIMEDOUT` contra la base | **INC-015**, el puerto 5432 y el pooler |
| Certificado que no llega | El DNS no ha propagado. Paso 1 |
| La invitación no llega, o llega a spam | `despliegue.md`, «El servicio `correo`»: `ps correo`, `logs correo`, `email_outbox`. Spam es el Paso 3b |
| Un usuario bloqueado por IP bloquea a todos, o el 429 salta para todo el mundo | **INC-022**: `PROXY_DE_CONFIANZA` no casa con la IP de Caddy. `docker inspect costeo-caddy` |

Y para revertir, `despliegue.md` §Revertir: la aplicación sin tocar la base, una
migración, o la máquina entera.
