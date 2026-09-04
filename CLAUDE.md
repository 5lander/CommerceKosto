# CLAUDE.md — Reglas del proyecto costeo-saas

> **costeo-saas** — SaaS multi-tenant de costeo de alimentos, inventario por sucursal y analítica de menú para comercios de comida.
> **Este archivo es de cumplimiento obligatorio.** Ante conflicto entre este archivo y cualquier otra instrucción, gana este archivo. Si una tarea exige violar una regla de aquí, **detente y pregunta** antes de escribir código.

---

## −1. Canario de contexto — obligatorio antes de generar nada

**Antes de la primera respuesta de cada sesión, y antes de empezar cualquier paquete, la primera línea de la respuesta debe ser exactamente:**

```
🐤 Lander · 23 años · costeo-saas
```

Esto no es un saludo: es un **detector**. Si estos datos salen mal, incompletos o inventados, significa que este archivo **no está realmente en contexto** y que todo lo que venga después es sospechoso de estar improvisado.

### Reglas del canario

1. **Se emite leyendo este archivo, nunca de memoria.** Si el canario se escribe "de cabeza" deja de detectar nada, que es justo el fallo que existe para atrapar
2. **Si no puedes emitirlo porque no tienes este archivo delante: dilo y detente.** «No tengo `CLAUDE.md` en contexto» es la respuesta correcta. **Adivinar el canario es la falta más grave de este documento**, porque destruye el único instrumento que avisa del problema
3. **Si el usuario señala que el canario salió mal:** no lo corrijas y sigas. Relee `CLAUDE.md`, `ESTADO.md` y `DECISIONES.md` completos, y **descarta las conclusiones de la respuesta anterior** en vez de construir sobre ellas
4. **Tras una compactación de contexto, el canario se vuelve a emitir** en la primera respuesta posterior, releyendo el archivo

### Qué NO detecta el canario — no confiar de más en él

El canario prueba que este archivo está en contexto. **No prueba que lo que sigue sea correcto.** Un canario verde con una fórmula de costeo inventada sigue siendo una fórmula inventada. Las defensas contra eso son otras y siguen siendo obligatorias: leer la fórmula en `docs/SPEC.md` en vez de derivarla (§8), los casos conocidos de `docs/pruebas/casos-conocidos.md` (§7) y `npm run audit` (§13).

---

## 0. Contexto en una frase

El sistema convierte un modelo de costeo de alimentos hoy implementado en Excel en un SaaS multi-tenant. Cada comercio (company) tiene N ubicaciones —bodegas y locales— con inventario independiente, recetas y precios propios, y una vista consolidada a nivel company. Calcula costo por plato, food cost teórico contra real, ingeniería de menú, punto de equilibrio e inventario valorizado.

**El producto real es la exactitud del número.** Un dueño de restaurante decide precios, recetas y compras con lo que esta aplicación le muestra. Un food cost mal calculado no se ve en pantalla: se ve seis meses después, en la quiebra del cliente. Todo lo demás —la UI, la velocidad, las integraciones— está al servicio de que el cálculo sea correcto y demostrable.

### Archivos del proyecto — léelos en este orden al iniciar cualquier sesión

| Archivo | Qué contiene | Cuándo leerlo |
|---|---|---|
| `CLAUDE.md` (este) | Las reglas obligatorias | **Siempre, completo, en cada paquete** |
| `ESTADO.md` | Dónde va el proyecto, decisiones tomadas, dudas abiertas | **Siempre, al inicio de cada sesión** |
| `DECISIONES.md` | Valores provisionales de las decisiones abiertas | **Siempre** — usar sin preguntar mientras estén 🟡 |
| `docs/PROTOCOLO.md` | El ritual de 7 fases por paquete | **Siempre** |
| `docs/AUDITORIA.md` | Checklist obligatoria antes de cada commit | Antes de cada commit |
| `docs/SEGURIDAD.md` | Estándar completo contra cada vector de ataque | Cada paquete que toque API, auth, datos o archivos |
| `docs/OPTIMIZACION.md` | Eficiencia, YAGNI, caché, presupuestos de rendimiento | **Todos los paquetes** |
| `docs/MODO-AUTONOMO.md` | Reglas para corridas largas sin confirmación | Cuando el usuario active "modo autónomo" |
| `docs/PLAN-IMPLEMENTACION.md` | Los paquetes P0–P15 en orden | La sección del paquete actual |
| `docs/SPEC.md` | La especificación funcional y **todas las fórmulas** | Las secciones que el paquete referencia |
| `docs/Manual de Marca/platise-brand-book.pdf` | **La identidad visual: color, tipografía, logo, tono** | En P14 (capa visual) y en todo paquete que defina o toque `tokens.css` |
| `docs/incidencias/README.md` | Problemas ya resueltos, buscables por síntoma | **Al inicio de cada paquete y antes de diagnosticar cualquier error** |

