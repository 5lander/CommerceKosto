# P3 — Documento de construcción

## Resumen

| Campo | Valor |
|---|---|
| Paquete | P3 — Precios de referencia con vigencia |
| Fecha | 2026-09-04 |
| Commit final | `P3: Precios de referencia con vigencia` |
| Secciones del SPEC | §6 (precios), §11 (parámetros), **§12 completa** (cadena de costo del insumo) |
| Reglas de negocio | **R5** activa · **R13** activa · R10 modelada |
| Estado | ✅ completado |

## Objetivo

**Ningún precio se mueve solo.** Al terminar P3, un precio se sugiere y alguien lo confirma; cambiar el precio de hoy no altera el costo del mes pasado; y la cadena de costo del insumo de SPEC §12 existe como dominio puro, lista para que P5 la use.

**Criterio de aceptación:** cambiar el precio hoy **no altera** el costo de un mes anterior (E8) · ningún precio pasa a vigente sin confirmación (E9) · con `iva_recuperable = false` el costo sube exactamente el porcentaje del IVA (E20, R13).

---

## Qué se construyó

### Esquema

| Tabla | Nota |
|---|---|
| `reference_price` | Una fila por precio, con vigencia. **Nunca se sobrescribe el importe** |
| `reference_price_origin` | `MANUAL` · `ULTIMA_COMPRA` · `EXTERNO` |
| `reference_price_status` | `SUGGESTED` · `CONFIRMED` · `REJECTED` — el estado **es** R5 |
| `company_settings` | Gana la columna `iva_compra` y sus `CHECK`; la siembra un trigger |

### Tres decisiones que merecen su párrafo

**El precio cuelga del ARTÍCULO, no solo del ítem.** «2.30» no significa nada sin «el saco de 2 kg»: de ahí sale el factor de conversión que la fórmula necesita. Un ítem `COMPRADO` exige artículo; una preparación `PRODUCIDO` lo tiene prohibido, porque no se compra — su precio es el **costo estándar por unidad de uso** que fija el usuario (R10), y eso es lo que impide que el plato cambie de costo según cuánto se produjo ese día. Lo hace cumplir un trigger, porque la condición mira otra tabla y un `CHECK` no puede. La otra mitad la cubre una clave foránea **compuesta** contra `purchase_article(id, item_id)`: el artículo tiene que ser del mismo ítem.

**La tasa de IVA de compra va en el PRECIO, no en la company.** El SPEC nombra `iva_compra` en la fórmula de §12 pero no dice dónde vive, y §11 solo trae «IVA de compra recuperable SI/NO». Se modeló en la fila del precio porque en Ecuador el alimento sin procesar es 0 % y el detergente 15 %: una única tasa por company estaría equivocada para uno de los dos, y el error entra directo en el costo de cada plato. `company_settings.iva_compra` es el **valor por defecto** que se propone al capturar.

> Es un superconjunto de las dos lecturas posibles del SPEC: si la intención era una sola tasa, este modelo la expresa poniendo la misma en todas las filas. Al revés no se puede sin migrar cada precio. **Merece confirmación del usuario.**

**Cada company nace con sus parámetros, por trigger.** El alta de tenant es del back office (P11), que no existe todavía, y las de hoy las crean las pruebas y la carga inicial. Un `INSERT` que alguien tenga que acordarse de escribir en tres sitios produce, tarde o temprano, una company sin ajustes — y una company sin ajustes es una donde el motor de costeo no puede calcular nada. Con el trigger, «toda company tiene ajustes» es cierto por construcción. Los valores son los de D3, tomados del Excel: **ninguno está en el código.**

### El dominio

| Archivo | Qué decide | Pruebas |
|---|---|---|
| `cadena-de-costo.ts` | **SPEC §12 textual**: precio neto → costo bruto de uso → costo neto de uso → sobrecosto de merma | 13 |
| `vigencia.ts` | Qué precio estaba vigente a una fecha. R5 y E8 en una función | 11 |
| `ajustes.ts` | Los ocho ratios son fracciones; los umbrales del semáforo van en orden | — |

**Dividir por el rendimiento encarece**, y es lo que más se lee al revés. No es un descuento: es el costo de comprar producto que se pierde al limpiarlo. Con rendimiento 0.8, cada gramo aprovechable cuesta lo de 1.25 gramos comprados.

**Las dos guardas de cero son del SPEC, no defensas inventadas.** `factor = 0` y `rendimiento = 0` devuelven cero porque significan «esto todavía no se capturó», y un catálogo a medio llenar tiene que poder mostrarse. Lo que no puede pasar es que produzcan `NaN` y viajen hasta un margen.

