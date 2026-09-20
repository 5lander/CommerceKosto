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

**Y un cuarto que estuvo roto hasta P16-G (INC-028):** cuando el volcado pasaba de 512 MiB,
`spawnSync` mataba a `pg_dump` y devolvía **un fallo con el `stderr` vacío** — ningún mensaje, ningún
respaldo, justo el día en que la base ya es grande. Ahora el volcado va del proceso al archivo por un
descriptor, sin pasar por la memoria de Node, y no hay tope que ajustar. Probado sobre una base de
**10 GB** (757 MiB de volcado).

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

### Señal: cuándo dejar de verificar cada noche

`npm run respaldo` **restaura lo que acaba de volcar** y compara los recuentos. Eso es lo que lo
convierte en un respaldo y no en una copia, y cuesta tiempo: crece con la base, no con el cambio del
día.

> **Umbral: 20 minutos.** Cuando la verificación nocturna pase de ahí en el VPS —se mide en
> `/var/log/costeo-respaldo.log`, que lleva la marca de tiempo de cada paso—, la verificación pasa a
> **semanal**, o a **otra máquina** que restaure la copia remota. El volcado diario sigue siendo
> diario en los dos casos: lo que se espacia es la comprobación, nunca el respaldo.

Por qué 20 y no otro número: es el punto donde la ventana nocturna deja de ser holgada. Por encima,
el respaldo empieza a solaparse con la actividad de la mañana en un negocio que abre temprano, y un
`pg_dump` compitiendo con el servicio es una forma tonta de que el cliente note el respaldo. Por
debajo, espaciarlo solo quita cobertura a cambio de nada.

---

## Restaurar UN solo cliente (D-16.195)

**El caso probable no es la pérdida total: es que un cliente pierda lo suyo.** Alguien borró un
catálogo, una importación se comió los precios, un empleado archivó lo que no era. Restaurar la base
entera para arreglarle el día a uno devolvería a **todos los demás** al estado de ayer — un incidente
mayor que el que se está arreglando.

```sh
# 1. la copia completa de ayer, en la base auxiliar (esto ya existía)
npm run restaurar -- .respaldos/costeo-2026-09-17T09-12-03-004Z.dump

# 2. solo las filas de ese cliente, de la auxiliar a producción
npm run restaurar:tenant -- --company=01a0af83-7403-75b9-96af-c63c3585e0a3

# 3. la auxiliar se tira, como siempre
docker exec costeo-db psql -U postgres -d postgres -c "DROP DATABASE costeo_restaurado;"
```

### Qué hace, y por qué es seguro

**No hay ni un `WHERE company_id` escrito a mano.** Las dos conexiones —la de la copia y la de
producción— entran con el **rol de la aplicación** y con `app.company_id` fijado, así que:

- `pg_dump --enable-row-security` ve **solo** las filas de ese tenant: el recorte lo hace la misma
  RLS que impide la fuga en producción (Barrera 1);
- al insertarlas, **la política vuelve a comprobar cada fila**: si algo no fuera de esa company, la
  base lo rechazaría.

Un filtro escrito a mano sería una segunda definición de «qué es de quién», y la única que vale es la
de la base.

### Lo que NO vuelve, a propósito

| | Por qué |
|---|---|
| `session` | Son **credenciales vivas**. Devolver las sesiones de anteayer es devolverles validez a tokens que ya circularon |
| `email_outbox` | Correos que ya salieron, o que ya no deben salir. Reponer la cola reenvía invitaciones viejas |
| `audit_log`, `backoffice_access_log` | Append-only, y **la aplicación ni siquiera puede leerlos** (SEGURIDAD.md §10): no aparecen en el volcado. Restaurar un log sería escribir historia |

### Lo que exige antes de tocar nada

1. **La company tiene que existir** en el destino. Se restauran sus datos, no su alta: el cascarón lo
   crea `npm run seed:tenant`.
2. **El destino tiene que estar vacío para ese tenant.** No escribe encima: mezclar lo restaurado con
   lo que quedó deja una base que no es ni lo uno ni lo otro. Si hay filas, las lista y se para.