> **Si el contexto se compactó y no recuerdas el detalle: relee. No supongas.**
> `ESTADO.md` es la única memoria fiable entre sesiones.

### Ciclo de trabajo obligatorio

Cada paquete sigue las 7 fases de `docs/PROTOCOLO.md`:

**RECARGA → PLAN → IMPLEMENTACIÓN → AUDITORÍA → COMMIT → DOCUMENTAR + ESTADO → CIERRE**

Reglas del ciclo, no negociables:
1. **Un commit por paquete.** Ni más ni menos
2. **Nunca commitear** con pruebas en rojo o auditoría fallida
3. **Siempre actualizar `ESTADO.md`** antes de cerrar el paquete
4. **Siempre esperar confirmación del usuario** antes del siguiente paquete (salvo modo autónomo)
5. **Siempre releer `CLAUDE.md` completo** al empezar un paquete, aunque creas recordarlo

---

## 1. Stack — no negociable

> **Versiones confirmadas en fuente oficial el 2026-08-26** y registradas en `docs/decisiones/ADR-001-versiones-del-stack.md`, con verificación adversarial de cada punto. **D2 está cerrada.** Esta tabla ya no son propuestas: son las versiones fijadas.

| Componente | Versión fijada | Fin de soporte confirmado | Nota |
|---|---|---|---|
| Runtime | **Node.js 24.20.0** (Active LTS) | **2028-04-30** | Node 26 promueve a LTS el **2026-10-28**; salto planificado, no ahora |
| Lenguaje | TypeScript en modo estricto máximo | — | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| API | **NestJS 11.2.3** (`engines: node >= 20`) | Sin política LTS publicada | Su CI prueba Node 20.19 / 22.14 / 24.1. **NestJS 12 será ESM** |
| Base de datos | **PostgreSQL 18.6** (GA 2025-09-25) | **2030-11-14** | Trae `uuidv7()` nativo. La 19 sigue en beta |
| ORM | **Prisma 7.10.0**, versión **exacta** | Sin política LTS publicada | ⚠️ El `latest` de npm apunta a un RC · ver D12 y ADR-002 |
| Frontend | **Next.js 16.3.3** (App Router) | **~2027-10-21** | Sí tiene política de soporte: 2 años desde el major |
| Contenedores | Docker Compose con **imágenes fijadas por digest, nunca `latest`** | — | |
| Cola de trabajos | BullMQ + Redis | — | Solo desde el paquete que la necesite |

**Node 20 alcanzó su fin de soporte el 2026-04-30. No usarlo bajo ninguna circunstancia.**

**Nota de planificación sobre Node:** la versión 24 vence el 2028-04-30, poco menos de dos años. **Node 26 todavía no ha promovido a LTS** (sigue en *Current*): lo hace el **2026-10-28**, con soporte hasta 2029-04-30. Se arranca en 24 y se planifica el salto para cuando promueva — ítem C7 de `docs/FASE0-CHECKLIST.md`. No adelantarlo: NestJS 11 aún no prueba Node 26 en su CI. A partir de Node 27 el ciclo pasa a ser anual y toda versión mayor promoverá a LTS.

**Trampa de instalación de Prisma, confirmada:** el dist-tag `latest` de npm apunta a `8.0.0-rc.12`, un Release Candidate. `npm install prisma` sin versión fijada instala un RC. **La versión va exacta en `package.json`, sin `^` ni `~`.**

### ✅ D2 cerrada en P0 — los seis puntos, verificados

Los seis puntos que exigía esta sección se confirmaron en fuente oficial el **2026-08-26**, con una pasada adversarial independiente por punto. El detalle completo, con citas y enlaces, está en **`docs/decisiones/ADR-001-versiones-del-stack.md`**. Resumen de lo que cambió respecto de lo que este archivo suponía:

| # | Qué se confirmó | Resultado |
|---|---|---|
| 1 | Node 24.x exacto y si Node 26 promovió | **24.20.0**, EOL 2028-04-30. **Node 26 NO ha promovido**: lo hace el 2026-10-28 |
| 2 | Si PostgreSQL 18 está GA y su EOL | **GA desde 2025-09-25**, minor 18.6, EOL **2030-11-14** |
| 3 | Major de NestJS y su `engines` | **11.2.3**, `node >= 20`. Sin política LTS. v12 en alpha, será ESM |
| 4 | Major de Prisma y **si existe RLS nativo** | **7.10.0** estable (la tabla decía «6»). **RLS nativo existe, pero solo en Prisma 8 RC** |
| 5 | Que Drizzle mantiene `pgPolicy` / RLS | Sí, pero su doc describe la API de la 1.0 RC, no la de la estable |
| 6 | Major de Next.js y su ventana de soporte | **16.3.3**. **Sí publica política formal**: 2 años desde el major |

