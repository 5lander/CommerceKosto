# Runbook — respaldos y restauración

> Comandos exactos, sin prosa.
>
> **El respaldo es NUESTRO.** PostgreSQL corre en nuestro VPS (ADR-016), y los respaldos que da
> Hostinger son **semanales y del VPS entero, sin PITR**. El libro de inventario es append-only (R3)
> y **no se reconstruye desde ningún otro sitio**: ni desde el Excel del cliente, ni volviendo a
> importar. Seis días de movimientos perdidos son seis días perdidos para siempre.

---

## Qué hace `npm run respaldo`, y por qué no es un `pg_dump` en un cron

Un `pg_dump | gzip > archivo` en un cron escribe un archivo todos los días, **no lo lee nunca**, y el
día que hace falta se descubre que llevaba ocho meses truncándose porque el disco estaba lleno. Es
INC-007 —un check que pasa en verde sin medir nada— aplicado a lo que menos perdona.

Aquí la verificación **es** el trabajo:

| # | Paso | Si falla |
|---|---|---|
| 1 | `pg_dump --format=custom --compress=9` como **superusuario** | No se guarda nada |
| 2 | `pg_restore --list` sobre lo volcado | No se guarda nada |
| 3 | Se restaura **de verdad** sobre una base desechable | No se guarda nada |
| 4 | Se cuentan las **tablas testigo** en el original y en la copia, y se comparan | **No se guarda nada** |
| 5 | Se tira la base desechable y se escribe el archivo | — |
| 6 | Se podan los respaldos por encima de la retención | — |

**Si el paso 4 no cuadra, el archivo no se guarda.** Guardarlo solo serviría para creer que se tiene.

**Se vuelca como superusuario y no como `costeo_migrator`**, a propósito: RLS con `FORCE` aplica
también al dueño de la tabla. Hoy las políticas del migrator dicen `USING (true)` y no filtrarían
nada, pero eso es una coincidencia afortunada y no una garantía — un respaldo silenciosamente
incompleto es la peor clase de respaldo que existe.

Las **tablas testigo** son cinco y no las 56: contar todas lo vuelve lento y nadie lo correría a
diario. Cubren las cuatro formas de perder algo irrecuperable.

```
inventory_movement   el libro. Append-only: no se reconstruye
audit_log            quién hizo qué. Append-only
item                 el catálogo
recipe_line          las recetas
product_sales        las ventas del mes
```

---

## Uso diario

```sh
npm run respaldo
```

Variables opcionales:

```sh
RESPALDO_DIRECTORIO=.respaldos      # dónde se guardan
RESPALDO_RETENCION_DIAS=14          # cuántos días se conservan
```

Salida real de la primera ejecución, contra la base de desarrollo con volumen de las pruebas de
rendimiento:

```
[respaldo] volcando
[respaldo] 121405 KiB volcados
[respaldo] leyendo el volcado sin restaurarlo
[respaldo] 623 entradas en el indice
[respaldo] restaurando sobre costeo_verificacion_respaldo y comparando
[respaldo]   inventory_movement: 4812678 filas, cuadra
[respaldo]   audit_log: 6040 filas, cuadra
[respaldo]   item: 43264 filas, cuadra
[respaldo]   recipe_line: 28475 filas, cuadra
[respaldo]   product_sales: 2060 filas, cuadra
[respaldo] guardado en .respaldos/costeo-2026-09-08T09-11-51-650Z.dump
[respaldo] listo — volcado, restaurado y comparado
```

**4,8 millones de filas del libro, restauradas y contadas.** Eso es una restauración probada, no una
configurada.

---

## Restaurar

```sh
npm run restaurar -- .respaldos/costeo-2026-09-08T09-38-37-355Z.dump
```

**El destino es SIEMPRE `costeo_restaurado`, y nunca puede ser producción.** No
es una guarda que se pueda saltar con una bandera: es que el nombre es una
constante del script.

Una versión anterior aceptaba `--base=<nombre>`. Un nombre de base es un
**identificador**, y un identificador no se puede pasar como parámetro en SQL:
aceptarlo del usuario obligaba a interpolarlo, que es inyección, y
`no-sql-interpolado` lo paró con razón. Escaparlo a mano habría sido fingir que
se arregló. La respuesta del proyecto a un identificador dinámico es **no
tenerlo**. Si hace falta otro nombre, se renombra después:

