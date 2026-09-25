# P16-I — Resultado de la auditoría

**Alcance del diff:** `apps/api/src/modules/inventory/domain/agregados.ts` (nuevo) y su spec,
`apps/api/src/modules/analytics/domain/vistas.spec.ts`,
`apps/api/test/integracion/inventario.spec.ts`, `docs/pruebas/casos-conocidos.md`, `CLAUDE.md`,
`docs/pasos/P16-I/`, `ESTADO.md` y `CHANGELOG`. **Ni una línea de infraestructura, ni de `apps/web`,
ni una migración.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | La definición de los agregados **baja** de infraestructura al dominio, que es la dirección correcta de la regla de dependencia. `audit:arch` sin violaciones |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`, `audit:duplication` (`Found 0 clones`). El pliegue son cuatro funciones cortas; el signo del importe vive en una de tres líneas, con su porqué encima |
| C · Seguridad | ✅ | No hay superficie nueva: ni endpoint, ni permiso, ni consulta. La prueba de integración usa el repositorio real y el tenant de su suite |
| D · Base de datos | ✅ | **Sin migraciones.** Lo que se añade es una prueba que exige que el `SUM` de producción coincida con el pliegue |
| E · Reglas de negocio | ✅ | Los tres casos conocidos son SPEC §16 y §18 tal como están escritos; ninguna fórmula cambia. Lo que cambia es que ahora hay un número esperado |
| F · Rendimiento | ✅ | El pliegue es O(movimientos) en memoria y **no corre en producción**: la consulta sigue agregando en SQL (CLAUDE.md §5). Es la reconstrucción, como `proyectarSaldos` |
| G · Pruebas | ✅ | **7 unitarias** nuevas (CC-010), **4** en analítica (CC-011 y CC-012) y **1 de integración** que ata los dos caminos del dinero |
| H · Documentación | ✅ | Los tres casos en `casos-conocidos.md` con su dataset, su aritmética y **qué cubre el Excel y qué no**; la regla nueva en CLAUDE.md §3; `CONSTRUCCION.md`; duda abierta #16 en `ESTADO.md` |
| I · Duplicación / YAGNI | ✅ | No se construyó ninguna abstracción nueva: `foodCostReal` y `valorizarInventario` ya existían y solo reciben casos. Lo único nuevo es el pliegue que **no existía en ninguna capa** |

### Lo que este paquete cierra

**La asimetría que hizo posible INC-029.** El saldo tenía dos definiciones vigilándose entre sí; el
dinero tenía una sola, en SQL, sin número esperado en ninguna parte. Ahora tiene las mismas dos, con
la misma prueba que las ata, y tres casos conocidos escritos antes que el código.

### Lo que este paquete destapó, y no arregla

**Duda abierta #16.** El `CONSUMO_REAL` de SPEC §16 cuenta como consumo lo que salió por
transferencia o por producción, porque el Excel no tiene ni lo uno ni lo otro. En CC-011 son **28 de
los 32 dólares de varianza**. Es una decisión de modelo que toca el SPEC; queda anotada con sus tres
opciones y una prueba que fija el comportamiento actual.

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 580 archivos
✔ no dependency violations found
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
      Tests  918 passed (918)                  (unitarias)
      Tests  555 passed | 5 skipped (560)      (integracion)
```

**`npm run audit` — exit 0**, a la tercera: las dos primeras corridas destaparon dos cosas reales —una
función de prueba con cuatro parámetros y una flecha de complejidad 11, las dos del propio paquete— y
**una prueba que expiraba unas veces sí y otras no**, que resultó ser INC-014 con un matiz nuevo: las
consultas crudas de la suite no llevaban `company_id` y barrían 34 millones de filas. Está en
`CONSTRUCCION.md` §6 y en la ficha de INC-014.
