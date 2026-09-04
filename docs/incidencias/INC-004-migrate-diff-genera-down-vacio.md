# INC-004 — `prisma migrate diff` genera un `down.sql` vacío o falla por flags inexistentes

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | base de datos |
| **Tiempo perdido** | 0 min — **anticipada en la fase PLAN** |
| **Recurrencias** | 0 |

## Síntoma

Dos caras del mismo problema. La ruidosa:

```
error: unexpected argument '--from-url' found
```

o

```
error: unexpected argument '--from-schema-datamodel' found
```

Y la **peligrosa, que es silenciosa**: el comando termina con éxito y produce un `down.sql` de cero bytes, o con solo comentarios. La migración se commitea con un `down` que no deshace nada, y no se descubre hasta el día que alguien intenta revertir en producción.

## Contexto

Generación del `down.sql` de una migración nueva. **Prisma Migrate no genera migraciones de bajada**, así que hay que construirlas con `prisma migrate diff` recorriendo el camino al revés: del esquema nuevo al estado que las migraciones existentes ya describen.

El proyecto usa **Prisma 7.10.0** (ver ADR-001). La documentación y los ejemplos que circulan mayoritariamente son de Prisma 5 y 6, donde los flags se llamaban distinto.

## Causa raíz

Dos causas independientes que producen el mismo archivo inútil.

**1. Los flags cambiaron entre majors.** Prisma 7 introdujo `prisma.config.ts` y retiró los flags que recibían URLs sueltas. Lo que era `--from-url` / `--to-url` / `--from-schema-datamodel` pasó a resolverse desde la configuración. Copiar un comando de un artículo de 2024 produce el error de argumento — que al menos es ruidoso.

**2. El orden de las operaciones.** El `diff` tiene que ejecutarse **antes** de crear la carpeta de la migración de subida, cuando `prisma/migrations/` todavía contiene solo lo viejo. Si se ejecuta después, el estado de origen y el de destino ya son idénticos y el diff es, correctamente, **vacío**. Esta es la variante silenciosa, y es la que de verdad hace daño.

Hay un tercer factor que agrava: `costeo_migrator` es `NOCREATEDB`, así que Prisma no puede crear la base sombra al vuelo. Sin una `costeo_shadow` precreada, el `diff` falla o cae a un camino distinto del esperado.

## Solución

**Confirmar los nombres exactos de los flags contra la documentación de la versión fijada (7.10.0) antes de escribir el script**, no contra la memoria ni contra artículos. Con `prisma migrate diff --help` de la versión instalada, no de otra.

El orden correcto en `scripts/migrate-new.ts`, que es la parte que no se puede improvisar:

```
1. Verificar que no haya migraciones pendientes de aplicar
2. migrate diff  →  .tmp/down.sql        ← ANTES de crear la migración de subida
3. prisma migrate dev --name <slug> --create-only
4. mover .tmp/down.sql a la carpeta recién creada
5. insertar los marcadores de bloque manual en ambos archivos
6. añadir al final de down.sql el DELETE de su propia fila de _prisma_migrations
7. prisma migrate dev   (aplicar)
8. npm run migrate:verify -- --only <dir>
```

Se prefiere `--to-migrations` (el directorio de migraciones) sobre apuntar a la base de datos de desarrollo: **no depende del estado de la máquina de nadie**, así que el mismo `down.sql` se reproduce en CI y en cualquier equipo. Esa es la diferencia entre un artefacto revisable y uno que depende de qué tenía cada quien en su Docker.

El paso 6 se aparta de la receta oficial a propósito: Prisma sugiere `migrate resolve --rolled-back`, pero **ese comando solo acepta migraciones en estado fallido**; sobre una migración aplicada con éxito devuelve error. Como aquí se revierten migraciones exitosas, la fila del historial se borra desde el propio `down.sql`, que además lo deja autocontenido y atómico junto al DDL.

## Qué NO era

- **No era que la migración no tuviera cambios que revertir.** El `diff` vacío venía de comparar el esquema contra sí mismo.
- **No era un problema de permisos del rol de migraciones**, aunque `NOCREATEDB` sí exige precrear `costeo_shadow`.
- **No se resuelve escribiendo el `down.sql` a mano.** Se puede para una tabla, pero no escala a `ALTER` compuestos, y el objetivo es que la reversibilidad sea mecánica y verificada, no artesanal.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí, y es la prevención principal.** `audit:migrations` verifica que cada migración tenga un `down.sql` **no vacío** (M1), que los bloques manuales tengan su espejo (M2), que cada `CREATE POLICY` tenga su `DROP` (M3), que cada `ENABLE`/`FORCE ROW LEVEL SECURITY` tenga su reverso (M4), y que el `down.sql` termine con el `DELETE` de su propia fila (M9).
- [x] ¿Se puede convertir en una prueba automatizada? **Sí, y es la que atrapa el `down` "casi correcto".** `npm run migrate:verify` ejecuta la escalera completa contra bases limpias: base recién inicializada **==** después del `down` de todas · ida **==** `up → down → up` · y `migrate diff --exit-code` contra `schema.prisma` para detectar deriva. Corre en CI en cada PR que toque `prisma/`.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? Ya está: §5 exige migraciones versionadas y reversibles, y `AUDITORIA.md` D1 lo verifica.
- [x] ¿Es una decisión que merece un ADR? **Sí** — el mecanismo completo está en el ADR de migraciones reversibles.

## Referencias

- Referencia del CLI de Prisma, comando `migrate diff` — **consultar siempre la de la versión fijada en ADR-001**, no la de `latest`
- Guía oficial *"Generating down migrations"* — consultada 2026-08-27
