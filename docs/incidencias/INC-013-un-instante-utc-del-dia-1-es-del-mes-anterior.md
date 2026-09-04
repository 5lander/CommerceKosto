# INC-013 — Un movimiento del día 1 aparece en el mes anterior, o lo rechaza un período que nadie cerró

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-04 |
| **Paquete** | P7 |
| **Área** | base de datos · pruebas |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | 0 |

> **No es un fallo del código: es el fallo que P7 existe para prevenir, encontrado desde dentro.** Apareció escribiendo una prueba del propio paquete, que es la mejor señal de que va a volver a aparecer cargando datos reales.

## Síntoma

Una compra fechada el día 1 de un mes se rechaza con un error que no tiene sentido:

```
409  El periodo 2026-08 de esa ubicacion esta cerrado y no admite movimientos.
```

…cuando lo que se estaba registrando era del **1 de septiembre**, y septiembre no está cerrado.

La otra cara del mismo síntoma, y la peligrosa porque no da error: **`compras_del_mes` de un mes cuadra corta**, y el importe que falta aparece sumado al mes anterior. Nadie lo nota hasta que el food cost real de dos meses seguidos sale raro en direcciones opuestas.

## Contexto

`apps/api/test/integracion/periodos-y-conteo.spec.ts`, escribiendo la prueba de que corregir un movimiento de un mes cerrado se rechaza. La fecha usada era:

```ts
const compra = await comprar({ itemId, occurredAt: '2026-09-01T00:00:00.000Z' });
```

## Causa raíz

**`occurred_at` es `timestamptz`: un instante absoluto, no una fecha.** El mes al que pertenece depende de la zona horaria, y la del proyecto es `America/Guayaquil`, UTC−5 (D11).

```
2026-09-01T00:00:00Z   =   2026-08-31 19:00 en Guayaquil   ->   AGOSTO
```

Las cinco primeras horas de cada día 1 en UTC pertenecen al mes anterior en Ecuador. Y en una zona al este de UTC pasaría lo simétrico con las últimas horas del último día del mes.

Esto **no es un defecto del modelo**: es la razón de que P7 guarde la frontera del mes como dos instantes (`period.starts_at` / `ends_at`) resueltos una sola vez, en vez de calcular `date_trunc('month', occurred_at AT TIME ZONE ...)` en cada consulta. El modelo estaba haciendo lo correcto; quien escribía el dato de prueba pensaba en fechas y el sistema piensa en instantes.

## Solución

Las fechas de prueba y de carga llevan hora **`12:00Z`**:

```ts
const EN_MARZO = '2026-03-15T12:00:00.000Z';
```

Mediodía UTC cae en el mismo día natural en todo el continente americano (UTC−3 a UTC−10) y en Europa occidental. Es un dato que significa lo mismo se lea desde donde se lea.

## Prevención

**Automatizada, y cubre el cálculo:** `apps/api/src/modules/periods/domain/periodos.spec.ts` recorre los doce meses de 2026 en tres zonas —`America/Guayaquil` (sin horario de verano), `Europe/Madrid` (hemisferio norte) y `America/Santiago` (hemisferio sur)— y exige que cada frontera vuelva a caer en su propio mes y que el instante siguiente caiga en el otro. Un desfase mal medido rompe eso por **una hora**, que es exactamente el tamaño del error que se busca.

Además hay una prueba explícita del caso:

> «un instante UTC de abril que en Guayaquil todavía es marzo pertenece a marzo»

**Convención, no check, para el dato:** la hora `12:00Z` en las fechas de prueba **no se puede automatizar sin falsos positivos**. Hay fechas `T00:00:00Z` perfectamente legítimas en el repositorio —vigencias de precios, límites de sesión— y una regla que las marcara todas se desactivaría en una semana. Decirlo es más honesto que escribir un check ruidoso que nadie respetará.

Lo que sí queda escrito, y es lo que hay que mirar antes de dudar de una cifra mensual: **si un importe aparece en el mes de al lado, mira la hora del `occurred_at` antes que el código.**

## Cómo detectarla en producción

```sql
-- Movimientos en las cinco primeras horas UTC de un dia 1: los sospechosos
SELECT id, occurred_at, occurred_at AT TIME ZONE 'America/Guayaquil' AS local
  FROM inventory_movement
 WHERE EXTRACT(DAY FROM occurred_at) = 1
   AND EXTRACT(HOUR FROM occurred_at) < 5;
```

Si la columna `local` cae en el mes anterior, ese movimiento está contabilizado donde el negocio dice que tiene que estar — y quien lo cargó probablemente creía otra cosa.
