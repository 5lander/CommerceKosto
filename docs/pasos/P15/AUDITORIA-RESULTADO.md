# P15 — Resultado de la auditoría

**Fecha:** 2026-09-08 · **Paquete:** P15 — Endurecimiento
**Veredicto:** los doce checks en verde, más los cuatro presupuestos de rendimiento dentro de límite.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api`, `tools` y `apps/web`, modo estricto máximo |
| `audit:lint` | ✅ | `eslint . --max-warnings=0 --no-inline-config` |
| `audit:forbidden` | ✅ | **31 reglas sobre 319 archivos** (eran 31 sobre 303 en P10) |
| `audit:arch` | ✅ | 273 módulos, 1209 dependencias, sin violaciones |
| `audit:deadcode` | ✅ | knip, sin lista blanca. `src/bench.ts` declarado como entrada |
| `audit:complexity` | ✅ | complejidad ≤10, profundidad ≤3, funciones ≤40 líneas, ≤3 parámetros |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11 · **12 migraciones** reversibles y con RLS |
| `audit:secrets` | ✅ | secretlint sobre todo el árbol |
| `audit:deps` | ✅ | Sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas |
| `audit:sec-headers` | ✅ | |
| `audit:tests` | ✅ | **578 unitarias** (con la base apagada) + **298 de integración**; 5 saltadas con motivo (INC-016) |

`npm run audit` termina con código **0**.

Crecimiento respecto de P10: **+20 unitarias** (6 del pipe, 6 de la sesión, 8 más
en las suites tocadas) y **+21 de integración**, todas ellas del pentest.

---

## La migración, verificada contra bases reales

```
npm run migrate:verify
  OK  el down deshace exactamente lo que hizo el up
  OK  up -> down -> up es idempotente
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY
```

**Un tropiezo que dejó rastro y merece registro.** El `up` usaba
`CREATE OR REPLACE FUNCTION` para cambiar el tipo de retorno de `session_lookup`,
y PostgreSQL lo rechaza con `42P13: cannot change return type of existing
function`. El `down` ya lo tenía previsto —soltaba la función antes— pero el `up`
no. Consecuencia: fila fallida en `_prisma_migrations` y `P3009` bloqueando todo
hasta recuperarla a mano.

El arreglo obliga además a repetir el `REVOKE`/`GRANT`, **y eso es lo correcto**:
una función nueva nace sin los privilegios de la anterior, y una `SECURITY
DEFINER` sin `REVOKE ... FROM PUBLIC` sería una lectura sin tenant abierta a
cualquiera. `CREATE OR REPLACE` lo habría ocultado.

---

## Los cuatro presupuestos de CLAUDE.md §5

Medidos con `npm run bench` sobre volumen sintético: 5 companies, 10 ubicaciones,
500 ítems, 200 productos, 14.000 líneas de receta, 48.000 ventas y **219.000
movimientos de inventario**.

```
      suelo del entorno (validar sesion)                   p95     4.5 ms   limite      —
  OK  costeo de la carta (200 productos, 1.400 lineas)     p95    75.3 ms   limite  400 ms
  OK  inventario valorizado de una ubicacion (500 items)   p95   110.2 ms   limite  300 ms
  OK  consolidado de company (10 ubicaciones)              p95   677.5 ms   limite  800 ms
  OK  guardar una receta (con validacion de ciclos)        p95    51.8 ms   limite  150 ms
```

El consolidado entró **arreglando el código, no moviendo el umbral**:
1.399 → 1.351 (filtro cuadrático) → 844 (lecturas de company compartidas) → 677
(la carta leída una vez por ubicación en vez de dos).

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | El ámbito compartido vive en `application` y solo importa **tipos**; `audit:arch` lo confirma. `DependenciasDeCosteo` pasó a definirse por lo que consume (`LecturasDeCompany`), no por lo que había a mano |
| **B · Clean Code** | `contexto()` pasó a objeto de parámetros al llegar al cuarto (CLAUDE.md §3). Cero números mágicos nuevos. Cero `any`, cero `@ts-ignore`, cero `eslint-disable` |
| **C · Seguridad** | Los dos hallazgos del pentest, cerrados con prueba que los reproduce. La comprobación de control va **en el campo y antes de Zod**, nunca en un refinamiento de objeto (INC-008) |
| **D · Base de datos** | La migración añade una columna a una función `SECURITY DEFINER` reutilizando el índice `location(company_id, status)`. Ninguna consulta nueva por petición |
| **E · Reglas de negocio** | R1–R14 intactas: las 298 pruebas de integración incluyen la conciliación **R7 = 0** y el aislamiento entre tenants, y pasan después del cambio de lecturas compartidas |
| **F · Rendimiento** | Los cuatro presupuestos, medidos y en verde. Las diez consultas más caras, volcadas en `CONSULTAS-MAS-CARAS.md` |
| **G · Pruebas** | Cada hallazgo tiene su prueba: el NUL acompañado de otro error, y el OWNER contra ubicación ajena |
| **H · Documentación** | `CONSTRUCCION.md`, este archivo, `CONSULTAS-MAS-CARAS.md`, `CHANGELOG`, `ESTADO.md` y `docs/AUDITORIA.md` (dónde entra `bench`) |

---

## Lo que queda dicho, no escondido

- **`npm run bench` no está en `npm run audit`.** Dos minutos por commit es un
  precio que se paga en cada commit. Queda como comando propio y obligatorio al
  tocar el camino de lectura de `costing` o `analytics`, anotado en
  `docs/AUDITORIA.md`. Un medidor fuera del pre-commit puede decaer; se nombra
  aquí para que no pase en silencio.
- **El consolidado está al 85 % de su límite.** Lo que queda no es redundante: es
  costear diez cartas de 200 productos. Con más de diez ubicaciones toca ir a
  vistas materializadas (ADR-012 §7). Con un cliente, no aplica.
- **La atomicidad entre módulos en la importación** sigue siendo la limitación de
  diseño documentada en P10. P15 no la toca.
