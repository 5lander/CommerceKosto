# P9 — Consolidado de company y comparativa entre ubicaciones

| | |
|---|---|
| **Fecha** | 2026-09-06 |
| **Objetivo** | Ver la cadena completa y comparar locales |
| **ADR** | [ADR-012](../../decisiones/ADR-012-el-consolidado-y-lo-que-no-se-suma.md) |
| **Migración** | `20260906233354_p9_consolidado` — **sin cambio de esquema**: solo un permiso |

---

## Lo que se construyó

| # | Entregable | Dónde |
|---|---|---|
| 1 | Agregación de ventas, costos e inventario de todas las ubicaciones | `analytics/domain/consolidado.ts` |
| 2 | Comparativa del mismo producto entre ubicaciones (PVP, food cost, margen, unidades) | `analytics/domain/comparativas.ts` |
| 3 | Comparativa de precios de compra por ubicación **y por artículo** | idem |
| 4 | Tres casos de uso con el permiso de company exigido en su primera línea | `application/casos-de-uso/consolidado.ts` |
| 5 | `GET /consolidado`, `/consolidado/productos`, `/consolidado/compras` | `infrastructure/http/analitica.controller.ts` |
| 6 | La lectura del libro que la comparativa de compras necesita | `inventory` — puerto, caso de uso y repositorio |
| 7 | Permiso `analytics.consolidated.read` | migración P9 |
| 8 | **15 pruebas unitarias** con la base apagada + **13 de integración** + la de rendimiento | |

**No se construyeron las vistas materializadas**, y el porqué está medido: ver ADR-012 §7.

---

## Lo que este paquete NO añadió a la base, y lo que eso dice

`20260906233354_p9_consolidado` **no crea ni una tabla ni un índice.** Su `migration.sql` inserta un permiso y sus tres concesiones de rol, y ya.

Eso no es una casualidad: **es la comprobación de que P8 dejó el terreno hecho.** El consolidado no es un cálculo nuevo, es la suma de lo que cada ubicación ya publica. Si hubiera hecho falta una tabla, habría sido señal de que se estaba calculando por segunda vez y por otro camino — que es exactamente lo que ADR-012 §6 rechaza.

---

## La decisión que justifica el paquete

**Un porcentaje no se promedia.**

```
  local pequeño   venta   200,00   consumo   160,00   →  food cost 80 %
  local grande    venta 100.000,00 consumo 30.000,00  →  food cost 30 %

  media simple    (0,80 + 0,30) / 2            = 55,0 %   ← plausible y FALSO
  ponderado       30.160 / 100.200             = 30,1 %   ← el que decide precios
```

Veinticinco puntos de diferencia, y **ninguna pantalla los delataría**. La prueba unitaria lleva los dos números y compara el resultado contra la media simple explícitamente: si alguien sustituye la fórmula, cae con el porqué escrito.

---

## Prueba manual

Con la base levantada y las migraciones aplicadas:

```bash
npm run db:up
npm run migrate:deploy
```

**1. El consolidado de un mes.** Con la cookie de un `OWNER` o `ADMIN`:

```bash
curl -s "http://127.0.0.1:3000/consolidado?anio=2026&mes=3" -H "Cookie: $COOKIE"
```

Devuelve `ubicaciones[]` con el aporte de cada una y su `estadoDelPeriodo`, `sinDatos[]` con las que no tienen nada de ese mes, los contadores `cerradas` / `abiertas`, `totales` y los cuatro porcentajes recalculados.

**2. Que suma de verdad.** Pide la misma cifra por ubicación y súmalas a mano:

```bash
curl -s "http://127.0.0.1:3000/analitica/punto-de-equilibrio?locationId=$UNA&anio=2026&mes=3" -H "Cookie: $COOKIE"
curl -s "http://127.0.0.1:3000/analitica/punto-de-equilibrio?locationId=$OTRA&anio=2026&mes=3" -H "Cookie: $COOKIE"
```

La suma de sus `ventaNeta` tiene que dar el `totales.ventaNeta` del consolidado, al último decimal.

**3. La escalada horizontal.** Con la cookie de un `GERENTE_LOCAL`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/consolidado?anio=2026&mes=3" -H "Cookie: $GERENTE"
# 403
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/analitica/resumen?locationId=$SUYA&anio=2026&mes=3" -H "Cookie: $GERENTE"
# 200 — la restricción no le quita lo suyo
```

**4. La comparativa de compras enseña la factura, no el precio de referencia.**

```bash
curl -s "http://127.0.0.1:3000/consolidado/compras?anio=2026&mes=3" -H "Cookie: $COOKIE"
```

Cada fila trae los `pagos` por ubicación y artículo con su `precioUnitario`, más `precioMinimo`, `precioMaximo` y `brechaPct` — lo que el local caro se ahorraría comprando como el barato.

---

## Rendimiento

Medido en la **topología de producción** —aplicación y base en la misma red de contenedores—, porque en Windows el proxy de Docker falsea el tiempo (INC-016):

```
  una ubicación  (/analitica/resumen)   mediana  69 ms
  diez           (/consolidado)         mediana 616 ms · p95 734 · max 848
```

**Cumple los 800 ms de §5, al 92 %.** Escala lineal (8,9×), así que **alrededor de doce ubicaciones se rompe**. Está anotado en `ESTADO.md` como deuda con disparador medido, y en ADR-012 §7 con la forma que tendría la solución.
