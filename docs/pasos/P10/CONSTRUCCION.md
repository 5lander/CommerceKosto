# P10 — Importación de catálogo, acotada a una migración operada

> **Alcance recortado por decisión del usuario, con fecha comercial encima.** La importación de este
> paquete **no es un autoservicio**: no hay pantalla de subida, ni previsualización en dos pasos, ni
> deduplicación asistida. Es un comando que un operador ejecuta con el archivo delante. Lo que sí se
> construyó entero es la pieza que no caduca — la escritura en lote atómica—, porque sirve igual a la
> pantalla del día que exista.

---

## Lo que se construyó

| # | Entregable | Dónde |
|---|---|---|
| 1 | Migración `p10_importaciones`: `import_job` + `import_job_status`, RLS deny-by-default y `FORCE`, permiso `import.write` | `apps/api/prisma/migrations/20260907180439_p10_importaciones/` |
| 2 | **Escritura EN LOTE en los cuatro módulos dueños**, una transacción por lote | `catalog`, `pricing`, `recipes`, `inventory` |
| 3 | **Escritura de `combo_component`** — la tabla existía desde P4 y nadie la había escrito nunca | `recipes/…/lotes.ts` |
| 4 | Descriptor `PRECIOS` (nuevo) y columnas `empaque` / `activo` en `PRODUCTOS` | `imports/domain/tipos.ts` |
| 5 | Caso de uso `ImportarArchivo`, módulo `ImportsModule` y repositorio Prisma del rastro | `imports/` |
| 6 | `npm run importar`, con guarda de producción y sesión por el camino del login | `apps/api/src/cli.ts`, `scripts/importar.mjs` |
| 7 | **ADR-013** (parser aislado) y **ADR-014** (`LNK` era un componente de combo) — **D4 cerrada** | `docs/decisiones/` |
| 8 | **835 pruebas**: 558 unitarias con la base apagada + 277 de integración | |

---

## La decisión que justifica el paquete

**Antes de P10, cada método de repositorio abría su propia transacción con el tenant fijado.** Es lo
correcto para un alta suelta y es un desastre para un lote: 200 ítems eran 200 transacciones, y la
fila 150 mala dejaba escritas las 149 buenas.

**Y no se podía envolver desde fuera.** `ClienteDeTransaccion` es `Prisma.TransactionClient`, que
—a propósito— no expone `$transaction`: una transacción no puede contener a otra. Así que la solución
no era un envoltorio, era **un método de repositorio nuevo por módulo** que abre un solo `run()` y
hace todo dentro, con la validación del lote entero antes, en dominio puro.

| Módulo | Caso de uso | Nota |
|---|---|---|
| `catalog` | `CrearItemsEnLote`, `CrearArticulosEnLote` | Crea también los grupos que falten, dentro de la misma transacción |
| `pricing` | `SugerirPreciosEnLote` | Nacen sugeridos; `confirmar` los deja vigentes **a petición explícita** (R5) |
| `recipes` | `CrearProductosEnLote`, `GuardarRecetasEnLote` | Productos + PVP + empaque; recetas y combos |
| `inventory` | `RegistrarMovimientosEnLote` | **El único que no tocó su repositorio**: `registrarVarios` ya existía desde P6 |

### El límite que no se puede eliminar, dicho en voz alta

**La atomicidad es por pasada, no entre módulos.** Importar ítems y luego precios son dos
transacciones, y no hay forma de que sean una. Lo que lo compensa es el **orden**: el archivo se
valida entero antes de abrir ninguna transacción, así que un error de fila no puede aparecer a mitad.
Lo que queda expuesto es un fallo de infraestructura entre pasadas — y ahí el estado honesto es el
que queda: filas escritas y el trabajo en `ANALIZADA`, que dice que nadie confirmó.

---

## Lo que la auditoría paró, y mejoró el diseño

Cuatro checks pararon cosas reales, y ninguna se arregló bajando un umbral.

**1. `audit:forbidden` — `no-as-unknown-as`.** El repositorio sacaba el análisis del `jsonb` con
`as unknown as Analisis`: una promesa de tipo que la base no respalda. Al mirarlo, resultó que
**nadie llamaba a `leer()`** — el comando imprime el análisis que acaba de calcular. Se borró el
método entero. El check tenía razón dos veces.

**2. `audit:arch` — `domain-no-importa-application`.** `recipes/domain/lote.ts` y
`pricing/domain/lote.ts` importaban `TipoDeProducto` y `OrigenDePrecio` desde sus puertos. Son
conceptos de negocio —SPEC §8 y D8—, no tipos de persistencia: se mudaron al dominio y el puerto los
reexporta. El dominio quedó mejor de lo que estaba.

**3. `audit:deadcode` — knip.** Destapó que **`MAXIMO_BYTES` y `MAXIMO_DE_FILAS` no los aplicaba
nadie**, con sus dos errores de dominio sin usar. No era código muerto: era un **límite de
`SEGURIDAD.md` §5.1 declarado y desconectado**. Se conectaron en `ImportarArchivo` — el tamaño antes
de leer nada, las filas después de leer y antes de analizar.

**4. `audit:duplication`.** Dos clones: el `auditar` del lote, copiado en `catalog` y `recipes` → se
extrajo a `shared/application/auditoria-de-lote.ts`; y el IVA por defecto de la company, copiado
entre `precios.ts` y `lotes.ts` → una sola función exportada.

---

## Prueba manual

```bash
# 1. El comando arranca y explica (es lo que INC-017 decía que ningún check cubre)
npm run importar

# 2. Analizar sin escribir
export COSTEO_IMPORT_PASSWORD='...'
npm run importar -- items.csv --tipo=ITEMS \
  --company=<uuid> --ubicacion=<uuid> --usuario=admin@cliente.ec

# 3. Escribir
npm run importar -- items.csv --tipo=ITEMS \
  --company=<uuid> --ubicacion=<uuid> --usuario=admin@cliente.ec --confirmar
```

El orden de las pasadas para un catálogo completo:

```
ITEMS → ARTICULOS → PRECIOS → PRODUCTOS → RECETAS → MOVIMIENTOS
```

No es arbitrario: un artículo necesita su ítem, un precio necesita su artículo, una receta necesita
sus productos y sus ítems, y un movimiento necesita su ítem.

---

## Lo que este paquete NO hizo, y está registrado

| Aplazado | Motivo |
|---|---|
| Pantalla de subida, previsualización en dos pasos, deduplicación asistida | Fuera de alcance por decisión del usuario. El dominio de similitud (`similitud.ts`, 15 pruebas) se queda escrito y sin cablear |
| Alias de cabecera del dialecto del Excel de referencia y mapeo `INS`/`SUP`/`SUB`/`LNK` | El primer cliente no es el dueño de ese Excel. Sería vocabulario de un archivo que no se va a importar |
| Prueba de similitud contra `pg_trgm` real | El índice `item_name_similitud` existe desde P2 y `similarity('tomate riñón','tomate rinon') = 0.53` está medido. Lo que no está probado es que el dominio —que quita tildes— y `pg_trgm` —que no— coincidan siempre |
| Adaptador real de `FileStoragePort` | El archivo vive en el disco del operador. `storage_key` es la identidad del trabajo, no un puntero |