### R5, hecha cumplir en cuatro capas

1. **El estado.** Un precio sugerido no es vigente por mucho que su fecha haya pasado; `precioVigenteA` solo mira los confirmados.
2. **Dos permisos.** `pricing.suggest` y `pricing.confirm` son distintos: `GERENTE_LOCAL` tiene el primero y no el segundo.
3. **Un trigger.** De una fila existente solo cambia el estado, y solo desde `SUGGESTED`. El `GRANT UPDATE` que hace falta para confirmar no sabe distinguir «cambiar el estado» de «cambiar el importe»; el trigger sí.
4. **La condición en el `WHERE`.** `updateMany ... status: 'SUGGESTED'` deja que gane exactamente uno cuando dos administradores confirman a la vez. El segundo recibe 409, no un 204 silencioso.

**`BODEGA` no tiene ni lectura de precios**, y es deliberado (CLAUDE.md §4.3): con el precio y la cantidad se despeja la receta.

---

## Superficie de API

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| `GET` | `/precios?itemId=…` | `pricing.read` | 200 — historial completo |
| `POST` | `/precios` | `pricing.suggest` | 201 · 400 |
| `POST` | `/precios/:id/decision` | `pricing.confirm` | 204 · 404 · 409 |
| `GET` | `/precios/costo/:itemId?fecha=…` | `pricing.read` | 200 · 404 |
| `GET` · `PUT` | `/ajustes` | `settings.read` / `settings.update` | 200 · 204 · 400 |

`GET /precios/costo/:itemId?fecha=…` es **E8 expuesto en la API**: preguntar por el mes pasado devuelve el precio que estaba vigente entonces, no el de ahora.

---

## Lo que se descubrió por el camino

**`migrate:new` dependía de la base de desarrollo de cada quien, y se plantó dos veces.** `prisma migrate dev` es interactivo: ante cualquier aviso —«se añadirá una restricción única», «se añade una columna NOT NULL y hay filas»— pide confirmación por teclado y en un entorno no interactivo muere. Los dos avisos eran espurios: la restricción única era `(id, item_id)` sobre una tabla cuyo `id` ya es clave primaria, y la columna se rellenaba tres líneas más abajo en el bloque manual.

El fondo era peor que la molestia: `migrate dev` mira los **datos** de la base local para decidir si avisa, así que crear una migración dependía de lo que cada quien tuviera en su Docker. Se cambió a `migrate diff`, que produce el mismo SQL, no es interactivo y compara `prisma/migrations` con el modelo — la misma técnica que el paso del `down` ya usaba por la misma razón.

Con un detalle que costó un intento más: la carpeta de la migración se crea **después** del diff, porque `--from-migrations` lee el directorio entero y falla con `P3015` en cuanto encuentra una carpeta sin `migration.sql`.

**Una prueba de la base pasaba sin tocar nada.** El primer intento de «un precio confirmado no se puede reescribir» lanzaba el `UPDATE` con el rol de la aplicación y **sin tenant**: RLS filtraba, la sentencia afectaba a cero filas, y `UPDATE 0` es un éxito. El trigger nunca llegaba a dispararse. La prueba decía «la base impide reescribir un precio» y solo comprobaba que RLS impide *ver* la fila — que ya se prueba en otro sitio. Con el tenant fijado a mano, la fila es visible y lo que la protege es el trigger. Es INC-007 en otra forma: **una prueba puede pasar por no estar tocando nada.**

**La regla del catálogo paró una lectura directa.** `pricing` necesita el rendimiento del ítem y el factor del artículo —los dos factores de la cadena de §12— y el primer intento consultaba `tx.item` a mano. `tablas-de-catalogo-solo-en-catalog` lo marcó. Se resolvió como manda CLAUDE.md §2: `catalog` gana un caso de uso `LeerItem`, lo exporta, y `pricing` lo consume. La regla que se escribió en P2 hizo su trabajo en P3, que es exactamente para lo que estaba.

---

## Deuda

| Qué | Cuándo |
|---|---|
| Sugerencia automática desde la compra real (`origen = ULTIMA_COMPRA`) | **P6**, cuando exista el movimiento de compra que la dispara. Hoy el origen se captura a mano |
| El rendimiento con vigencia | Sin paquete. Hoy el costo histórico usa el rendimiento **actual** del ítem; el SPEC lo trata como atributo del ítem, no como serie |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |
