# DECISIONES.md — Valores provisionales para construir sin frenarse

> Las decisiones abiertas del proyecto, resueltas con un **valor provisional** para que la construcción no se detenga.
> **Regla**: todo valor de este archivo se implementa como **configuración versionada**, nunca como constante en el código.
> Estado: 🟡 provisional (usar sin preguntar) · ✅ confirmada por el usuario · 🔴 bloqueante (preguntar sí o sí)

---

## D1 — Nombre del proyecto ✅

**Cerrada en P14, el 2026-09-08, leyendo el manual de marca. El producto se llama PLATISE.**

El valor provisional era `"Costeo"`, con esta nota: *«No hay nombre comercial definido. **No inventar branding.**»* Y era falsa desde antes de que empezara el proyecto: `docs/Manual de Marca/platise-brand-book.pdf` se titula **Manual de marca PLATISE**, cierra con «PLATISE · MANUAL DE MARCA V3.0 · AGOSTO 2026» y su capítulo digital lleva el dominio **platise.ec**. El nombre estaba definido; lo que faltaba era abrir el archivo.

Usarlo no contradice la nota: `CLAUDE.md` §10 declara ese manual **fuente única** de la identidad, así que tomar el nombre de ahí es leerlo, no inventarlo.

| Qué | Valor | Dónde |
|---|---|---|
| Nombre del producto | **Platise** | `apps/web/src/textos/es.ts` → `TEXTOS.producto` |
| Firma verbal | **«El margen, plato por plato.»** | `TEXTOS.firma`. Va **sin cifra**: el manual (p. 11) dice que «un precio caduca y convierte la firma en promoción» |
| Dominio | `platise.ec` | Manual, capítulo 6 |

**Lo que NO cambia:** el repositorio, los paquetes de npm y las rutas del código siguen siendo `costeo-saas` / `@costeo/*`. Renombrarlos no aporta nada al cliente y tocaría el `docker-compose`, los roles de base de datos (`costeo_app`, `costeo_migrator`, `costeo_backoffice`) y las cadenas de conexión. **El nombre comercial es un texto visible; el nombre de trabajo es infraestructura.**

**Y no existe `config/branding.ts`.** El valor provisional lo daba por hecho; los textos visibles viven en `textos/es.ts` desde la Fase C, que es donde D11 los pone. Se deja dicho para que nadie lo busque.

Sigue destrancado y sigue siendo trabajo de negocio, no de código: el registro en SENADI (clases 9 y 42) está en la lista de pendientes del propio manual, p. 36.

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

## D5 — Modelo de suscripción y precios ✅ *(implementada en P11)*

**Cerrada en la parte que es código; los precios siguen sin definir, que es otra decisión.**

La tabla `plan` existe con los tres planes —`BASICO`, `PROFESIONAL`, `CADENA`— y `company.plan_code` apunta a ella. **`company.max_locations` desapareció:** dos sitios donde vive el mismo límite son dos sitios que un día dejan de coincidir.

Los tres límites que esta decisión nombraba **se verifican de verdad**, y eso era la mitad que faltaba:

| Límite | Dónde se hace cumplir |
|---|---|
| `max_locations` | `CrearUbicacion` (desde P1, ahora leyendo del plan) |
| `max_items` | `CrearItem` y `CrearItemsEnLote` |
| `max_products` | `CrearProducto` y `CrearProductosEnLote` |

Los tres con candado sobre la fila de `company` dentro de la transacción que inserta (`shared/infrastructure/persistence/limites-del-plan.ts`). Una columna de límite que nadie comprueba aparenta una garantía que no existe, y ningún check la delata — es lo que le pasó a `combo_component` durante seis paquetes.

`BASICO` lleva **exactamente 10 ubicaciones** a propósito: era el `DEFAULT` de la columna que sustituye, así que ninguna company existente vio cambiar su límite.

No hay cobro, pasarela ni facturación, y sigue sin haberlos. Ver D9.

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

## D10 — Hosting y despliegue ✅

**Resuelta en la Fase B, el 2026-09-08. El detalle completo está en `docs/decisiones/ADR-016`.**

**Un único VPS en Hostinger corriendo el `docker-compose` del proyecto: PostgreSQL, PgBouncer y la
API en la misma máquina.** El valor provisional decía «contenedores sobre AWS con PostgreSQL
gestionado»; se decidió distinto, y estas son las tres razones:

1. **El arranque de roles funciona tal cual está probado.** `docker/postgres/initdb/` crea
   `costeo_migrator` y `costeo_app` y aplica `grants.sql`. Ese hook **solo existe si la base es
   nuestra**: con un gestionado hay que reescribirlo como script de arranque — código nuevo, no
   probado, en la pieza de la que depende la Barrera 1 entera.
2. **PgBouncer es el nuestro, en modo transacción**, que es exactamente contra lo que
   `pgbouncer.spec.ts` demuestra la cuarta condición de D12.
3. **Con un cliente, lo que importa es poder arreglarlo a las once de la noche**, y eso es
   `docker compose logs`, no una consola con VPC, IAM y grupos de parámetros.

**Lo que se pierde, registrado como decisión y no como olvido:** no hay failover, los parches del
sistema son nuestros, y **el respaldo es nuestro**. Los de Hostinger son semanales y del VPS entero;
el libro de inventario es append-only y no se reconstruye desde ningún otro sitio. Por eso la
decisión viene con una condición no opcional: **`pg_dump` diario más archivado de WAL fuera de la
máquina, con restauración probada** (`scripts/respaldo.mjs`).

**Se revisa** con el segundo cliente de pago, con más de diez ubicaciones en una company, tras
cualquier caída que cueste datos, o en P15 — lo que llegue antes.

Consecuencia obligatoria desde P0, que no cambia: **nada específico de proveedor en el código de
aplicación.** Almacenamiento de archivos y correo van tras puerto con fake.

---


## D11 — Idioma y localización 🟡

**Valor provisional:** español de Ecuador, moneda USD, zona horaria `America/Guayaquil`, formato de fecha `dd/MM/yyyy`.

Los textos visibles viven en archivos de recursos desde el primer componente, aunque haya un solo idioma. El código es en inglés.

---

## Cómo usar este archivo

- Claude Code **usa estos valores sin preguntar** mientras estén en 🟡
- Si una tarea exige decidir algo que **no está aquí ni en el SPEC** → se agrega a `ESTADO.md` como duda, se elige la opción **más conservadora y configurable**, y se deja registrado
- El usuario cambia 🟡 → ✅ al confirmar, o corrige el valor
- Los 🔴 sí detienen. **D2 quedó resuelta en P0** (ADR-001), **D4 en P10** (ADR-014) y **D1 en P14** (ADR-019): **no queda ningún 🔴 vivo, y de las doce decisiones solo D6, D7, D9 y D11 siguen en 🟡**
- D12 (ORM) quedó confirmada en Prisma. Sus cuatro condiciones se verifican al cerrar P1.