3. **La lista de tablas tiene que estar completa.** El script pregunta al catálogo qué tablas tienen
   `company_id` y política de lectura para la aplicación, y **se para** si encuentra alguna que
   `scripts/lib/tenant.mjs` no conoce. Una restauración a la que le falta una tabla no se nota hasta
   que el cliente busca lo que falta.

Al terminar compara los recuentos tabla por tabla entre la copia y producción, y falla si no cuadran.

### El libro y los meses cerrados (D-16.198)

**Un cliente con más de un mes de uso tiene meses cerrados, y reponerlos choca con dos guardianes.**
Ninguno se apaga. Los dos se resuelven con el ORDEN, dentro de la misma transacción:

| Guardián | Por qué estorba | Cómo se le pasa por delante |
|---|---|---|
| `inventory_movement_respeta_periodo_cerrado` | El libro que vuelve es de meses ya cerrados | Los períodos entran, se **reabren**, entra el libro y se **vuelven a cerrar**. El trigger comprueba siempre y deja pasar porque el mes está abierto de verdad. Al final se verifica que el número de meses cerrados coincide con el de la copia |
| `physical_count_line_solo_en_borrador` | Un mes cerrado tiene su conteo CONFIRMADO, y sus líneas no se pueden escribir | Las **líneas van antes que su conteo**: el guardián se ejecuta, no encuentra conteo todavía y deja pasar. Que cada línea acabe teniendo el suyo lo comprueba la clave foránea al COMMIT, diferida solo para esta transacción (`p16g2_fk_diferible_del_conteo`) |

**El contra, dicho donde se paga:** durante esa ventana el guardián de la línea pasa *en vacío*.
Fuera de la restauración nada cambia — la clave es `INITIALLY IMMEDIATE` y la aplicación no difiere
nunca, así que una línea huérfana escrita por la API sigue fallando en el acto.

### El límite que hay que conocer

**Un tenant con libro de inventario no se puede «vaciar» para rehacerlo.** El libro es append-only
(R3) y sus `DELETE` los rechaza un trigger, también al dueño de la tabla. Eso significa:

- si lo que se perdió fueron **los datos** (el cliente borró su catálogo, el libro sigue ahí), este
  procedimiento **no aplica al libro**: hay que restaurar lo que falte a mano o valorar la
  restauración completa;
- si lo que se perdió fue **la company entera**, se recrea el cascarón con `seed:tenant` y esto la
  repuebla de cero, libro incluido.

### Ensayo (obligatorio antes de la entrega al piloto)

| Fecha | Sobre quién | Resultado |
|---|---|---|
| 2026-09-17 | `ensayo-b` **sin libro** (company sintética, D-16.193) | ✅ **18 filas en 11 tablas**, recuentos cuadrados uno a uno; `ensayo` intacto (7 ítems, 4 productos, 15 líneas); la interfaz de ensayo-b vuelve a costear («Arroz marinero» 9.90, receta 0.3 kg AP, costo 3.60). Los ajustes de costeo los reportó como hay que reponerlos |
| 2026-09-20 | `ensayo-b` **con libro y agosto CERRADO** (D-16.198) | ✅ **24 filas en 22 tablas** tras borrar el tenant entero: 3 movimientos, el conteo confirmado con su línea, el período de agosto **otra vez CERRADO** y el saldo en 15 kg, idénticos a la copia; `ensayo` intacto. Encontró tres cosas por el camino: INC-030, la falta de privilegio `TEMP` de `costeo_app` y el `search_path` vacío de `pg_dump` |

**El simulacro de 2026-09-20 es el que hace que este procedimiento esté PROBADO para un cliente
real**, porque un cliente real tiene meses cerrados. El de 2026-09-17 probaba un tenant sin libro,
que es el caso fácil.

> **Cómo se repite.** Se siembra el tenant sintético por el flujo normal (compras, conteo,
> `POST /conteos/:id/cierre-de-periodo`), se hace el respaldo, se restaura a la auxiliar, se **borra
> el tenant** de la base de trabajo como superusuario —`SET LOCAL session_replication_role =
> replica` dentro de una transacción; **eso es el desastre, no el procedimiento**— y se lanza
> `restaurar:tenant`, que corre con **todo puesto**: RLS, los append-only y el trigger del mes
> cerrado.

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
