# DECISIONES.md — Valores provisionales para construir sin frenarse

> Las decisiones abiertas del proyecto, resueltas con un **valor provisional** para que la construcción no se detenga.
> **Regla**: todo valor de este archivo se implementa como **configuración versionada**, nunca como constante en el código.
> Estado: 🟡 provisional (usar sin preguntar) · ✅ confirmada por el usuario · 🔴 bloqueante (preguntar sí o sí)

---

## D1 — Nombre del proyecto 🟡

**Valor provisional:** `costeo-saas` como nombre de trabajo del repositorio y los paquetes.

No hay nombre comercial definido. **No inventar branding.** Usar el nombre de trabajo en código y rutas; los textos visibles al usuario que necesiten el nombre del producto leen de `config/branding.ts`, con el valor provisional `"Costeo"`.

Destranca: dominio, marca, correo transaccional. Ver `docs/FASE0-CHECKLIST.md` A1.

---

## D2 — Versiones exactas del stack ✅

**Resuelta en la fase PLAN de P0, el 2026-08-27.** Los seis puntos se verificaron en fuente oficial el **2026-08-26**, con verificación adversarial independiente por punto. El detalle completo, con citas textuales y enlaces, está en **`docs/decisiones/ADR-001-versiones-del-stack.md`**.

| Componente | Versión fijada | Fin de soporte confirmado |
|---|---|---|
| Node.js | **24.20.0** (Active LTS) | **2028-04-30** |
| PostgreSQL | **18.6** (GA 2025-09-25) | **2030-11-14** |
| NestJS | **11.2.3** | Sin política publicada |
| Prisma | **7.10.0**, versión **exacta** | Sin política publicada |
| Next.js (P12) | **16.3.3** | **~2027-10-21** |

**Lo que la propuesta de partida tenía mal:**

- Decía **«Prisma 6»**: estaba desactualizada por dos majors. La estable es 7.10.0.
- Decía que **Next.js «no tiene LTS»**: sí publica política formal, de dos años por major. Pero durante el Maintenance LTS los cambios rompedores llegan como semver-**minor**, así que la consecuencia de cero lógica de negocio en el frontend se refuerza.
- **Node 26 todavía no ha promovido a LTS.** Promueve el **2026-10-28**. Se arranca en 24 y se planifica el salto (ítem C7 de `docs/FASE0-CHECKLIST.md`). No adelantarlo: NestJS 11 aún no prueba Node 26 en su CI.

**Trampa operativa confirmada:** el dist-tag `latest` de npm apunta a `prisma@8.0.0-rc.12`. Un `npm install prisma` sin versión fijada **instala un Release Candidate**. La versión va exacta, sin `^` ni `~`.

**Node 20 alcanzó su fin de soporte el 2026-04-30.** No usarlo.

---

## D12 — ORM: Prisma frente a Drizzle ✅

**Confirmada por el usuario: Prisma**, con las tres barreras de aislamiento de `CLAUDE.md` §4.1 implementadas completas.

**Versión fijada: Prisma 7.10.0, exacta** (ver D2 y ADR-001). La propuesta original decía «Prisma 6»: estaba desactualizada por dos majors.

**El problema.** Prisma 7 **no tiene soporte RLS nativo**. El patrón obligado es transacción interactiva + `SET LOCAL` inyectado mediante Client Extensions (`$extends`), y tiene caveats conocidos con connection pooling. Drizzle ORM, en cambio, declara políticas RLS **en el esquema** (`pgPolicy`, `pgRole`) y da control explícito de la conexión, lo que reduce la probabilidad de ejecutar un query en una conexión sin contexto de tenant.

**Por qué Prisma igual.** Tres razones:

1. **La garantía real la da PostgreSQL**, no el ORM. Con RLS deny-by-default, `FORCE ROW LEVEL SECURITY` y un rol de aplicación no-superusuario, una fuga es imposible aunque el ORM se use mal. El ORM solo determina la ergonomía de fijar el contexto
2. **Madurez.** Prisma tiene más trayectoria, ecosistema y tooling. Drizzle ha tenido más rotación de API
3. **La integración futura con Noctis Commerce**, que usa Prisma. Dos ORMs distintos en productos que un día se fusionan es fricción evitable

**Condiciones para que esta decisión sea válida.** Si alguna no se cumple en P1, se reevalúa:

- Un único punto centralizado con `$extends` que fuerce transacción + `SET LOCAL`
- Regla de `audit:forbidden` que impida usar el cliente fuera de ese envoltorio
- Prueba explícita bajo **PgBouncer en modo transacción** antes de producción. ⚠️ Verificado en ADR-001: Prisma ya **no** recomienda `?pgbouncer=true` desde PgBouncer 1.21.0. Sigue exigiendo modo transacción, `max_prepared_statements > 0` y conexión directa separada para el CLI
- Test de dos tenants que falla si el envoltorio se omite

**La decisión está confirmada, las condiciones no son opcionales.** Confirmar Prisma no elimina el problema que Drizzle resolvía de fábrica: lo traslada a la barrera 1 y al envoltorio de `$extends`. Si esas cuatro condiciones no están completas al cerrar P1, el aislamiento depende de que nadie se equivoque nunca, y eso no es una garantía.

### Verificado en P0: sí existe RLS nativo, pero no cambia la decisión

El punto 4 de la tabla de `CLAUDE.md` §1 resultó **positivo pero condicionado**, y se ejecutó la parada. Lo confirmado el 2026-08-26:

- **Prisma 8 introduce RLS declarativo nativo**: marcador `@@rls` fail-closed, bloques `policy_select` en PSL que cubren *"every operation, not just SELECT"*, declaración equivalente desde contratos TypeScript, verificación de roles con `db verify`, e introspección de políticas existentes con `contract infer`.
- **Prisma 8 es Release Candidate, no GA.** El changelog oficial dice *"Scope and behavior may still change"*. No tiene página de documentación de RLS (404), se anunció como Early Access, su runtime es otro paquete (`@prisma/orm-postgres`), y su documentación no cubre PgBouncer ni pooling externo.
- **Y lo decisivo: el RLS nativo cubre la Barrera 1, no la Barrera 2.** En ninguna versión de Prisma existe una API para fijar el tenant por transacción — ni `setContext`, ni `withContext`, ni un envoltorio documentado de `SET LOCAL`. El único patrón oficial es el Client Extension con `set_config(..., TRUE)`, que lleva descargo explícito de *"not intended to be used in production"* y rompe las transacciones explícitas del usuario.
- **Drizzle tampoco la resuelve**: su propia `/docs/rls` fija el tenant con `set local` dentro de una transacción. Además su documentación pública describe la API de la 1.0 RC (`withRLS`), que no existe en la estable 0.45.2 (ahí es `enableRLS`), y `FORCE ROW LEVEL SECURITY` no aparece documentado.

**Conclusión, decidida por el usuario: se mantiene Prisma, en 7.10.0.** El supuesto de esta decisión cambia en la letra, pero no en lo que costaba: la Barrera 2 sigue siendo trabajo propio en las tres opciones. Las políticas RLS van como SQL manual dentro de las migraciones, donde tienen expresividad completa. Se reevalúa cuando Prisma 8 sea GA y publique documentación de RLS; `contract infer` ofrece entonces una ruta de migración desde el SQL escrito a mano.

Debe quedar registrado en **ADR-002**, incluyendo por qué se descartó Drizzle: la garantía real la aporta PostgreSQL, la madurez de Prisma, y la integración futura con Noctis Commerce, que ya usa Prisma.

### Cerrado en P1: las cuatro condiciones, verificadas

| # | Condición | Estado | Dónde se comprueba |
|---|---|---|---|
| 1 | Envoltorio único que fuerce transacción + tenant | ✅ | `shared/infrastructure/persistence/tenant-transaction.ts`, el único archivo que toca el cliente crudo |
| 2 | Regla de `audit:forbidden` que impida usarlo fuera | ✅ | `tools/audit/rules/tenant.rules.mjs`, tres reglas |
| 3 | Test de dos tenants que falla si el envoltorio se omite | ✅ | `apps/api/test/integracion/aislamiento-entre-companies.spec.ts` |
| 4 | **Prueba explícita bajo PgBouncer en modo transacción** | ✅ | `apps/api/test/integracion/pgbouncer.spec.ts` |

**La cuarta era la que podía obligar a reabrir esta decisión, y pasó.** PgBouncer 1.25.2 en modo transacción con `default_pool_size = 1` —una sola conexión al servidor, para que la reutilización entre clientes sea segura y no probable—: dos clientes distintos alternando dos companies, en serie y en paralelo, nunca cruzan datos, y un cliente que consulta sin tenant sobre la conexión reutilizada ve cero filas.

Se comprobó además que esa prueba **mide algo**: con `set_config(..., FALSE)` en vez de `TRUE`, el segundo cliente ve la fila del primero. Detalle que conviene conocer: al deshacer el cambio la prueba seguía fallando hasta reiniciar PgBouncer — el tenant filtrado vivía en la conexión que el pooler guarda y sobrevivió al reinicio del proceso entero.

Una desviación respecto de lo que decía esta decisión: **no se usa `$extends`**. El envoltorio es una clase con un método `run(company, trabajo)` que abre `$transaction` y ejecuta `set_config(..., TRUE)` dentro. Cumple lo mismo que pedía la condición 1 —un único punto que fuerza transacción y tenant— sin heredar el descargo de «not intended to be used in production» que lleva el patrón de Client Extension.

**Detalle completo en ADR-006.**

---

## D3 — Parámetros de costeo por defecto ✅

Valores confirmados, tomados del Excel original. **Son configuración por company**, editables desde la app, con estos valores como semilla al crear un tenant:

| Parámetro | Valor semilla | Vive en |
|---|---|---|
| IVA de venta | `0.15` | `company_settings` |
| IVA de compra recuperable | `true` | `company_settings` |
| Provisión de merma no atribuible | `0.02` | `company_settings` |
| Food cost objetivo mínimo | `0.25` | `company_settings` |
| Food cost máximo aceptable | `0.32` | `company_settings` |
| Umbral verde de food cost | `0.28` | `company_settings` |
| Prime cost máximo | `0.65` | `company_settings` |
| Días operativos al mes | `22` | `company_settings` |
| Días de cobertura objetivo | `7` | `company_settings` |
| Regla de popularidad (Kasavana-Smith) | `0.70` | `company_settings` |

**Ninguno de estos números se escribe en el código.** El motor de costeo los recibe como parámetro.

---

## D4 — Qué representa el tipo `LNK` en T1 del Excel ✅

**Resuelta en P10, el 2026-09-07, leyendo el archivo.** El detalle completo, con las fórmulas como
evidencia, está en **`docs/decisiones/ADR-014`**.

**`LNK` no es un tipo de insumo: es el apaño con el que el Excel armaba un COMBO.** La celda de
precio de esas cuatro filas no contiene un precio, contiene
`=INDEX(V_COSTEO!$H, MATCH("<código>", V_COSTEO!$B))` — el *costo neto por porción* de un **producto
de venta**. Y las cuatro se usan en una única línea de receta, tres de ellas de un producto de la
categoría `COMBOS UNIVERSITARIOS`.

En una hoja, un producto solo puede tener ingredientes; para meter un plato dentro de otro hay que
disfrazar el plato de ingrediente. **Este sistema no lo necesita**: SPEC §8 modela `COMBO` con
componentes que son productos simples, y ADR-008 §14 fija que el combo suma componentes **ya
costeados**. Un `LNK` se traduce a una fila de `combo_component`, nunca a un ítem — hacerlo como ítem
congelaría un costo derivado y cobraría la merma dos veces (R12).

Queda cerrado también el resto de la columna: `INS` → `COMPRADO` con confianza `FACTURA`; **`SUP` →
`COMPRADO` con confianza `ESTIMADO`** (es un precio *supuesto*, y sus 8 filas son estructuralmente
idénticas a las `INS`); `SUB` → `PRODUCIDO`.

**Lo que el hallazgo destapó:** `combo_component` existía desde P4 y **nadie la había escrito nunca**.
Un combo se podía crear y jamás componer, y costaba cero. P10 abrió esa ruta.

Dos de las cuatro filas tienen defecto propio y se tratan aparte: **INS-149** enlaza a un producto
que no existe y el `IFERROR` lo vuelve **0** —se rechaza, un cero es un número que entra en un
margen—, e **INS-090** está marcada `LNK` sin enlazar nada, así que es un `INS` mal tipado.

---

## D5 — Modelo de suscripción y precios 🟡

**Valor provisional:** suscripción mensual por company con límite de ubicaciones incluidas. Estructura de tres planes, sin precios definidos.

En código: la company tiene un `plan_id` y el plan declara límites (`max_locations`, `max_items`, `max_products`). Los límites se **verifican en el backend** desde el primer paquete que los toque, con valores generosos por defecto.

No implementar cobro, pasarela ni facturación en este proyecto. Ver D9.

---

## D6 — Retención y cierre de períodos 🟡 *(implementada en P7)*

**Valor provisional:** un período es un mes calendario. Se cierra manualmente al cargar el conteo físico. Un período cerrado es de solo lectura: los movimientos con fecha dentro de él se rechazan.

Reapertura: posible solo por rol `OWNER`, registrada en el log de auditoría.

Vive en `config/periods.ts`.

### Lo que P7 tuvo que decidir para implementarla

El valor provisional se implementó **entero y al pie de la letra**. Lo que no decía, y hubo que resolver (**ADR-010**):

| Pregunta que D6 no responde | Decisión de P7 |
|---|---|
| ¿El período es de la company o de una ubicación? | **De una ubicación.** El conteo se hace por ubicación (R2), y un período de company obligaría a las diez ubicaciones de una cadena a contar el mismo día |
| ¿Dónde vive la frontera del mes? | **En dos columnas `timestamptz`, resueltas una sola vez al abrirlo.** `occurred_at` es absoluto y su mes depende de la zona; con la frontera escrita, cambiar la zona no mueve de mes movimientos ya cerrados |
| ¿Qué pasa con un mes del que nadie se ha ocupado? | **No tiene fila, y eso significa abierto.** Exigir abrirlo pararía el sistema el día 1 de cada mes |
| «Se cierra al cargar el conteo»: ¿es un endpoint propio? | **No.** Es `POST /conteos/:id/cierre-de-periodo`, exige el conteo confirmado, y pide `count.write` **y** `period.close` |
| «Registrada en el log»: ¿verificado? | **Se escribe, y nadie lo ha leído.** No existe rol con `SELECT` sobre `audit_log`, ni siquiera el dueño (SEGURIDAD.md §10). Es trabajo de P11 |

**`config/periods.ts` acabó en `shared/infrastructure/config/periods.ts`**: una carpeta `src/config/` suelta quedaría fuera de las tres capas que `audit:arch` vigila. Contiene la zona horaria del calendario contable, que es la de D11.

---

## D7 — Política de conteo físico parcial 🟡 *(implementada en P7)*

**Valor provisional:** el conteo puede ser parcial. Los ítems sin conteo no generan diferencia y quedan marcados como "sin verificar"; el food cost real se calcula señalando qué porcentaje del valor del inventario fue efectivamente contado.

Alternativa descartada por ahora: exigir conteo completo. Se descartó porque en la práctica nadie cuenta 200 ítems y forzarlo produce números inventados.

### Lo que «no generan diferencia» significa exactamente

Es la frase de la que dependía todo el paquete, y admitía dos lecturas. La que se implementó (**ADR-010 §5**):

> **Un ítem sin contar aporta su valor TEÓRICO al inventario final, no cero.**

Si valiera cero, no haber mirado un estante equivaldría a declarar que su contenido se consumió entero, y el consumo real de SPEC §16 se dispararía por una omisión de captura. En el modelo, `physical_count_line.quantity` es anulable y las tres cosas son distintas:

| | |
|---|---|
| `quantity = 0` | alguien miró y no había |
| `quantity IS NULL` | **nadie miró** |
| sin línea (borrador) | todavía no se ha anotado |

**«Qué porcentaje del valor» se mide sobre el VALOR, no sobre el número de ítems.** Contar cuarenta ítems baratos y dejar el jamón sin contar es una cobertura mala aunque sean 40 de 41:

```
cobertura = Σ(teórico × costo) de los contados / Σ(teórico × costo) de todos
```

Es `null` —no «0 %»— cuando no hay nada que verificar, y **viaja siempre pegada** a los números que dependen de ella.

⚠️ **La cobertura no detecta un error en el inventario final.** El guardián 3 de P7 lo demuestra: valorando en cero lo que nadie contó, la cobertura sigue diciendo 50 % y el consumo real se multiplica por seis. Lo único que lo caza es el número absoluto contra un caso calculado a mano.

---

## D8 — Fuentes externas de precios ✅

**Decisión: fuera de alcance de este proyecto.** No se implementa integración con Tipti ni scraping de ninguna plataforma.

Razones registradas: son precios de retail al consumidor y los clientes compran mezclado entre mayorista y supermercado; no consta API pública para terceros; el scraping implicaría incumplimiento probable de términos de uso y una dependencia frágil en el camino crítico del producto.

**Lo único que se construye:** el campo `origen` del precio de referencia acepta `MANUAL`, `ULTIMA_COMPRA` y `EXTERNO`. Nada más.

Pendiente de negocio, no de código: verificar con el equipo comercial de Tipti si existe acceso bajo contrato, sus términos de uso, y si permiten redistribuir precios dentro de un producto de terceros.

---

## D9 — Integración futura con Noctis Commerce 🟡

**Valor provisional:** este proyecto es independiente y no comparte código, base de datos ni despliegue con Noctis Commerce.

Restricción que sí se respeta desde ahora: la API no asume que las unidades vendidas se digitan. El caso de uso `RegisterSales` recibe un lote de (producto, ubicación, período, unidades) sin importar si viene de digitación, importación o un sistema externo. La digitación es un adaptador más.

No diseñar la integración. Solo no cerrarle la puerta.

---

## D10 — Hosting y despliegue 🟡

**Valor provisional:** contenedores sobre AWS, con PostgreSQL gestionado. La decisión concreta de servicio se posterga al paquete de endurecimiento.

Consecuencia obligatoria desde P0: **nada específico de proveedor en el código de aplicación.** Almacenamiento de archivos y correo van tras puerto con fake.

---

## D11 — Idioma y localización 🟡

**Valor provisional:** español de Ecuador, moneda USD, zona horaria `America/Guayaquil`, formato de fecha `dd/MM/yyyy`.

Los textos visibles viven en archivos de recursos desde el primer componente, aunque haya un solo idioma. El código es en inglés.

---

## Cómo usar este archivo

- Claude Code **usa estos valores sin preguntar** mientras estén en 🟡
- Si una tarea exige decidir algo que **no está aquí ni en el SPEC** → se agrega a `ESTADO.md` como duda, se elige la opción **más conservadora y configurable**, y se deja registrado
- El usuario cambia 🟡 → ✅ al confirmar, o corrige el valor
- Los 🔴 sí detienen. **D2 quedó resuelta en P0** (ADR-001) y **D4 en P10** (ADR-014): **no queda ningún 🔴 vivo**
- D12 (ORM) quedó confirmada en Prisma. Sus cuatro condiciones se verifican al cerrar P1.
