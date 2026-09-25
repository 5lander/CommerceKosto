# INC-019 — El respaldo volcaba la base equivocada, y la que volcaba estaba vacía

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-08 |
| **Paquete** | P14b (ensayo de despliegue) |
| **Área** | base de datos · despliegue |
| **Tiempo perdido** | ~15 min |
| **Recurrencias** | 0 |

> **Lo que se rompió es justo lo que ese script existe para garantizar.**
> `respaldo.mjs` no es un `pg_dump`: es un `pg_dump` que **restaura lo volcado y
> compara recuentos**, precisamente para que un respaldo vacío no pase por
> bueno. Y llevaba desde P15 respaldando una base vacía.

## Síntoma

```
$ npm run respaldo
[respaldo] volcando
[respaldo] 1 KiB volcados
[respaldo] leyendo el volcado sin restaurarlo
[respaldo] 16 entradas en el indice
[respaldo] restaurando sobre costeo_verificacion_respaldo y comparando
Error: Consulta fallida: psql:<stdin>:7: ERROR:
  relation "inventory_movement" does not exist
```

**1 KiB.** La base de desarrollo tiene 56 tablas y trece millones de movimientos.

## La causa

```js
const origen = conexionDeSuperusuario();   // ← apunta a la base `postgres`
const volcado = volcar({ conexion: origen });
```

`conexionDeSuperusuario()` devuelve la conexión administrativa, que apunta a
**`postgres`** —la base que existe siempre y que hace falta para crear y tirar
otras—, no a `costeo`. Volcarla respalda una base vacía.

**Es una regresión de P15**, y del cambio más inocente posible: `jscpd` señaló
que la construcción de esa cadena estaba copiada en tres scripts y se extrajo a
`scripts/lib/entorno.mjs`. Al extraerla, la base de destino se fijó a `postgres`
porque es lo que necesitaban los otros dos.

Y por eso solo se rompió uno de los tres:

| Script | Qué hace con la cadena | ¿Se rompió? |
|---|---|---|
| `bench.mjs` | `apuntandoA(superusuario, BASE_BENCH)` | No: reapunta siempre |
| `restaurar.mjs` | `apuntandoA(conexion, BASE_RESTAURADA)` | No: reapunta siempre |
| **`respaldo.mjs`** | **la usa tal cual** | **Sí** |

## El arreglo

```js
const origen = apuntandoA(conexionDeSuperusuario(), opcional('POSTGRES_DB', 'costeo'));
```

Después:

```
[respaldo] 343412 KiB volcados
[respaldo] 660 entradas en el indice
[respaldo]   inventory_movement: 13475504 filas, cuadra
[respaldo]   audit_log: 17496 filas, cuadra
[respaldo]   item: 122778 filas, cuadra
[respaldo]   recipe_line: 79785 filas, cuadra
[respaldo]   product_sales: 5776 filas, cuadra
```

## Lo que salvó la situación, y conviene saber cuál fue

**Las tablas testigo.** El script no comparó «cero contra cero» y se dio por
bueno: se murió porque `inventory_movement` **no existe** en la base
administrativa. Si la comparación se hubiera hecho sobre una base con las
tablas creadas y vacías, habría dicho «0 filas, cuadra» cinco veces y guardado
un respaldo inservible **con su verde puesto**.

Es INC-007 rozando el peor sitio posible. Que fallara ruidosamente fue suerte
del diseño —elegir tablas de negocio como testigo, no `SELECT 1`—, no una
comprobación pensada para esto.

## Prevención

No hay regla estática que cace esto: la cadena es correcta como cadena, solo
apunta a otro sitio. Lo que hay es procedimiento, y ahora está escrito:

1. **El ensayo completo en local antes de tocar el servidor**, con la cadena de
   respaldo ejecutada de verdad — `docs/runbooks/puesta-en-marcha.md`, paso 6.
   Es lo que encontró esto.
2. **La verificación posterior al primer respaldo en el VPS**: mirar el tamaño
   del volcado y el recuento de las cinco tablas testigo. Un respaldo de la base
   de un cliente **no puede pesar 1 KiB**.

## La lección

**Deduplicar dos usos parecidos puede romper el tercero en silencio.** Los tres
scripts pedían «la conexión de superusuario» y solo uno quería decir además «de
la base del producto». La firma extraída no tenía sitio donde expresar esa
diferencia, así que la perdió.

Cuando `jscpd` empuje a extraer algo, la pregunta no es si las tres copias son
iguales: es **si significan lo mismo**.
