# CHANGELOG

Una entrada por commit de paquete. Formato: `## P{n} — {nombre}` con fecha, qué se entregó y qué quedó pendiente.

---

## P1 — IAM · tenants · ubicaciones · roles · 2026-09-04

**Objetivo:** que el aislamiento funcione antes de que exista un dato de negocio.

### Entregado

- **Las tres barreras de CLAUDE.md §4.1, completas y probadas.** 14 tablas con RLS `ENABLE` + `FORCE` y 29 políticas; un envoltorio único de transacción-con-tenant; el tenant saliendo de la sesión y de ningún otro sitio
- **Login completo** — política anti fuerza bruta con dos ventanas y umbral distinto por eje, Argon2id con tiempo constante frente a correos inexistentes, sesión con token opaco de 256 bits hasheado en base, rotación al iniciar y revocación total al cambiar contraseña
- **Autorización deny-by-default** — guard global, capacidades en vez de roles rígidos, escalada vertical y horizontal probadas
- **Ubicaciones, invitación de usuario y asignación de roles**, con el límite del plan resuelto dentro de la transacción que inserta
- **Invitación de punta a punta sin una sola credencial real**, usando el adaptador falso de correo que P0 dejó cableado
- **`audit:deps`**, el duodécimo check: acepta avisos uno a uno con motivo y fecha de revisión, y rompe ante cualquiera que no esté en la lista
- **ADR-006** · **INC-010** e **INC-011** · modelo de datos, seguridad, configuración y superficie de API actualizados

### D12 cerrada del todo

**Las cuatro condiciones verificadas**, incluida la que podía obligar a reabrir la elección de ORM: PgBouncer 1.25.2 en modo transacción, con `default_pool_size = 1` para que la reutilización de conexión entre clientes sea segura y no probable. Detalle en ADR-006.

### Lo que se descubrió por el camino