```sh
docker compose exec -T db psql -U postgres -d postgres \n  -c "ALTER DATABASE costeo_restaurado RENAME TO costeo_20260908;"
```

**No restaura «encima» de una base con tablas.** `pg_restore --exit-on-error` falla en el primer
objeto duplicado, y es deliberado: mezclar un respaldo con datos vivos produce una base que no es ni
lo uno ni lo otro. Para rehacer una base, tírala y créala de nuevo.

---

## Los tres modos de fallo, y cuáles están probados

| Modo | Probado | Cómo se comporta |
|---|---|---|
| **El archivo está truncado o corrupto** | ✅ **Empíricamente** | `pg_restore --list` falla **antes de crear ninguna base**: `El volcado no se puede leer: pg_restore: error: could not read from input file: end of file` |
| **Se restaura sobre producción por error** | ✅ **Imposible por construcción** | El destino es una constante del script. No hay bandera que lo cambie |
| **Los recuentos no cuadran** | Comparación directa de cadenas, no probada con un fallo inducido | Lanza con la lista de tablas descuadradas y **no guarda el archivo** |

El tercero es una comparación `original !== restaurado` sobre el resultado de `count(*)`. No se
indujo un descuadre real porque el libro es append-only y no se le pueden borrar filas ni siendo
dueño — que es R3 haciendo su trabajo. **Queda anotado como lo que es**: los dos caminos difíciles
están probados contra la base real, el tercero es aritmética de dos líneas.

---

## En el VPS: sacar el archivo de la máquina

**Un respaldo en el disco que puede morir no es un respaldo, es una copia.** Eso lo hace
`scripts/vps/respaldo-diario.sh`, que va en cron:

```
0 3 * * * cd /opt/costeo && bash scripts/vps/respaldo-diario.sh >> /var/log/costeo-respaldo.log 2>&1
```

Corre `npm run respaldo` —con su restauración y su comparación— y **después** sube el archivo y los
segmentos de WAL usando `RESPALDO_COMANDO_SUBIDA`, que recibe la ruta como único argumento.

**Si esa variable está vacía, el script sale con error a propósito.** No avisa por el registro y
sigue: falla. Un respaldo que se queda en la máquina es el modo de fallo silencioso que INC-007
describe, y aquí cuesta el libro de un cliente.

El **archivado de WAL** ya está puesto en `docker-compose.prod.yml`:

```
archive_mode=on
archive_command=test ! -f /wal/%f && cp %p /wal/%f
```

El `test ! -f` no es decorativo: PostgreSQL reintenta el mismo segmento si el comando falla, y sin esa
comprobación una copia a medias se sobrescribiría con otra a medias.

> ⚠️ **El volumen de WAL hay que podarlo.** Si crece sin límite llena el disco, y cuando el disco se
> llena **PostgreSQL deja de aceptar escrituras**. Lo hace el mismo script, borrando lo anterior al
> último volcado completo.

**Lo que falta para cerrar del todo:** elegir el destino de `RESPALDO_COMANDO_SUBIDA`. Hasta que esté,
la ventana de pérdida real es **un día** y el respaldo vive en la misma máquina.

---

## Cuándo se restaura de verdad

**Una vez al mes, sin que se haya roto nada.** Un respaldo que solo se restaura el día de la
catástrofe se restaura por primera vez el peor día posible.

```sh
npm run restaurar -- $(ls -t .respaldos/*.dump | head -1)
docker exec costeo-db psql -U postgres -d postgres -c "DROP DATABASE costeo_restaurado;"
```

El propio comando imprime los recuentos de las cinco tablas testigo, así que no
hay que consultarlos aparte.

Anota la fecha del último ensayo aquí:

| Fecha | Quién | Resultado |
|---|---|---|
| 2026-09-08 | Construcción de la cadena | ✅ 4.812.678 filas del libro restauradas y contadas |
| 2026-09-08 | Tras refactorizar (sin SQL interpolado) | ✅ 481.268 filas, respaldo y restauración por separado |
