# P10 — Resultado de la auditoría

**Fecha:** 2026-09-07 · **Paquete:** P10 — Importación de catálogo, acotada
**Veredicto:** los doce checks en verde, con la checklist manual de `docs/AUDITORIA.md` repasada.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api` y `tools`, modo estricto máximo |
| `audit:lint` | ✅ | `eslint . --max-warnings=0 --no-inline-config` |
| `audit:forbidden` | ✅ | **31 reglas sobre 303 archivos** (eran 30 sobre 261 en P9) |
| `audit:arch` | ✅ | 267 módulos, 1171 dependencias, sin violaciones |
| `audit:deadcode` | ✅ | knip, sin lista blanca |
| `audit:complexity` | ✅ | complejidad ≤10, profundidad ≤3, funciones ≤40 líneas, ≤3 parámetros |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11 · **11 migraciones** reversibles y con RLS |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | Sin vulnerabilidades altas fuera de las 4 aceptadas |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | **558 unitarias** (con la base apagada) + **277 de integración**; 5 saltadas con motivo (INC-016) |

Verificación adicional de la migración, fuera de los doce:

```
npm run migrate:verify
  OK  el down deshace exactamente lo que hizo el up
  OK  up -> down -> up es idempotente
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY
```

Y los privilegios reales, comprobados contra la base y no supuestos:

```
 import_job        | INSERT, SELECT, UPDATE     <- sin DELETE, a proposito
 import_job_status | SELECT                     <- REVOKE del resto
 rls / forzado     | t / t   en las dos tablas
```

---

## Lo que los checks pararon

**Cuatro cosas reales, y ninguna se arregló relajando una regla.** El detalle está en
`CONSTRUCCION.md`; el resumen:

| Check | Qué paró | Cómo se arregló |
|---|---|---|
| `audit:forbidden` | `as unknown as Analisis` al leer el `jsonb` | Se borró el método: **nadie lo llamaba** |
| `audit:arch` | El dominio importaba tipos desde el puerto | Los tipos eran de negocio: se mudaron al dominio |
| `audit:deadcode` | `MAXIMO_BYTES` y `MAXIMO_DE_FILAS` sin usar | **No era código muerto: era un límite de seguridad desconectado.** Se conectó |
| `audit:duplication` | Dos clones (auditoría de lote, IVA por defecto) | Extraídos a un solo sitio |

El tercero es el que más vale: `SEGURIDAD.md` §5.1 exige tope de tamaño y de filas, el código lo
tenía escrito, y **no lo aplicaba nadie**. Un check de código muerto encontró un agujero de
seguridad, que es exactamente el argumento de INC-007 al revés — no es que el verde mienta, es que el
rojo dice más de lo que parece.

---

## Criterio de aceptación

| Criterio | Estado |
|---|---|
| Un archivo con una fila inválida en la posición 150 **no escribe ninguna de las 149 anteriores** | ✅ Prueba de integración, contando filas antes y después |
| El mismo archivo sin esa fila entra entero | ✅ 149 filas escritas |
| Sin `--confirmar` no se escribe nada | ✅ |
| Dos companies no se ven lo importado, verificado sobre la respuesta cruda | ✅ |
| Un combo importado va a `combo_component` y **no** a `recipe_line` | ✅ La ruta que faltaba desde P4 |
| Un combo que contiene otro combo se rechaza | ✅ |
| RLS deny-by-default y `FORCE` en las dos tablas nuevas | ✅ Comprobado en `pg_class` y `pg_policies` |
| El permiso es de nivel company: `GERENTE_LOCAL` no lo recibe | ✅ Solo `OWNER` y `ADMIN` |
| El comando **arranca** | ✅ Ejecutado: compila, valida argumentos e imprime el uso |

---

## Checklist manual de `docs/AUDITORIA.md`

- **A. Arquitectura** — `imports` no escribe ninguna tabla de negocio; el dominio de los cuatro lotes
  es puro y corre con la base apagada. `audit:arch` lo verifica.
- **C. Seguridad** — El CLI abre sesión **por el mismo camino que el login**, con contraseña y con su
  registro en `audit_log`; no existe ninguna ruta que fabrique una sesión sin credenciales. La guarda
  de producción exige bandera explícita. Los topes de archivo, ahora sí aplicados.
- **D. Base de datos** — RLS y `FORCE` en las dos tablas; `GRANT UPDATE` justificado en el bloque
  manual; `down.sql` espejo verificado contra bases reales.
- **E. Reglas de negocio** — R1 (aislamiento, probado), R5 (los precios nacen sugeridos; confirmarlos
  es un acto explícito y auditado), R9 (la validación de ciclos sigue en `GuardarReceta`), R12 (el
  combo suma componentes ya costeados, probado).
- **G. Pruebas** — Dominio con la base apagada; integración con dos tenants; CSV **sintéticos**
  (CLAUDE.md §7).
- **H. Documentación** — ADR-013, ADR-014, este archivo, `CONSTRUCCION.md`, `modelo-datos.md`,
  `guardas-de-dominio.md`, `runbooks/despliegue.md`, `CHANGELOG.md`, `DECISIONES.md` y `ESTADO.md`.
- **I. Optimización** — Dos lecturas por lote y no dos por fila; `createMany` en una sentencia donde
  se puede; se aplazó todo lo que este cliente no necesita.

---

## Lo que este paquete NO cerró

1. **`npm run bench` sigue sin pagarse.** Se fijó para P9, P9 no lo pagó, se re-fechó a P10, y P10
   tampoco: este sprint no añade ningún presupuesto p95 nuevo y el tiempo sale del frontend.
   **Re-fechado a después del lanzamiento, dicho y no escondido.**
2. **La atomicidad entre módulos** sigue siendo imposible. Es diseño, no deuda, y está razonado.
3. **El dialecto del archivo del cliente** es desconocido hasta que llegue. La pasada de análisis no
   escribe: ajustarlo es media hora sin tocar el camino de escritura.
4. **Nadie puede leer `audit_log`** — pendiente estructural de P11, pospuesto.
