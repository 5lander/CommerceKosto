# P16-V — Resultado de la auditoría

**Alcance del diff:** `apps/api/src/modules/inventory/domain/errores.ts` (un error nuevo),
`apps/api/src/modules/inventory/application/casos-de-uso/produccion.ts` (la guarda y una función
extraída), `apps/api/test/integracion/inventario.spec.ts` (dos casos y un parámetro de helper),
`docs/pruebas/casos-conocidos.md` (CC-014), `docs/apis/app-cliente.md`, `docs/incidencias/INC-032`,
`docs/pasos/P16-V/`, `ESTADO.md` y el `CHANGELOG`. **Ni una línea de `apps/web`. Ninguna migración.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El error es de **dominio** y no sabe de HTTP; la guarda vive en el **caso de uso**, que es donde se resuelven los costos. No podía ir en `producirLote`: el dominio recibe los insumos ya valorados y ahí un cero es indistinguible de un precio de cero. `audit:arch` sin violaciones |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:duplication` (`0 clones`) en verde. `resolver` pasa a **objeto de parámetros** al necesitar un cuarto dato (§3). **`audit:complexity` paró el paquete** con `ejecutar` en 41 líneas sobre un máximo de 40: se extrajo `resolverInsumos`. **El umbral no se tocó** |
| C · Seguridad | ✅ | Sin superficie nueva: mismo endpoint, mismo permiso `inventory.produce`. El mensaje nombra un ítem **de la propia company** —resuelto desde el catálogo ya filtrado por tenant—, así que no filtra nada de otra (§4.1). No es dato prohibido para `BODEGA` (§4.3): `BODEGA` no tiene `inventory.produce` |
| D · Base de datos | ✅ | `audit:migrations` **22/22**, las mismas: el paquete **no añade migración**. `migrate:verify` 4/4 |
| E · Reglas de negocio | ✅ | **R10** deja de poder mentir: la varianza ya no puede salir de un costo real en cero por falta de precio. **R3 reforzada**: la comprobación no es solo el `400`, es que **no se escribe ni una fila** — en un libro append-only, no escribir es la única corrección posible |
| F · Rendimiento | ✅ | Sin efecto: la guarda lee un `Map` ya cargado, sin consulta nueva. No se ejecuta `npm run bench` porque el paquete **no toca ninguna lectura** (AUDITORIA.md I8) |
| G · Pruebas | ✅ | **+2 de integración** (555 → 557) · **CC-014** con las cifras a mano · y **las dos vistas fallar** contra el código viejo antes de darlas por buenas |
| H · Documentación | ✅ | CC-014 · `docs/apis/app-cliente.md` con el `400` nuevo y su cuerpo · INC-032 **cerrada**, con la desviación de su propio apartado de prevención explicada · `CONSTRUCCION.md` · `ESTADO.md` · `CHANGELOG` |
| I · Duplicación / YAGNI | ✅ | Ni marca «sin valorar», ni estado nuevo, ni columna: la opción (b) se descartó por escrito y no se dejó andamiaje suyo. Lo añadido es **un error y un `if`** |

### La prueba que de verdad cierra esto

No es la tabla de arriba: es haber visto las dos pruebas nuevas en **rojo** con el
`?? Money.CERO` restaurado.

```
×  un INSUMO sin precio a la fecha del lote DETIENE la producción
×  y ese lote rechazado NO deja ni una fila en el libro
   Tests  2 failed | 45 passed | 1 skipped (48)
```

Y en verde con la guarda puesta. Sin esa comprobación, dos pruebas nuevas en verde sobre un código
nuevo no distinguen «cubre el fallo» de «no llega a mirarlo» (INC-007).

### Lo que la auditoría destapó, y no estaba en el plan

**`audit:complexity` hizo su trabajo y paró el commit.** `ejecutar` se pasó a 41 líneas por la
llamada multilínea a `resolver`. La salida fácil —subir el máximo a 45— habría sido cambiar la regla
para que el código cupiera. Se extrajo `resolverInsumos`, que además da nombre a lo que el `map`
hacía sin decirlo: *todos valorados o ninguno*.

### Salida de `npm run audit`

```
audit:forbidden  OK — 49 reglas sobre 602 archivos
✔ no dependency violations found (397 modules, 1788 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 543 skipped (562)     (cabeceras de seguridad)
      Tests  918 passed (918)                  (unitarias, con la base apagada)
ℹ tests 49                                     (apps/web, node --test)
      Tests  557 passed | 5 skipped (562)      (integracion)
audit:tests  OK — unitarias (sin base) e integracion en verde
```
