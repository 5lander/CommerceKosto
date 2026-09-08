# P11 — Resultado de la auditoría

**Fecha:** 2026-09-08 · **Paquete:** P11 — Back office
**Veredicto:** los doce checks en verde. `npm run audit` termina con código **0**.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api`, `tools` y `apps/web`, modo estricto máximo |
| `audit:lint` | ✅ | `eslint . --max-warnings=0 --no-inline-config` |
| `audit:forbidden` | ✅ | **34 reglas sobre 343 archivos** (eran 31 sobre 319 en P15) |
| `audit:arch` | ✅ | 289 módulos, 1279 dependencias, sin violaciones. **2 reglas nuevas** |
| `audit:deadcode` | ✅ | knip, sin lista blanca. `src/backoffice.ts` declarado como entrada |
| `audit:complexity` | ✅ | ≤10 de complejidad, ≤3 de profundidad, ≤40 líneas, **≤3 parámetros** |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11 · **13 migraciones** reversibles y con RLS |
| `audit:secrets` | ✅ | secretlint sobre todo el árbol |
| `audit:deps` | ✅ | Sin vulnerabilidades altas fuera de las 4 aceptadas. **Cero dependencias nuevas** |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | **585 unitarias** (con la base apagada) + **308 de integración**; 5 saltadas con motivo (INC-016) |

Crecimiento respecto de P15: **+7 unitarias** (el motivo) y **+10 de integración**
(el criterio de aceptación entero).

**Cero dependencias nuevas.** La suite del back office iba a usar
`@nestjs/testing` y no está instalado; se montó el módulo con `NestFactory`, que
además prueba el mismo camino que usa `backoffice.ts` en producción.

---

## Las tres reglas nuevas de `audit:forbidden`, probadas

INC-007 dice que un check que pasa en verde sin examinar nada es el fallo más
frecuente de este proyecto. Las tres se probaron **provocando la infracción**:

```
audit:forbidden  FALLO — 5 infraccion(es)
  [conexion-privilegiada-solo-en-backoffice]  Nombrar `BackofficeConnection` fuera del modulo
  [cadena-privilegiada-solo-en-backoffice]    Leer `BACKOFFICE_DATABASE_URL` fuera del modulo
  [backoffice-no-lo-monta-la-app]             Importar `BackofficeModule` desde la app cliente
```

Al retirar el archivo de prueba: `audit:forbidden OK — 34 reglas sobre 343 archivos`.

---

## La migración, verificada contra bases reales

```
npm run migrate:verify
  OK  el down deshace exactamente lo que hizo el up
  OK  up -> down -> up es idempotente
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY
```

Y el traslado del límite, comprobado sobre las 559 companies de la base de
desarrollo: todas quedaron en `BASICO`, cuyo `max_locations` es **exactamente
10** — el mismo `DEFAULT` que tenía la columna que se soltó. Ninguna cambió de
límite por el hecho de que ahora se llame plan.

---

## Los privilegios, comprobados contra la base y no supuestos

Tres de las diez pruebas de integración lo verifican ejecutando SQL con cada rol:

```
UPDATE backoffice_access_log ... como costeo_backoffice  ->  permission denied
DELETE FROM backoffice_access_log ... como costeo_backoffice  ->  permission denied
SELECT 1 FROM backoffice_access_log ... como costeo_app  ->  permission denied
SELECT id FROM audit_log ... como costeo_app  ->  0 filas (la política, no un error)
```

La última es la interesante: `costeo_app` **sí** tiene `GRANT SELECT` sobre
`audit_log` —lo necesita para el `RETURNING` de sus `INSERT` (INC-010)— y lo que
lo detiene es la política `USING (false)`. La cerradura es la política, no el
privilegio.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | El módulo no lo importa nadie; dos reglas de `audit:arch` lo sostienen. El back office **sí** lee de `iam` y `shared` (hasher, reloj), que es la dirección correcta: los parámetros de Argon2 viven en un solo sitio |
| **B · Clean Code** | Tres fachadas para que el controlador reciba 3 dependencias y no 10 (el patrón de `VistasDelMes`). Cero `any`, cero `@ts-ignore`, cero `eslint-disable`, cero números mágicos |
| **C · Seguridad** | ADR-017 entero. El motivo se valida en el dominio **y** en la base, nunca en un refinamiento de objeto (INC-008). Los privilegios son tabla por tabla y **no incluyen recetas ni precios** (§4.3) |
| **D · Base de datos** | Migración reordenada a mano para no perder el límite. `FOR UPDATE OF c` sobre `company`, no sobre el catálogo `plan`. Índices en `backoffice_access_log` por `at DESC` y por `(company_id, at DESC)`, que son las dos consultas que existen |
| **E · Reglas de negocio** | R1–R14 intactas. Las 308 de integración incluyen R7 = 0 y el aislamiento entre tenants |
| **F · Rendimiento** | El back office lo usa una persona a mano: `CONNECTION LIMIT 4` y sin presupuesto p95 propio. Los cuatro de §5 siguen verdes — el cambio de `max_locations` a `plan` añade un `JOIN` a una tabla de tres filas |
| **G · Pruebas** | Las 10 del criterio de aceptación, más la pareja que hace que la principal mida algo |
| **H · Documentación** | ADR-017, `CONSTRUCCION.md`, este archivo, `guardas-de-dominio.md`, `sistema/seguridad.md`, `CHANGELOG`, `ESTADO.md`, `DECISIONES.md` (D5 cerrada) |

---

## Lo que queda dicho, no escondido

- **No hay segundo factor en el back office.** Con un operador y acceso por túnel
  SSH sería proteger la segunda cerradura antes que la primera. **En cuanto haya
  un segundo operador, se reevalúa** — anotado en `ESTADO.md`.
- **El back office no tiene interfaz.** P13 la construye. Hoy se opera con `curl`
  por el túnel, que para un operador que es quien escribió el sistema es
  suficiente y no bloquea nada.
- **`npm run bench` no se volvió a correr en este paquete.** El camino de lectura
  de `costing`/`analytics` no se tocó; lo único que cambió es un `JOIN` a una
  tabla de tres filas en la creación de ubicaciones, que no tiene presupuesto.
  Es el criterio que `docs/AUDITORIA.md` I8 fija, aplicado.
