# P16-D — Documento de construcción

**Paquete:** P16-D — API · el costeo marca «sin receta» · **Inicio:** 2026-09-14 · **Estado:** ✅ auditado (`npm run audit` exit 0) · commit de cierre del paquete

> Paquete de API fuera del plan original, **abierto por decisión del usuario**: la duda #12 de
> `ESTADO.md`, levantada al capturar el armazón, cerrada el 2026-09-14 con la opción (a). Se
> construye antes de la pantalla Inicio porque la pantalla de costeo que ya está en uso enseña hoy el
> número equivocado.

---

## Resumen

`GET /costeo` y `GET /costeo/:id` devuelven **`sinReceta: true`** cuando el producto no tiene ninguna
línea activa en esa ubicación (en un combo, ningún componente), y en ese caso el semáforo del food
cost es **`SIN_DATO`**, también con un PVP simulado. La pantalla de costeo lo pinta como estado en la
fila entera, en lugar de «0.00 · 0.00 · 0.00» y un food cost del 0 % en verde.

## Objetivo del paquete

Criterio de aceptación: la marca calculada en el dominio y probada con la base apagada; las cuatro
formas de «no hay receta» —sin receta, receta con todas las líneas excluidas, combo sin componentes y
simulador— probadas de punta a punta sobre la respuesta; **ningún número del motor cambia** (los casos
conocidos y R7 intactos); cada pieza con su guardián; `npm run audit` en verde.

---

## Plan (Fase PLAN, modo autónomo)

| Capa | Archivo | Qué |
|---|---|---|
| dominio | `costing/domain/costeo-de-producto.ts` | `sinRecetaActiva(lineas)`: ninguna línea `ACTIVA` |
| dominio · prueba | `costing/domain/costeo-de-producto.spec.ts` | Sin líneas, todas inactivas, una activa |
| aplicación | `costing/application/casos-de-uso/costear.ts` | `CosteoDelProducto.sinReceta`; `semaforoDe(venta, parámetros, sinReceta)` en el simple, el combo y el simulador |
| infraestructura | `costing/infrastructure/http/costeo.dto.ts` · `presentacion.ts` | `sinReceta` en `ProductoCosteadoDto` |
| integración | `test/integracion/costeo.spec.ts` | Cinco casos nuevos en «lo que el motor NO se calla» |
| web | `app/(app)/costeo/page.tsx` · `textos/es.ts` | La fila sin receta dice qué falta; `CeldasDeCosto` extraída |

**Sin migraciones, sin dependencias, sin endpoints nuevos.** Un campo nuevo en una respuesta existente
—aditivo— y un cambio de color en un caso que antes era un verde falso.

### Decisiones

| # | Decisión | Alternativas descartadas | Razón |
|---|---|---|---|
| D-16.146 | **«Sin receta» = ninguna línea `ACTIVA`**, no «no existe la fila de receta» | Solo la ausencia de receta | Una receta vacía o con todas las líneas excluidas cuesta exactamente lo mismo que ninguna —cero— y engaña igual. La marca describe lo que el costo no tiene, no lo que la base guarda |
| D-16.146 | **En un combo, «sin receta» = sin componentes** | Un campo aparte, `sinComponentes` | La pantalla pregunta una sola cosa —¿hay algo que costear?— y un combo sin componentes cuesta cero por la misma razón |
| D-16.146 | **El semáforo es `SIN_DATO`** también con PVP y con PVP simulado | Dejar el color que salga | Un 0 % en verde es la mejor noticia posible sobre un dato que no existe. `SIN_DATO` ya significaba «no se pudo medir» (P16-B) |
| D-16.146 | **Los importes siguen saliendo** (en cero), no `null` | Anular los costos | Cambiaría la forma de `CostosDto` para todas las pantallas y los consumidores del motor (analítica, consolidado). La marca basta para que quien pinta no los enseñe |
| D-16.147 | **La ingeniería de menú, el food cost real y el consolidado NO cambian en este paquete** | Tratar el plato sin receta como `SIN_DATOS` en la matriz | Es otra decisión de producto: un plato vendido sin receta entra hoy a la matriz con un margen igual a su venta neta. **Duda #13**, para el usuario |

### Dudas detectadas

**#13** — la ingeniería de menú clasifica un plato vendido sin receta con margen = venta neta (lo
colocaría como estrella o rompecabezas). En `ESTADO.md`.

---

## Qué se construyó

Lo del plan, sin desviaciones. La pantalla de costeo pinta «Sin receta en esta sucursal: el costo no se
puede calcular. Escribe su receta para verlo.» en las siete columnas numéricas.

## Pruebas

