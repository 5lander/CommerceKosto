# P9 — Resultado de la auditoría

| | |
|---|---|
| **Fecha** | 2026-09-06 |
| **Paquete** | P9 — Consolidado de company y comparativa entre ubicaciones |
| **Resultado** | ✅ `npm run audit` en verde, salida 0 |

```
A. Arquitectura      ✅ A1-A10
B. Clean code        ✅ B1-B12
C. Seguridad         ✅ C1-C30 · permiso de nivel company con 3 pruebas de 403
D. Base de datos     ✅ D1-D9 · migración sin cambio de esquema, reversible
E. Reglas de negocio ✅ R1 verificada sobre la única agregación cross-ubicación
F. Frontend          — no aplica: P9 no toca frontend
G. Pruebas           ✅ 727 en verde (457 unitarias + 270 integración) + 5 saltadas con motivo
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10 · presupuesto de §5 medido en topología de producción
```

---

## Los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | **Paró dos cosas reales**: ver abajo |
| `audit:forbidden` | ✅ | 30 reglas sobre **261 archivos** (253 en P8) |
| `audit:arch` | ✅ | 226 módulos, 1005 dependencias |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | Obligó a un objeto de parámetros y a simplificar una prueba |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11 · 10 migraciones |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | Sin vulnerabilidades altas fuera de las 4 aceptadas |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 457 unitarias con la base apagada + 270 de integración |

---

## Lo que los checks pararon, y es lo que hace que valga la pena escribirlos

### `audit:forbidden` — el catálogo se lee por sus puertos, no por sus tablas

La primera versión de `comprasPorArticulo` resolvía en el repositorio de `inventory` los nombres del ítem y del artículo, con dos lecturas directas:

```
audit:forbidden  FALLO — 2 infraccion(es)

  [tablas-de-catalogo-solo-en-catalog]
     prisma-inventario.repositorio.ts:558  tx.item.findMany({
     prisma-inventario.repositorio.ts:562  tx.purchaseArticle.findMany({
```

**Tenía razón, y el arreglo mejoró el diseño.** El repositorio devuelve ahora solo ids; los nombres los pone `analytics` con `ListarItems` y `ListarArticulos`, que son los puertos del catálogo. Es CLAUDE.md §2 —fuente única de verdad— aplicándose donde era cómodo saltárselo.

### `audit:lint` y `audit:complexity` — dos aristas

| Qué | Arreglo |
|---|---|
| `unaUbicacion` con 4 parámetros (máximo 3) | Objeto de parámetros |
| Una prueba con complejidad 12 por encadenar tres `?.` en cada aserción | Un ayudante `t()` de una línea: la prueba quedó además más legible |
| Dos `as` que ESLint pedía convertir en `!` | Se quitaron **los dos**, con una guarda explícita: ni aserción ni `!` |

---

## Criterio de aceptación de P9

| Criterio | Estado | Cómo se verifica |
|---|---|---|
| El consolidado es exactamente la suma de las ubicaciones | ✅ | Prueba de integración que **compara contra las propias vistas por ubicación**, no contra números escritos a mano |
| Ninguna agregación cruza companies (R1) | ✅ | Prueba que consulta las ubicaciones de otras companies y exige que ninguna aparezca, por id y por nombre |
| El consolidado de 10 ubicaciones cumple 800 ms p95 | ✅ | **734 ms** medido en topología de producción — ver abajo |

---

## Rendimiento — medido donde la medición vale

En Windows el proxy de Docker falsea el tiempo (INC-016), así que el número se tomó con la aplicación y la base en la misma red de contenedores:

| | mediana | p95 | máximo |
|---|---|---|---|
| Una ubicación (`/analitica/resumen`) | 69 ms | — | — |
| **Diez ubicaciones (`/consolidado`)** | 616 ms | **734 ms** | 848 ms |

**Cumple al 92 % del presupuesto**, y escala lineal (8,9×). Está anotado en `ESTADO.md`: **alrededor de doce ubicaciones se rompe**, y ahí es donde entra la vista materializada que ADR-012 §7 deja diseñada y sin construir.

Lo que la corrida local publica —números del proxy, no del sistema— queda como referencia de que la medición se ejecuta siempre:

```
costeo de la carta          p95 =  391.6 ms de 400
inventario de la ubicacion  p95 =   48.7 ms de 300
conteo                      p95 =  357.8 ms de 300
conteo (guarda de periodo)  p95 =   38.9 ms de 300
consolidado                 p95 = 1234.4 ms de 800
```

---

## Lo que este paquete NO cerró

- **Las vistas materializadas.** Decisión documentada con el número que las dispararía (ADR-012 §7), no un olvido.
- **`npm run bench`**, la deuda que P8 dejó con fecha de pago en P9. **No se pagó**, y hay que decirlo: el presupuesto de P9 se midió a mano, con la API en contenedor y `curl`. El procedimiento está escrito en `docs/pasos/P9/CONSTRUCCION.md` y en INC-016, pero sigue sin automatizarse. La deuda se mantiene abierta en `ESTADO.md`.
