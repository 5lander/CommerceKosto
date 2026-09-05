# Incidencias de desarrollo — índice

> **Qué es esto.** El registro de problemas que ya costaron tiempo resolver una vez, para que no vuelvan a costarlo.
> **Qué NO es.** No es `docs/runbooks/incidentes.md`, que trata incidentes operativos en producción. Aquí van los problemas de construcción: errores de build, migraciones que fallan, tipos que no cuadran, pruebas que se rompen sin razón aparente.

## Cómo se usa

**Al empezar cualquier diagnóstico**, antes de investigar: buscá el síntoma en la tabla de abajo. Si está, seguí la solución registrada. Si el mensaje de error se parece pero no es idéntico, abrí igual la incidencia: la causa raíz suele ser la misma.

**Al resolver un problema que costó tiempo**, registralo. Copiá `docs/plantillas/INCIDENCIA.md` a `INC-{NNN}-{slug}.md`, llenala y añadí la fila al índice.

**Si un problema ya registrado vuelve a pasar**, no crees una incidencia nueva: subí el contador de recurrencias en la existente y agregá lo que aprendiste. Una incidencia con tres recurrencias es una señal de que la prevención no se hizo.

## Qué merece registrarse

Solo esto. El objetivo es un índice que se pueda leer entero en dos minutos; si se llena de ruido, nadie lo consulta y deja de servir.

| Sí | No |
|---|---|
| Costó más de ~20 minutos diagnosticar | Un typo o un import olvidado |
| La causa no era evidente desde el mensaje de error | Un error cuyo mensaje decía exactamente qué hacer |
| El mensaje de error apuntaba al lugar equivocado | Algo que ya está cubierto por `npm run audit` |
| Ya pasó dos veces | Una decisión de diseño (eso es un **ADR**) |
| Hubo que buscar fuera del proyecto para resolverlo | Un requisito nuevo (eso es el **SPEC**) |
| Involucró comportamiento raro de una herramienta o del pool de conexiones | |

## Regla de oro

**Una incidencia que se puede convertir en verificación automática, se convierte.** Documentar un problema que `npm run audit` podría detectar es aceptar que va a volver a pasar. La sección "Prevención" de la plantilla no es opcional.

---

## Índice

Ordenado por área. **Buscá por síntoma, no por causa.**

| # | Síntoma | Área | Paquete | Recurrencias |
|---|---|---|---|---|
| [INC-001](INC-001-hook-pre-commit-bad-interpreter.md) | `bad interpreter: /bin/sh^M` — el hook de pre-commit no se ejecuta, o el contenedor de Postgres no arranca | build · despliegue | P0 | 0 |
| [INC-002](INC-002-psql-no-esta-en-el-path.md) | `psql: command not found` al correr los scripts de migración | base de datos | P0 | 0 |
| [INC-003](INC-003-binarios-win32-dentro-del-contenedor.md) | `Cannot find module '@swc/core-linux-x64-gnu'` / `Failed to load native binding` dentro del contenedor | despliegue · build | P0 | 0 |
| [INC-004](INC-004-migrate-diff-genera-down-vacio.md) | `prisma migrate diff` produce un `down.sql` vacío, o falla con `unexpected argument` | base de datos | P0 | 0 |
| [INC-005](INC-005-postgres-18-cambia-el-directorio-de-datos.md) | El contenedor de PostgreSQL 18 queda `unhealthy`: «there appears to be PostgreSQL data in /var/lib/postgresql/data (unused mount/volume)» | despliegue · base de datos | P0 | 1 |
| [INC-006](INC-006-spawn-en-windows-parte-los-argumentos.md) | `psql` recibe el SQL partido: «syntax error at end of input / LINE 1: DROP». O un proceso hijo falla con `stderr` vacío, o devuelve una salida vacía | build · base de datos | P0 | **2** |
| [INC-007](INC-007-un-check-pasa-en-verde-sin-medir-nada.md) | **No hay mensaje de error**: un check de `npm run audit` imprime su línea de éxito sin haber examinado ni un archivo. O falla, pero en menos sitios de los que debería | build | P0 | **9** |
| [INC-008](INC-008-superrefine-no-corre-si-otro-campo-fallo.md) | Una regla de seguridad del esquema de entorno desaparece del informe cuando otra variable también es inválida | arquitectura | P0 | 1 |
| [INC-009](INC-009-psql-c-no-sustituye-variables.md) | `syntax error at or near ":"` en un SQL correcto, con la variable de psql sin sustituir | base de datos | P0 | 1 |
| [INC-010](INC-010-returning-bajo-rls-exige-politica-de-select.md) | `new row violates row-level security policy` en un INSERT que la politica SI permite | base de datos | P1 | 1 |
| [INC-011](INC-011-el-down-solo-se-probaba-en-base-vacia.md) | `violates RESTRICT setting of foreign key constraint` al revertir una migración que `migrate:verify` daba por buena | base de datos | P1 | 1 |
| [INC-012](INC-012-la-base-rechaza-y-el-dominio-no-explica.md) | Una petición con datos incoherentes devuelve **500 `INTERNAL_ERROR`** en vez de 400, y en el log hay un `23514` o un `P0001` de PostgreSQL | arquitectura · base de datos | P5 | **2** |
| [INC-013](INC-013-un-instante-utc-del-dia-1-es-del-mes-anterior.md) | Un movimiento del **día 1** se rechaza por un período que nadie cerró, o el importe de un mes aparece sumado al anterior | base de datos · pruebas | P7 | 0 |

Las cuatro primeras se registraron **antes de que ocurrieran**, en la fase PLAN de P0: son trampas conocidas de este entorno (Windows + Docker + Prisma 7) que iban a costar tiempo la primera vez. De la quinta en adelante ocurrieron de verdad, al levantar la base, al escribir los scripts de migración y al construir el tooling. Las diez tienen su prevención automatizada en el mismo paquete, como exige la regla de oro.

**INC-013 es de otra clase: no es un fallo del código sino del modelo mental de quien escribe una fecha.** Apareció escribiendo una prueba del propio P7, que es la mejor señal de que va a volver a aparecer cargando datos reales en P10.

**INC-007 e INC-008 no son problemas de una herramienta concreta, sino de cómo se verifica.** INC-007 es la razón por la que la prueba del guardián es criterio de commit; INC-008 es la razón por la que una validación de seguridad va en el campo y se prueba acompañada de otro error. Merecen leerse aunque no se esté diagnosticando nada.

---

## Áreas frecuentes en este proyecto

Dónde es más probable que aparezcan las próximas, según las decisiones ya tomadas. Las filas con ficha ya materializaron al menos una vez.

| Área | Por qué es probable | Fichas |
|---|---|---|
| **RLS y contexto de tenant** | El `SET LOCAL` fuera de transacción no persiste entre conexiones del pool. Y el reverso: una política de `SELECT` restrictiva rompe el `RETURNING` de un `INSERT` que sí estaba permitido | **INC-010** |
| **PgBouncer en modo transacción** | Prepared statements de Prisma, y sobre todo estado de sesión que sobrevive a la transacción. ⚠️ `?pgbouncer=true` ya **no** se recomienda desde PgBouncer 1.21.0 (ver ADR-001) | *(sin ficha: P1 lo cubrió con `pgbouncer.spec.ts` antes de que ocurriera)* |
| **`down.sql` sobre una base con datos** | `migrate:verify` corre sobre bases **limpias**, donde ninguna fila referencia nada. Todo lo que dependa de datos existentes —claves foráneas `RESTRICT`, guardas `NOT EXISTS`— pasa ahí y falla en la base real | **INC-011** |
| **Migraciones reversibles** | Un `down` que no deshace realmente lo que hizo el `up`. Agravado porque Prisma no genera migraciones de bajada | **INC-004** |
| **Reglas de capa** | `dependency-cruiser` rompiendo el build por un import que parecía inocente | *(esperada en P2)* |
| **Aritmética decimal** | Un `number` que se cuela en un cálculo de dinero y produce un centavo de diferencia en la conciliación. La configuración de `decimal.js` es **global y mutable**: un `Decimal.set()` en cualquier módulo mueve los resultados de todo el proceso | *(esperada en P5)* |
| **Cascada de subpreparaciones** | Orden topológico y memorización. Síntoma: costo que cambia entre dos corridas idénticas | *(esperada en P5)* |
| **Entorno Windows** | Finales de línea, ejecutables ausentes del PATH, binarios nativos por plataforma, argumentos que se parten al lanzar procesos | **INC-001**, **INC-002**, **INC-003**, **INC-006** |
| **Invocación de `psql`** | La forma de pasarle el SQL cambia lo que hace con él: `-c` no sustituye variables, stdin sí. El error lo da el servidor y apunta al SQL, no a la invocación | **INC-009** |
| **Convenciones de las imágenes de contenedor** | Cambian entre versiones mayores y los mensajes de error describen el escenario peligroso, no el real | **INC-005** |
| **El propio tooling de auditoría** | Un glob, un `exclude` o un parser ausente dejan un check sin nada que examinar, y el síntoma es un verde. Vuelve cada vez que se amplía el alcance: workspace nuevo, carpeta nueva, regla nueva. Y con el caso 8, un síntoma más: **falla, pero en menos sitios de los que debería** — el caso 9 lo confirmó destapando dos reglas que llevaban desde P0 sin examinar una sola migración | **INC-007** |
| **Restricciones de la base sin guarda de dominio** | Un `CHECK` o un trigger hace su trabajo y su error sale como 500 porque nadie lo tradujo. **La predicción de P6 acertó:** P7 tiene cuatro restricciones 🔴, y tres son triggers que una petición corriente alcanza —cerrar el mes y seguir comprando es lo que va a pasar todos los meses—. Ninguna llegó a producir un 500 porque M11 paró la migración antes del primer endpoint; el guardián 2 de P7 enseña qué habría salido sin las guardas. Falta P10 (importación) | **INC-012** · `docs/sistema/guardas-de-dominio.md` |
| **Una formula del Excel traducida de mas o de menos** | El Excel no tiene periodos ni movimientos de consumo, y sus mermas se capturan en positivo. Cada formula que se trae hay que traducirla, y las tres traducciones de P8 —el signo, el doble conteo del consumo, y la receta por lote frente a la venta por porcion— producen numeros **plausibles** si se hacen mal. **La que lo caza es R7**, y solo con un caso donde los dos caminos no coincidan por accidente | *(sin ficha: ADR-011 lo razona; la prevencion es la prueba de R7 con rendimiento distinto de 1)* |
| **Instantes frente a fechas** | `occurred_at` es un instante absoluto y el mes al que pertenece depende de la zona horaria. Las cinco primeras horas UTC de cada día 1 son del mes anterior en Ecuador. Reaparecerá en P10, cargando fechas de un Excel que no las lleva con hora | **INC-013** |
| **Esquemas de validación de entrada** | La regla barata de formato hace sombra a la regla cara de autorización: si un campo falla, los refinamientos de objeto no llegan a correr. Reaparecerá en los DTO de P1 y en la importación de P10 | **INC-008** |