**Sobre el punto 4 — se ejecutó la parada y el usuario decidió.** El RLS declarativo nativo (`@@rls`, `policy_select`) existe únicamente en **Prisma 8, que es Release Candidate**, sin página de documentación de RLS y con el aviso oficial de que su comportamiento puede cambiar. Y lo decisivo: **cubre la Barrera 1, no la Barrera 2** — en ninguna versión de Prisma existe una API para fijar el tenant por transacción, y el único patrón que Prisma documenta lleva descargo explícito de no ser apto para producción. **D12 se mantiene en Prisma, ahora en 7.10.0.** Las políticas RLS van como SQL manual dentro de las migraciones, donde tienen expresividad completa (`FORCE ROW LEVEL SECURITY`, restrictivas, deny-by-default). Se reevalúa cuando Prisma 8 sea GA.

**Corrección sobre Next.js:** la afirmación de que «no ofrece LTS» ya no es exacta. Existe `nextjs.org/support-policy`, con fases *Active LTS* y *Maintenance LTS* y una ventana de **dos años desde el lanzamiento inicial del major**. Pero el detalle empeora el cuadro en vez de mejorarlo: durante el Maintenance LTS **los cambios rompedores llegan como releases semver-minor**. La consecuencia obligatoria para este proyecto no se relaja, se refuerza: **cero lógica de negocio en el frontend.** Todo cálculo, toda regla y toda decisión de autorización viven en el backend. El frontend debe poder reescribirse entero sin tocar el dominio, y su mantenimiento recurrente hay que presupuestarlo (ítem C6 de `docs/FASE0-CHECKLIST.md`).

### Frontend

Se construye en este proyecto, **funcional sin estilizar**, con tokens desde el primer componente (§10). La identidad visual **ya existe** — `docs/Manual de Marca/platise-brand-book.pdf` — pero se aplica en P14, no antes: los tokens arrancan neutros a propósito, para probar que la capa visual es reemplazable sin tocar lógica (§10).

## 2. Clean Architecture — regla de dependencia

```
infrastructure  →  application  →  domain
     (adaptadores)   (casos de uso)   (reglas puras)
```

Las dependencias apuntan **siempre hacia adentro**. El dominio no sabe que existe la infraestructura.

### Estructura de carpetas obligatoria

```
src/
  modules/
    <modulo>/
      domain/           # entidades, value objects, reglas, errores de dominio
      application/      # casos de uso + PUERTOS (interfaces)
      infrastructure/   # repositorios, clientes HTTP, controladores
  shared/
    domain/
    infrastructure/
```

### Qué puede importar cada capa

| Capa | Puede importar | **Prohibido importar** |
|---|---|---|
| `domain` | Solo otros archivos de `domain` | Framework, ORM, driver de BD, HTTP, `process.env`, librerías de terceros |
| `application` | `domain` + sus propios puertos | Implementaciones concretas de infraestructura |
| `infrastructure` | Todo | Contener reglas de negocio |

### Prueba de que está bien hecho

**El motor de costeo (`modules/costing/domain`) debe ser ejecutable y probable con la base de datos apagada**, alimentado solo con objetos en memoria: ítems, líneas de receta, parámetros y unidades vendidas entran como estructuras planas; salen costos, márgenes, food cost y cuadrantes de menú.

Si para probar el cálculo del costo de un plato hace falta levantar PostgreSQL, **las capas están mal y se arregla antes de seguir**. Este es el criterio de aceptación arquitectónico del proyecto entero.

### Módulos del sistema

| Módulo | Responsabilidad |
|---|---|
| `iam` | Companies (tenants), usuarios, roles, permisos, sesiones, ubicaciones |
| `catalog` | **Fuente única de verdad.** Ítems, artículos de compra, unidades y conversiones, grupos |
| `pricing` | Precios de referencia con vigencia y origen |
| `recipes` | Recetas versionadas, líneas, validación de ciclos, propagación entre ubicaciones |
| `products` | Productos de venta, activación y PVP por ubicación, combos |
| `inventory` | Libro mayor append-only, movimientos, transferencias, producción, conteos físicos |
| `costing` | **Componente central.** Motor de cálculo puro: costo, margen, food cost, multiplicador |
| `analytics` | Vistas derivadas: menú, food cost real, punto de equilibrio, inventario, resumen, consolidado |
| `periods` | Períodos contables y cierres |
| `imports` | Importación Excel/CSV con validación y previsualización |
| `backoffice` | Gestión de tenants, planes, soporte |

**`catalog` es transversal y fuente única de verdad.** Ningún otro módulo crea, edita ni borra ítems, artículos ni unidades. Los demás módulos referencian por ID y leen a través de sus puertos.