**El repositorio de auditoría de P0 no había funcionado nunca** ([INC-010](incidencias/INC-010-returning-bajo-rls-exige-politica-de-select.md)). `create()` de Prisma emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` pasa por la política de `SELECT`. Se descubrió al escribirle su primera prueba de integración: **un repositorio sin prueba de integración no está verificado**, por evidente que parezca su código.

**Un `down.sql` que `migrate:verify` daba por bueno fallaba en la base real** ([INC-011](incidencias/INC-011-el-down-solo-se-probaba-en-base-vacia.md)), porque `migrate:verify` corre sobre bases **limpias** donde ninguna fila referencia nada. Y la guarda `NOT EXISTS` que se añadió para arreglarlo tampoco servía: bajo RLS, «no hay filas» y «no puedo verlas» son la misma respuesta. Prevención: comprobación **M10**.

**M10 entró en verde sin medir nada** — séptima recurrencia de [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md), cazada por la prueba del guardián en el mismo minuto.

**El limitador de peticiones no tenía ninguna prueba**, y P0 ya lo listaba como pendiente. Ahora la tiene — y hubo que escribirla dos veces, porque el primer intento acabó midiendo el **otro** mecanismo que devuelve 429: el bloqueo por fuerza bruta.

**El bloqueo por IP habría dejado fuera a restaurantes enteros.** Aplicando literalmente el umbral de SEGURIDAD.md §2.1 a los dos ejes, cinco errores repartidos entre cinco empleados detrás del mismo NAT bloquean el local completo durante una hora. Se separó: 5 por cuenta, 25 por IP.

También se **afinó** `no-sql-interpolado` en la dirección estricta: ahora distingue la plantilla etiquetada de Prisma —la forma segura, que antes marcaba— y **la única exención por archivo del repositorio desapareció**. Más `no-prisma-raw` para el único hueco que quedaba.

### Pendiente

| Qué | Cuándo |
|---|---|
| Refresh rotativo con detección de reuso (SEGURIDAD.md §2.2) | P12, cuando exista el cliente que pueda rotarlo |
| Limitador en memoria → Redis | P15 |
| Excepción `enmiendasAutorizadas` de `sin-migracion-commiteada-modificada` | P2 |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado; la puerta está cerrada |
| `EXPLAIN ANALYZE` con volumen sintético realista | P5 |

**329 pruebas en verde** · 227 unitarias con la base apagada, 102 de integración.

---

## P0 — Fundación del repositorio · 2026-08-27

**Objetivo:** que escribir código malo sea difícil. P0 no implementa negocio: implementa las condiciones para que el negocio se escriba bien.

### Entregado

- **`npm run audit` con once verificaciones**, en CI y en pre-commit: tipos, lint, prohibiciones, capas, código muerto, complejidad, duplicación, migraciones, secretos, cabeceras de seguridad y pruebas
- **Tipos de dominio para dinero y cantidades** — `Money`, `Ratio`, `Count`, `Quantity` y `UnidadDeUso`, con marca nominal, `valueOf()` que lanza y API de comparación completa. 98 pruebas
- **Mini-conciliación R7** con tres productos reales del Excel de referencia. `ROUND(diff, 2) = 0.00`, con canario a `1e-6`
- **PostgreSQL 18.6 fijado por digest**, con dos roles separados: `costeo_migrator` (dueño) y `costeo_app` (sujeto a RLS, no superusuario). Verificado por 9 pruebas contra la base real
- **Migraciones reversibles** con `down.sql` generado y verificado por una escalera de cuatro pasos sobre bases reales
- **`audit_log` append-only en tres capas**, con RLS deny-by-default. 14 pruebas
- **Aplicación NestJS** — entorno validado por Zod, `correlation_id` por `AsyncLocalStorage`, `/health` y `/ready` separadas, cabeceras de SEGURIDAD.md §4.4 con nonce por respuesta, limitador, timeout, formato único de error y falsos de correo y almacenamiento
- **CI en GitHub Actions** con acciones fijadas por SHA, que levanta el stack completo y comprueba que responde **sin una sola credencial real**
- **ADR-001 a ADR-005** · **INC-001 a INC-009** · documentación de sistema, modelo de datos, configuración y despliegue

### Decisiones que cierran preguntas abiertas

- **D2 cerrada** (ADR-001): Node 24.20.0, PostgreSQL 18.6, NestJS 11.2.3, Prisma 7.10.0, Next.js 16.3.3, con sus fechas de fin de soporte verificadas en fuente oficial
- **D12 cerrada** (ADR-002): se mantiene Prisma. El RLS nativo existe solo en Prisma 8 RC y cubre la Barrera 1, **no la Barrera 2**

### Lo que se descubrió por el camino

**Seis checks pasaban en verde sin medir nada** — un parser ausente, un fixture en ruta excluida, un glob que dejaba fuera las pruebas, unos patrones de ignorar mal anclados, una clave de configuración que la herramienta ignora, y un guardián que solo cubría dos de las tres formas de abrir una conexión. Cuatro de los seis los encontró la prueba del guardián. Registrado en [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md).

**Una regla de seguridad fallaba abierto**: la comprobación de que `DATABASE_URL` usa el rol de la aplicación no se ejecutaba si otra variable era inválida. [INC-008](incidencias/INC-008-superrefine-no-corre-si-otro-campo-fallo.md), y la regla general está ahora en `CLAUDE.md` §3.

### Pendiente

| Qué | Cuándo |
|---|---|
| Prueba del limitador de peticiones — hoy no protege ninguna ruta | P1 |
| Barreras 2 y 3 del aislamiento | P1 |
| `CompanyId`, `LocationId`, `ItemId`, `ProductId` | P1–P4 |
| `UnitCost` | P3 |
| CC-004 (base AP frente a EP) — no se pudo extraer del Excel: las 293 líneas de T3 están todas en base EP | P5 |
| Generador `prisma-client-js` → `prisma-client` | Con la evaluación de Prisma 8 |
| Salto a Node 26 | Promueve a LTS el 2026-10-28 |

**174 pruebas en verde** · 128 unitarias con la base apagada, 46 de integración.
