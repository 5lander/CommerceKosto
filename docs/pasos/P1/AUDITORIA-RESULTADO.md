# P1 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-09-04 | Claude Code | `P1: IAM · tenants · ubicaciones · roles` |

```
AUDITORÍA P1

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30  (24 aplican en P1; el resto documentado)
D. Base de datos     ✅ D1-D13
E. Reglas de negocio ✅ E1-E23  (R1 activa desde este paquete)
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 329 pruebas en verde
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

npm run audit        exit=0, doce checks
Pruebas              227 unitarias (base APAGADA) + 102 de integración
```

> **Criterio de esta auditoría.** Un punto marcado «— aún no aplica» lleva **por qué** y **desde qué paquete** aplica. Donde la evidencia es una prueba, se nombra el archivo; donde es una salida de herramienta, está en `evidencia/`.

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `dependency-cruiser`, 102 módulos, 312 dependencias, cero violaciones. `modules/iam/domain/` no importa nada de fuera de sí mismo |
| A2 | ✅ | `application-sin-framework` sigue en `error`. Los siete casos de uso de `iam` no importan NestJS ni Prisma: se construyen con `useFactory` desde el módulo |
| A3 | ✅ | Las reglas de negocio de este paquete están en `politica-de-intentos`, `politica-de-sesion`, `politica-de-contrasenas` y `politica-de-roles`, las cuatro en `domain` y las cuatro probadas sin base |
| A4 | ✅ | Todos los casos de uso reciben un **objeto de parámetros** por constructor (CLAUDE.md §3). `DependenciasDeIam` es lo único que conoce los tokens de inyección |
| A5 | — **aún no aplica** | `catalog` llega en P2 |
| A6 | ✅ | 227 pruebas unitarias con PostgreSQL apagado, `guardia-sin-base.ts` activo. Incluye el login **completo**, con seis dobles en memoria |

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B1–B3 | ✅ | `audit:lint` con `--no-inline-config`, cero avisos. Nombres en inglés en el código, español en textos visibles |
| B4 | ✅ | `audit:complexity` en verde: complejidad ≤10, profundidad ≤3, ≤3 parámetros, ≤40 líneas. El límite de 3 parámetros obligó a partir `AuthController` y `ContrasenaController`, y a sacar `RolesDeUsuario` a su propio archivo |
| B5 | ✅ | Salidas tempranas en los cuatro rechazos del login; ningún anidamiento de más de 3 |
| B6 | ✅ | `no-magic-numbers` activo. Cada umbral, ventana y escalón tiene nombre |
| B7 | ✅ | `audit:forbidden`: 26 reglas sobre 102 archivos. Cero `any`, cero `as unknown as`, cero `@ts-ignore` |
| B8 | ✅ | `CompanyId`, `LocationId`, `UserId` y **`SessionId`** son tipos marcados, validados al construir. Pasar uno donde va otro no compila |
| B9 | ✅ | Errores tipados de dominio con un `Record<CodigoDeDominio, HttpStatus>` **exhaustivo**: añadir un código sin mapearlo no compila |
| B10 | ✅ | El mensaje al usuario y el detalle del log son distintos: los cuatro motivos del login dan un texto idéntico y el motivo real solo va a `audit_log` |
| B11 | ✅ | Sin código comentado. `audit:forbidden` regla `no-marcador-pendiente` |
| B12 | ✅ | `audit:duplication`: **0 clones**. Encontró uno real —la preparación común de asignar y revocar rol— y se extrajo a `exigirCambioLegitimo` |

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1 | ✅ | `company_id` en las 7 tablas de negocio. Las 7 restantes son catálogos, más `login_attempt` con su razón escrita en la migración |
| C2 | ✅ | RLS `ENABLE` + `FORCE` en **las 14**. `audit:migrations` M6, lista de exentas vacía |
| C3 | ✅ | Deny-by-default: la política se crea en la misma migración que la tabla |
| C4 | ✅ | `costeo_app` no es superusuario, no es dueño, sin `BYPASSRLS`. `roles-de-base-de-datos.spec.ts`, 9 pruebas |
| C5 | ✅ | **Barrera 2**: `TenantTransaction` es el único archivo que toca el cliente crudo; `audit:forbidden` lo hace cumplir con 3 reglas |
| C6 | ✅ | **Barrera 3**: `SesionGuard` global, deny-by-default. `evidencia/guardian-strict-y-alcance.txt` |
| C7 | ✅ | Regla `no-sql-interpolado` **afinada**: distingue la plantilla etiquetada de Prisma y ya no necesita exenciones por archivo. Más `no-prisma-raw` para el único hueco que quedaba |
| C8 | ✅ | Ningún endpoint acepta `company_id`. Todos los DTO son `.strict()`; el guardián lo demuestra |
| C9 | — **no aplica** | No hay webhooks entrantes en el alcance (SEGURIDAD.md §6) |
| C10 | ✅ | Argon2id con parámetros explícitos (m=65536, t=3, p=1), hash ficticio para tiempo constante, `necesitaRehash` en cada login |
| C11 | ✅ | Sesiones revocables de verdad; el cierre marca `revoked_at` y la siguiente petición con el mismo token da 401 |
| C12 | — **aún no aplica** | El cifrado a nivel de campo protege líneas de receta y precios (SEGURIDAD.md §8): P3 y P4 |
| C13 | ✅ | Bloqueo progresivo por cuenta **y** por IP, con umbral distinto por eje. Razonado en ADR-006 |
| C14 | ✅ | Aviso por correo al titular en la **transición** al bloqueo, nunca en cada intento, y nunca si la cuenta no existe |
| C15 | ✅ | `no-sql-concatenado`: cero `queryRawUnsafe` |
| C16–C19 | ✅ | Cabeceras de SEGURIDAD.md §4.4, CSP con nonce por respuesta, CORS desactivado. 18 pruebas |
| C20 | ✅ | Limitador con **su propia prueba** por primera vez: `limitador.spec.ts` |
| C21 | ✅ | Timeout de petición, `statement_timeout` y `idle_in_transaction_session_timeout` fijados en el rol |
| C22 | ✅ | Sin secretos en el repositorio: `audit:secrets` en verde |
| C23 | ✅ | Auditoría con IP, user agent y `correlation_id`; 15 tipos de evento nuevos |
| C24 | ✅ | Escalada vertical y horizontal probadas: `GERENTE_LOCAL` recibe 403 al crear y solo ve su ubicación |
| C25 | ✅ | Un usuario de otra company da 404, no 204 en silencio |
| C26 | ✅ | `audit:deps`: cuatro avisos aceptados uno a uno con motivo y fecha de revisión, todos por el CLI de Prisma y ninguno en la imagen de producción. ADR-006 |
| C27–C30 | ✅ | Cookie `HttpOnly + SameSite=Strict + Secure`, rotación al iniciar sesión, revocación total al cambiar contraseña, contraseñas contra lista local de filtradas |