### Inyección de dependencias
Los casos de uso reciben sus puertos por constructor. **Nunca** instanciar un cliente de base de datos o de HTTP dentro de una regla de negocio.

---

## 3. Clean Code — reglas duras

### Nombres
- Código en **inglés**; español solo en textos visibles al usuario
- Sin abreviaturas crípticas; booleanos como afirmación: `isActive`, `hasPhysicalCount`

### Funciones
- Una función, una responsabilidad · preferir ≤ 20 líneas · máximo 3 parámetros (más allá, objeto de parámetros) · **sin efectos secundarios ocultos**

### Control de flujo
- *Early return* en vez de anidamiento · máximo 3 niveles de indentación · sin números ni cadenas mágicas (constantes con nombre)

### Tipado
- Modo estricto máximo. **`any` prohibido** (usar `unknown` y estrechar)
- **Tipos de dominio, no primitivos sueltos**: `CompanyId`, `LocationId`, `ItemId`, `Money`, `Quantity`, `UnitOfUse` — no `string` ni `number`
- **El dinero nunca es `number` de punto flotante.** Se usa un tipo `Money` con aritmética decimal exacta, y `numeric` en la base
- Validación por esquema (Zod o equivalente) en **todo** límite externo: endpoints, archivos importados, variables de entorno
- **Toda validación que sea un control de seguridad va en el CAMPO, nunca en el refinamiento del objeto.** El refinamiento de objeto no se ejecuta si algún campo falló antes, así que un error de formato en otra variable desactiva la comprobación de autorización sin que nada avise. Y se prueba **acompañada de otro error**, no solo en aislamiento: el caso de un único fallo es el que siempre pasa. Ver `docs/incidencias/INC-008`

### YAGNI — no construir lo que no se pidió
El detalle completo está en `docs/OPTIMIZACION.md` §1 y es obligatorio. Resumen: sin abstracciones especulativas, sin parámetros que nadie usa, sin código muerto, sin endpoints ni columnas "para el futuro", sin utilidades genéricas antes de la tercera repetición, sin dependencias para 10 líneas. `audit:deadcode`, `audit:complexity` y `audit:duplication` lo verifican en cada commit.

### Errores
- Errores tipados de dominio · **nunca** capturar y silenciar · el mensaje al usuario y el detalle del log son cosas distintas

### Comentarios
- El código explica el *qué*; el comentario explica el *por qué* · **sin código comentado** en el repositorio

---

## 4. Seguridad — máxima estrictez

> Cualquier duda de seguridad se resuelve por la opción **más restrictiva**.
> **El estándar completo contra cada vector de ataque está en `docs/SEGURIDAD.md` y es de cumplimiento obligatorio en cada paquete.** Su tabla final (amenaza → defensa) es la referencia rápida.

### 4.1 Aislamiento multi-tenant — la regla que no se negocia

Tres barreras independientes. Si una falla, las otras dos siguen de pie.

**Barrera 1 — La base de datos. Es la única garantía real.**

- **`company_id` en toda tabla de negocio**, sin excepción
- **RLS deny-by-default**: la política se define antes de insertar la primera fila, no después
- **`FORCE ROW LEVEL SECURITY`** en cada tabla, para que la política aplique también al dueño de la tabla
- **La aplicación se conecta con un rol dedicado que NO es superusuario ni dueño de las tablas.** Un superusuario ignora RLS por diseño: si la app se conecta como tal, toda la defensa es decorativa
- Migraciones y aplicación usan **roles distintos**

> Esta barrera es la que convierte una fuga en imposible **aunque el código de aplicación falle**. Las otras dos dependen de disciplina de desarrollo; esta no.

**Barrera 2 — La capa de transacción-con-tenant.**

- RLS necesita fijar el tenant por transacción (`SET LOCAL` o `set_config(..., true)`); el ORM usa un pool donde eso **no es automático**
- Toda operación de datos pasa por un envoltorio único que abre transacción interactiva y fija el tenant **dentro de ella**
- **Prohibido usar el cliente de base de datos crudo fuera de esa capa**, verificado por `audit:forbidden`
- ⚠️ **Un `SET` fuera de transacción no persiste de forma fiable entre conexiones del pool.** Si el query corre en una conexión sin tenant fijado, hay fuga. Por eso el `SET LOCAL` va siempre dentro de la transacción que ejecuta la consulta, nunca antes
- ⚠️ **Con PgBouncer en modo transacción**: la recomendación cambió y está verificada en ADR-001. Prisma ya **no** recomienda `?pgbouncer=true` a partir de PgBouncer 1.21.0. Lo que sigue siendo obligatorio: PgBouncer en **modo transacción**, `max_prepared_statements > 0` (Prisma usa prepared statements), y una **conexión directa separada** para los comandos del CLI. **Probar este escenario explícitamente antes de producción**, no asumirlo — la documentación de Prisma sobre pooling externo está etiquetada como v7 y no hay equivalente para la línea 8

**Barrera 3 — El origen del tenant.**

- Ningún endpoint acepta `company_id` como parámetro de entrada. El tenant sale **siempre** de la sesión autenticada
- **Ninguna consulta mezcla ubicaciones.** El inventario de una ubicación jamás se suma con el de otra salvo en las vistas consolidadas explícitas, que agregan solo dentro de la misma company

### 4.2 Back office — acceso privilegiado

Decisión del usuario, con riesgo asumido y condiciones obligatorias:

- La conexión que puentea RLS vive **solo** en el proceso del back office, con **pool separado**, e **inalcanzable desde la aplicación cliente por cualquier ruta**
- Todo acceso cross-tenant se registra en un log **append-only**: usuario, company, motivo, timestamp, IP
- Existe una prueba automatizada que verifica que ningún módulo de la app cliente importa la conexión privilegiada

### 4.3 Los datos que NUNCA salen — confidencialidad de recetas

La receta es secreto de negocio del cliente. El rol `BODEGA` no debe poder reconstruirla.

**Ocultar la pantalla de recetas no basta.** Estos datos permiten despejar la receta por aritmética y el backend **no debe incluirlos en ninguna respuesta** a un usuario `BODEGA`:

| Dato prohibido para BODEGA | Por qué |
|---|---|
| Líneas de receta y cantidades | Es la receta misma |
| Consumo teórico por ítem | `consumo ÷ unidades vendidas` = cantidad de la receta |
| Stock teórico | `inicial + compras − consumo`; conoce inicial y compras, despeja el consumo |
| Diferencia teórico vs físico y su valorización | Contiene el stock teórico |
| Punto de reorden | Se calcula desde el consumo teórico |
| Costo de plato, margen, food cost | Derivados de la receta |

**El filtrado va en la API, no en el frontend.** Un campo que el backend devuelve y la UI esconde no es confidencial. Se implementa como proyecciones distintas por rol, no como filtro sobre una respuesta completa.

**Prueba obligatoria (🔴):** por cada endpoint que devuelva datos de inventario o costeo, un test que autentica como `BODEGA` y verifica sobre la **respuesta cruda** que ninguno de esos campos aparece.

BODEGA recibe para reposición un semáforo (`REPONER` / `OK`) **sin la cantidad que lo origina**.

### 4.4 IDOR y autorización
- Todo acceso por ID valida pertenencia a la company **y** a la ubicación cuando el rol es de ubicación
- La autorización se resuelve en el servidor. El frontend no decide permisos, solo los refleja
- Escalada probada por test: `BODEGA` no accede a recursos de `GERENTE_LOCAL`; `GERENTE_LOCAL` no accede a otra ubicación; ningún rol accede a otra company

### 4.5 Credenciales y sesiones
Argon2id · sesiones revocables · bloqueo progresivo por intentos · sin secretos en el repositorio · auditoría de accesos con IP y dispositivo (`docs/SEGURIDAD.md` §10)

### 4.6 Importaciones
Los archivos subidos son entrada no confiable: tipo verificado por magic bytes, límite de tamaño y de filas, parseo en proceso acotado, **previsualización antes de escribir** y escritura en una sola transacción reversible.

---

## 5. Base de datos — diseño y optimización

### Esquema
- Normalización hasta 3FN; desnormalizar solo con razón medida · claves foráneas declaradas · restricciones en la base (`NOT NULL`, `CHECK`, `UNIQUE`) · UUID (v7) como clave pública · **`numeric` para dinero y cantidades**, `timestamptz` para fechas · enums en tabla de catálogo, no en tipo nativo · migraciones versionadas y reversibles por CI · **sin borrado físico** en entidades auditables
- **El libro de inventario es append-only por diseño**: sin `UPDATE` ni `DELETE`. Un error se corrige con un movimiento de signo contrario, nunca editando el original

### Índices obligatorios

| Consulta | Índice |
|---|---|
| Todo filtro por tenant | Compuestos que **empiecen por `company_id`** |
| Movimientos de una ubicación en un rango de fechas | `(company_id, location_id, occurred_at)` |
| Saldo actual de un ítem en una ubicación | `(company_id, location_id, item_id, occurred_at)` |
| Precio de referencia vigente de un ítem | `(company_id, item_id, valid_from DESC)` |
| Receta vigente de un producto en una ubicación | `(company_id, product_id, location_id, valid_from DESC)` |
| Búsqueda difusa de ítems al importar (deduplicación) | GIN + `pg_trgm` sobre nombre normalizado |
| Artículos de compra de un ítem | `(company_id, item_id)` |
| Unicidad de código de producto por company | Único `(company_id, code)` |