| Tipo | Archivo | Qué |
|---|---|---|
| unitaria (sin base) | `costing/domain/costeo-de-producto.spec.ts` | 3 casos de `sinRecetaActiva` |
| unitaria | `costing/infrastructure/http/presentacion.spec.ts` | El doble gana `sinReceta` |
| integración | `test/integracion/costeo.spec.ts` | Plato sin receta con PVP → `sinReceta` y `SIN_DATO`; receta con todas las líneas inactivas → `sinReceta`; una línea activa → no, y el semáforo juzga; simulador → `SIN_DATO`; combo sin componentes → `sinReceta` y `SIN_DATO` |

**En el navegador** (build de producción, tenant de ensayo): la dueña en la bodega —donde los dos
platos no tienen receta— ve la frase en las dos filas; el gerente en el local ve los mismos números de
antes (1,03 / 1,16 / 1,18 · 17,2 %; 1,27 / 1,47 / 1,50 · 26,5 %). `BODEGA` sigue sin acceso.

### Guardianes

Cada mutación, corrida contra sus pruebas y restaurada; `git diff --stat` idéntico antes y después.

```
=== G1-dominio-siempre-con-receta: src/modules/costing/domain/costeo-de-producto.ts
    mutacion: "return !lineas.some((linea) => linea.estado === 'ACTIVA');" -> 'return lineas.length < 0;'
    [unit] src/modules/costing/domain/costeo-de-producto.spec.ts -t None -> exit 1
      × sinRecetaActiva > sin líneas no hay receta 10ms
      × sinRecetaActiva > con todas las líneas inactivas tampoco: nada suma al lote 1ms
      Tests  2 failed | 1 passed (3)
      FAIL   unit  src/modules/costing/domain/costeo-de-producto.spec.ts > sinRecetaActiva > sin líneas no hay receta
      FAIL   unit  src/modules/costing/domain/costeo-de-producto.spec.ts > sinRecetaActiva > con todas las líneas inactivas tampoco: nada suma al lote
    [integration] test/integracion/costeo.spec.ts -t 'receta' -> exit 1
      × costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12) 209ms
      × costeo > lo que el motor NO se calla > una receta con todas sus líneas excluidas tampoco es receta 459ms
      × costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta 211ms
      Tests  3 failed | 3 passed | 16 skipped (22)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > una receta con todas sus líneas excluidas tampoco es receta
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta

=== G2-semaforo-ignora-la-receta: src/modules/costing/application/casos-de-uso/costear.ts
    mutacion: "if (sinReceta) return 'SIN_DATO';" -> ''
    [integration] test/integracion/costeo.spec.ts -t 'receta|simulador de PVP no|combo sin' -> exit 1
      × costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12) 232ms
      × costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta 202ms
      × costeo > lo que el motor NO se calla > un combo sin componentes sale marcado igual 139ms
      Tests  3 failed | 4 passed | 15 skipped (22)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > un combo sin componentes sale marcado igual

=== G3-simulador-olvida-la-receta: src/modules/costing/application/casos-de-uso/costear.ts
    mutacion: 'semaforoFoodCost: semaforoDe(venta, parametros, producto.sinReceta),' -> 'semaforoFoodCost: semaforoDe(venta, parametros, false),'
    [integration] test/integracion/costeo.spec.ts -t 'simulador de PVP no' -> exit 1
      × costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta 327ms
      Tests  1 failed | 21 skipped (22)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > el simulador de PVP no le pone color a un plato sin receta

=== G4-combo-sin-componentes-con-receta: src/modules/costing/application/casos-de-uso/costear.ts
    mutacion: 'const sinReceta = componentes.length === 0;' -> 'const sinReceta = componentes.length < 0;'
    [integration] test/integracion/costeo.spec.ts -t 'combo sin' -> exit 1
      × costeo > lo que el motor NO se calla > un combo sin componentes sale marcado igual 277ms
      Tests  1 failed | 21 skipped (22)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > un combo sin componentes sale marcado igual

=== G5-presentacion-constante: src/modules/costing/infrastructure/http/presentacion.ts
    mutacion: 'sinReceta: producto.sinReceta,' -> 'sinReceta: false,'
    [integration] test/integracion/costeo.spec.ts -t 'SIN receta' -> exit 1
      × costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12) 304ms
      Tests  1 failed | 21 skipped (22)
      FAIL   integration  test/integracion/costeo.spec.ts > costeo > lo que el motor NO se calla > un plato SIN receta en esta sucursal sale marcado, y su semáforo no es verde (duda #12)
```

## Problemas encontrados

| Problema | Solución | Tiempo |
|---|---|---|
| El capturador recibió `C:/Program Files/Git/costeo` como ruta | Git Bash convierte los argumentos que empiezan por `/`: `MSYS_NO_PATHCONV=1` | 3 min |

## Cómo probar

```sh
npm run test:unit --workspace @costeo/api -- src/modules/costing
npm run test:integration --workspace @costeo/api -- test/integracion/costeo.spec.ts
```

## Incidencias registradas

Ninguna: la duda #12 salió de mirar una captura, no de un fallo de construcción.

## Deuda y pendientes

- **Duda #13** (menú, food cost real y consolidado con platos sin receta).