**Lo que C1–C30 no cubre y este paquete sí cerró:** la cuarta condición de D12. Ver `evidencia/guardian-pgbouncer-fuga-de-tenant.txt`.

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | Migración reversible; `migrate:verify` en verde con sus cuatro pasos |
| D2 | ✅ | 3FN. Los enums van en tabla de catálogo (D5) |
| D3 | ✅ | Claves foráneas declaradas, incluida una **compuesta** que hace imposible asignar un rol de ubicación sin ubicación |
| D4 | ✅ | `NOT NULL`, `CHECK` y `UNIQUE` en la base, no en un `if` |
| D5 | ✅ | UUID v7 por `uuidv7()` nativo de PostgreSQL 18 |
| D6 | ✅ | `timestamptz` en todas las fechas |
| D7 | ✅ | Índices compuestos que **empiezan por `company_id`** |
| D8 | ✅ | Sin borrado físico de entidades auditables: se marcan `CLOSED` / `INACTIVE` / `SUSPENDED`. La aplicación no tiene `DELETE` sobre `company`, `location` ni `app_user` |
| D9 | ✅ | `audit:migrations`, 10 comprobaciones. **M10 es nueva** y nació de INC-011 |
| D10 | ✅ | Sin `SELECT *`; las tres funciones enumeran sus columnas |
| D11 | ✅ | Sin N+1: `session_lookup` resuelve el contexto entero en una llamada |
| D12 | ✅ | El límite de ubicaciones se resuelve con `SELECT ... FOR UPDATE` dentro de la transacción que inserta, no con un `count` y un `if` |
| D13 | ✅ | Transacciones cortas, sin llamadas externas dentro |

**`EXPLAIN ANALYZE`.** Las consultas de P1 son de autenticación y autorización, todas por índice único o por clave primaria, sobre volúmenes de decenas de filas. El presupuesto de rendimiento de CLAUDE.md §5 se refiere a costeo e inventario y **empieza a medirse en P5**, cuando exista volumen sintético realista. Medir contra veinte filas es lo que CLAUDE.md §5 prohíbe explícitamente.

---

## E. Reglas de negocio