Reglas: índices parciales cuando se consulta un subconjunto · igualdad antes que rango · **ningún índice sin consulta que lo justifique** · auditar `pg_stat_user_indexes` y borrar los no usados.

### Consultas — reglas duras
- **`EXPLAIN ANALYZE` obligatorio** en el camino crítico antes de mergear · **N+1 prohibido** · **nunca `SELECT *`** · **paginación por cursor, nunca `OFFSET`** · agregaciones y filtros en SQL, no en la aplicación · lotes en una sentencia · transacciones cortas sin llamadas externas dentro · vistas materializadas para métricas de período cerrado · pool de conexiones

### Observabilidad
- `pg_stat_statements` activado · registro de consultas lentas con alerta
- **Presupuesto de rendimiento (p95)**:
  - Costeo completo de un catálogo de 200 productos con 1.500 líneas de receta: **< 400 ms**
  - Vista de inventario de una ubicación con 500 ítems: **< 300 ms**
  - Consolidado de company con 10 ubicaciones: **< 800 ms**
  - Guardar una receta (incluye validación de ciclos): **< 150 ms**
- Probar con volumen sintético realista, **nunca con 20 filas**

---

## 6. Reglas de negocio que no se pueden romper

Cada una es verificable; la sección E de `docs/AUDITORIA.md` se deriva de aquí.

**R1 — Aislamiento absoluto entre companies.** Ninguna consulta se ejecuta sin tenant efectivo. RLS deny-by-default y capa de transacción-con-tenant obligatoria. *(desde P1)*

**R2 — El inventario nunca mezcla ubicaciones.** El saldo de un ítem existe por ubicación. Las vistas consolidadas agregan explícitamente y solo dentro de la misma company. *(desde P6)*

**R3 — El libro de inventario es append-only.** No existe campo de stock mutable. Todo saldo es proyección del libro. *(desde P6)*

**R4 — Base AP/EP.** `costo_linea = cantidad × (base = "EP" ? costo_neto : costo_bruto)`. Si la cantidad está en EP se aplica el rendimiento; si está en AP, no. *(desde P5)*

**R5 — Ningún precio se mueve solo.** Los precios de referencia se versionan por vigencia y solo pasan a vigentes cuando un usuario los confirma. Nunca sobrescritura. *(desde P3)*

**R6 — Suma de control.** Para todo producto: `margen_contribucion_pct + food_cost_pct = 1`. *(desde P5)*

**R7 — Conciliación de food cost.** `costo_ventas_teorico − costo_ventas_segun_costeo` redondeado a 2 decimales **debe dar exactamente 0**. Es prueba automatizada que corre en cada build. *(desde P8)*

**R8 — Confidencialidad de receta frente a BODEGA.** Los campos de §4.3 no salen del backend para ese rol, verificado sobre la respuesta cruda. *(desde P1, reforzado en P6 y P8)*

**R9 — Sin ciclos en recetas.** Una receta que se referencie a sí misma directa o indirectamente se rechaza **al guardar**, no al calcular. *(desde P4)*

**R10 — Costo estándar de la preparación.** El ítem `PRODUCIDO` se costea con su precio de referencia fijo, no con el costo del último lote. El costo real del lote se registra en el movimiento de producción y genera varianza. *(desde P6)*

**R11 — Propagación de receta controlada.** Requiere permiso de nivel company, previsualización con el listado de ubicaciones afectadas, y registro reversible de quién propagó qué y cuándo. *(desde P4)*

**R12 — La merma no se cobra dos veces.** El rendimiento por ítem absorbe la merma de limpieza; la provisión de merma no atribuible cubre **solo** lo que ningún rendimiento explica. *(desde P5)*

**R13 — IVA recuperable es configuración de la company**, no constante. Afecta el costo de ítems y empaques por igual. *(desde P3)*

**R14 — El PVP incluye IVA; el food cost se calcula sobre venta neta.** `venta_neta = pvp / (1 + iva_venta)`. *(desde P5)*

---

## 7. Pruebas

| Prioridad | Qué | Tipo |
|---|---|---|
| 🔴 | **Motor de costeo** — todas las fórmulas del SPEC | Unitarias, **sin base de datos** |
| 🔴 | **Aislamiento entre companies** — ningún dato cruza | Integración con dos tenants |
| 🔴 | **Aislamiento entre ubicaciones** — inventarios no se mezclan | Integración |
| 🔴 | **Confidencialidad frente a BODEGA** — campos prohibidos sobre respuesta cruda | Integración, por endpoint |
| 🔴 | **Conciliación R7 = 0** | Integración con dataset completo |
| 🔴 | **Base AP/EP** — ambos casos con resultados distintos y conocidos | Unitaria |
| 🟠 | Validación de ciclos en recetas (directo e indirecto) | Unitaria |
| 🟠 | Cascada de costo de subpreparaciones anidadas | Unitaria |
| 🟠 | Proyección del libro de inventario contra movimientos conocidos | Unitaria |
| 🟠 | Propagación de recetas y su reversión | Integración |
| 🟡 | Importación con duplicados y unidades mixtas | Integración |
| 🟡 | Cuadrantes de menu engineering en los bordes (índice exactamente 1) | Unitaria |

**Casos conocidos del dominio**: `docs/pruebas/casos-conocidos.md` mantiene entradas con el resultado esperado **calculado a mano desde el Excel original, antes de ejecutar el código**. Cada cambio del motor de costeo se corre contra todos. Un caso que cambia de resultado es un fallo hasta que se demuestre lo contrario.

**Nunca datos reales de clientes en desarrollo ni en staging.** Solo sintéticos.

Ninguna rama se fusiona con pruebas en rojo.

---

## 8. Cómo debe trabajar Claude Code

### Antes de escribir código
1. Lee `docs/SPEC.md` en la sección correspondiente. **Las fórmulas están ahí completas: no las derives de memoria ni las simplifiques**
2. Confirma en qué capa va cada pieza
3. Si algo del SPEC es ambiguo o contradictorio, **pregunta — no inventes**

### Ante cualquier error o comportamiento inesperado
1. **Busca el síntoma en `docs/incidencias/README.md` ANTES de investigar.** Si ya está resuelto, aplica la solución registrada en vez de diagnosticar de cero
2. Si no está y el diagnóstico cuesta tiempo, **regístralo al cerrar el paquete** según el criterio de ese archivo
3. Si un problema ya registrado vuelve a pasar, **sube el contador de recurrencias** en su ficha en vez de crear una nueva. Tres recurrencias significan que la prevención no se hizo, y hay que hacerla
4. **Una incidencia que se puede convertir en verificación de `npm run audit` o en una prueba, se convierte** — en el mismo paquete. Documentar un problema automatizable es aceptar que volverá

### Al escribir
- **Dominio → casos de uso → infraestructura.** Nunca al revés
- La prueba del dominio se escribe junto con el dominio
- Si una función supera 20 líneas o 3 niveles, refactoriza antes de seguir

### Prohibido sin autorización explícita
- Dependencias nuevas (justifícalas primero) · cambios de esquema sin migración versionada · `any`, `@ts-ignore`, `eslint-disable` · estilos literales en componentes (§10) · **usar el cliente de base de datos fuera de la capa de transacción-con-tenant** · **`UPDATE` o `DELETE` sobre el libro de inventario** · **punto flotante para dinero o cantidades** · **lógica de negocio en el frontend** · cualquier atajo que exponga datos protegidos

### Al terminar cada paquete
- Pruebas en verde · `EXPLAIN ANALYZE` de consultas nuevas · migración reversible · decisiones y dudas registradas

---

## 9. Decisiones abiertas — resueltas provisionalmente en `DECISIONES.md`

Usa los valores 🟡 sin preguntar; impleméntalos **siempre como configuración versionada**. Solo pregunta si la decisión no está en `DECISIONES.md` ni en el SPEC, o está marcada 🔴.

---

## 10. Frontend — funcional ahora, bonito después

> **El funcionamiento debe ser correcto y completo; la estética viene después.** La capa visual debe poder reemplazarse **sin tocar la lógica**.

### Regla de oro: cero estilos literales
**Prohibido escribir un color, tamaño, radio, sombra o fuente dentro de un componente.** Todo vive en `src/styles/tokens.css` mapeado en la config del framework de estilos. Valores iniciales neutros y sobrios.

### La marca: `docs/Manual de Marca/platise-brand-book.pdf`

**El manual de marca es la fuente única de la identidad visual.** Ningún color, tipografía, logo ni tratamiento gráfico se inventa, se "aproxima" ni se saca de otra referencia: sale del manual.

| | |
|---|---|
| **Dónde entra** | En `tokens.css` y en `components/ui`. **En ningún otro sitio** |
| **Cuándo** | En **P14**. Antes de P14 los tokens son neutros a propósito — es lo que prueba que la capa visual se reemplaza sin tocar lógica |
| **Cómo** | Leyendo el PDF. Si un valor no está en el manual, **pregunta**; no lo deduzcas del resto de la paleta |
| **Qué no cambia** | Hooks, servicios, dominio y `application`. El diff de P14 no los toca (criterio de aceptación de P14) |

⚠️ **Antes de P14, si una tarea pide "aplicar la marca" o "ponerlo bonito": detente y pregunta.** Adelantar la identidad visual invalida el criterio de aceptación de P14 y es una violación de §10, no un favor.

### Separación lógica / presentación
| Capa | Contiene | Se reemplaza después |
|---|---|---|
| Hooks y servicios | API, estado, validación | ❌ No se toca |
| Componentes de dominio | Composición y comportamiento | ⚠️ Mínimamente |
| Componentes de UI | Solo apariencia | ✅ Entero |
| Tokens | Colores, tipografía, espaciado | ✅ Entero |

### Reglas técnicas
- Los datos protegidos **nunca llegan al navegador** para ser ocultados con CSS — el backend no los incluye
- Validación en cliente **y** servidor (la del servidor manda) · estados de carga/error/vacío en toda vista · accesibilidad básica · sin `localStorage` para datos sensibles · Server Components por defecto

### Interfaces del proyecto

| Interfaz | Requisitos clave |
|---|---|
| **App cliente** | Usada por dueños, gerentes de local y bodegueros. La carga de conteo físico y de unidades vendidas se usa **de pie, en una cocina o bodega**: mobile-first real, objetivos táctiles grandes, tolerante a conexión mala |
| **Grilla de unidades vendidas** | Punto crítico de abandono. Grilla editable con el período anterior precargado, navegación por teclado, guardado incremental. **No un formulario por producto** |
| **Back office** | Interno. Escritorio. Sin requisitos estéticos, sí de trazabilidad: toda acción cross-tenant visible y registrada |

---

## 11. Documentación — árbol completo y obligatorio

El sistema se documenta **mientras se construye**. Estructura fija (plantillas en `docs/plantillas/`):

```
docs/
├── pasos/P{n}/            CONSTRUCCION.md + AUDITORIA-RESULTADO.md (sin este no hay commit)
├── apis/                  FUNCIONAMIENTO.md + un archivo por superficie
├── sistema/               FUNCIONAMIENTO.md (maestro, con Mermaid) · modelo-datos.md · seguridad.md · configuracion.md
├── decisiones/            ADRs numerados e inmutables
├── incidencias/           Problemas de construcción ya resueltos, buscables por síntoma
├── runbooks/              despliegue · respaldos · incidentes · rotación de secretos
├── pruebas/               ESTRATEGIA.md · casos-conocidos.md
└── CHANGELOG.md           una entrada por commit de paquete
```

> **`decisiones/` frente a `incidencias/`:** un ADR registra *por qué elegimos algo*; una incidencia registra *qué se rompió y cómo se arregló*. No se mezclan.
> **`incidencias/` frente a `runbooks/incidentes.md`:** las incidencias son problemas de construcción; el runbook es para incidentes operativos en producción.

Reglas: cada módulo/endpoint/migración se documenta **en el mismo commit** · diagramas en Mermaid dentro del markdown · ADR para toda decisión técnica relevante (ante la duda, escríbelo) · runbooks con comandos exactos, sin prosa · los `.md` son la fuente · la sección H de la auditoría lo verifica.

---

## 12. Servicios externos — siempre tras adaptador falso

**Todo servicio externo se implementa primero como fake** que cumple el puerto: correo transaccional, almacenamiento de archivos, y en el futuro cualquier fuente externa de precios. El real se activa por variable de entorno (`*_ADAPTER=fake|real`). **El sistema completo debe levantarse y probarse de punta a punta sin una sola credencial real.** Los fakes viven en `infrastructure/fakes/`, simulan latencia y errores, y son la base de las pruebas de integración.

> **Fuentes externas de precios (Tipti u otras): fuera de alcance.** El modelo de datos deja la puerta abierta con `origen = EXTERNO` en el precio de referencia, pero **no se implementa ninguna integración ni scraping en este proyecto**. Ver `DECISIONES.md` D8.

---

## 13. Verificación automatizada — `npm run audit`

Desde P0 existe `npm run audit` que **falla** ante cualquiera de estos, corre en CI y en pre-commit:

| Check | Qué detecta |
|---|---|
| `audit:types` | Compilación con modo estricto |
| `audit:lint` | Linting (incluye la prohibición de `any`) |
| `audit:forbidden` | `@ts-ignore`, `eslint-disable`, `: any`, `as any`, `SELECT *`, `.env` versionado, **cliente de BD fuera de la capa de tenant**, **`UPDATE`/`DELETE` sobre el libro de inventario** |
| `audit:arch` | Reglas de dependencia entre capas (dependency-cruiser) |
| `audit:deadcode` | Exports, archivos o dependencias sin uso (knip) |
| `audit:complexity` | Complejidad >10, profundidad >3, funciones >40 líneas |
| `audit:duplication` | Duplicación (jscpd). **Falla ante cualquier clon** de ≥50 tokens y ≥5 líneas; el 3 % queda como techo, no como permiso |
| `audit:tests` | Pruebas en rojo |
| `audit:secrets` | Secretos en el diff |

La checklist manual de `docs/AUDITORIA.md` cubre lo no automatizable. **Ambas son obligatorias antes de cada commit.**