| # | Resultado | Evidencia |
|---|---|---|
| **E1 (R1)** | ✅ **activa** | `aislamiento-entre-companies.spec.ts` (22) + `pgbouncer.spec.ts` (6) + `autenticacion-y-autorizacion.spec.ts` (25) |
| E2–E7 | — **aún no aplica** | R2, R3 desde P6; R4, R6 desde P5; R5 desde P3 |
| **E12** | ✅ **patrón instalado** | La confidencialidad frente a `BODEGA` se comprueba sobre la **respuesta cruda**. En P1 el patrón está montado con `ListarUbicaciones`; los campos prohibidos de CLAUDE.md §4.3 llegan en P6 y P8 |
| E18 | ✅ | Un `GERENTE_LOCAL` recibe 403 al crear una ubicación |
| E22 | ✅ | Sin punto flotante para dinero: `no-decimal-literal-en-dominio` |
| E23 | ✅ | Dos `ADMIN` coexisten; ninguno puede tocar los roles del `OWNER` |

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | 329 en verde: 227 unitarias + 102 de integración |
| G2 | ✅ | Las 227 unitarias corren con la base **apagada** |
| G3 | ✅ | Aislamiento entre companies: dos tenants, «ni pasando su ID», cero filas sin envoltorio |
| G4 | ✅ | Escalada vertical y horizontal |
| G5 | ✅ | **Prueba del guardián**: tres sabotajes deliberados, con su salida capturada en `evidencia/` |
| G6 | ✅ | Ninguna prueba de seguridad se salta a sí misma. `pgbouncer.spec.ts` **falla** si no hay pooler, en vez de omitirse |
| G7 | ✅ | Cero datos reales de clientes. Todo sintético, con sufijo aleatorio por corrida |

### La prueba del guardián — tres sabotajes, tres salidas

| # | Defensa | Sabotaje | Salida |
|---|---|---|---|
| 1 | `audit:migrations` M10 | Un `DELETE FROM "audit_event_type"` en un `down.sql` que no elimina la tabla | `evidencia/guardian-migrations-m10.txt` |
| 2 | Barrera 2 bajo PgBouncer | `set_config(..., FALSE)` en vez de `TRUE` | `evidencia/guardian-pgbouncer-fuga-de-tenant.txt` |
| 3 | `.strict()` y alcance por ubicación | Quitar `.strict()` del login; `ListarUbicaciones` ignora `sesion.alcance` | `evidencia/guardian-strict-y-alcance.txt` |

El nº 2 es el más instructivo: la salida muestra la fila `Local de pool-A-…` llegando a un cliente que **no había fijado ningún tenant**. Y al deshacer el sabotaje la prueba seguía fallando hasta reiniciar PgBouncer: el tenant filtrado vivía en la conexión que el pooler guarda, y sobrevivió al reinicio del proceso entero.

---

## H. Documentación

| # | Resultado | Evidencia |
|---|---|---|
| H1 | ✅ | Este documento y `CONSTRUCCION.md` |
| H2 | ✅ | **ADR-006** — las tres barreras, las cuatro condiciones de D12, las decisiones de sesión y la excepción de `audit:deps` |
| H3 | ✅ | **INC-011** nueva; **INC-007** sube a 7 recurrencias |
| H4 | ✅ | Modelo de datos, seguridad y configuración actualizados |
| H5 | ✅ | Superficie de API documentada en `CONSTRUCCION.md` y en `docs/apis/app-cliente.md` |
| H6 | ✅ | `CHANGELOG.md` con una entrada por paquete |
| H7 | ✅ | `ESTADO.md` actualizado al cerrar |
| H8–H14 | ✅ | Cada decisión documentada donde vive el código que la aplica |

---

## I. Optimización

| # | Resultado | Evidencia |
|---|---|---|
| I1 | ✅ | Sin abstracciones especulativas: se retiró `ConflictoError` porque nadie lo usaba, y con él su código de dominio |
| I2 | ✅ | `audit:deadcode` en verde |
| I3 | ✅ | Cero dependencias nuevas fuera de la lista autorizada. La cookie se parsea a mano en quince líneas |
| I4 | ✅ | `session_lookup` resuelve el contexto en una llamada; `last_seen_at` se refresca como mucho cada 5 min |
| I5 | ✅ | `parallelism: 1` en Argon2: cuatro hilos por login saturarían el pool de libuv |
| I6 | ✅ | `createMany` / `updateMany` donde no hace falta `RETURNING` |
| I7–I10 | ✅ | Transacciones cortas; sin llamadas externas dentro; el correo se envía fuera de la transacción |

---

## Veredicto

**P1 cierra.** Las cuatro condiciones de D12 están verificadas, incluida la que podía obligar a reabrir la elección de ORM. El aislamiento no depende de que nadie se equivoque.

**Dos cosas que el usuario debería mirar** antes de dar por buena la decisión, porque son suyas y no mías:

1. **Umbral por IP en 25 en vez de 5.** Es un apartamiento razonado de la lectura literal de SEGURIDAD.md §2.1, tomado para no dejar fuera a un restaurante entero detrás de un NAT. Reversible: dos constantes.
2. **Refresh rotativo aplazado a P12**, con el riesgo residual escrito en ADR-006: un token robado sirve hasta 4 h de inactividad o 12 h absolutas, salvo revocación.
