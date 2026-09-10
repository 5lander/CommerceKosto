# P16 — Resultado de auditoría de la pasada

> Una sección por commit de la pasada. Los paquetes de API llevan además el suyo completo en su
> carpeta (`P16-A1/`, `P16-A2/`, `P16-B/`, `P16-C/`, `P20/`).

---

## Commit 0 — Tooling · 2026-09-09

**Alcance del diff:** `ESTADO.md`, `docs/pasos/P16/{PLAN,CONSTRUCCION,AUDITORIA-RESULTADO}.md`,
`tools/audit/rules/frontend.rules.mjs`, `tools/audit/forbidden.mjs` (dos líneas),
`scripts/medir-bundle.mjs`, `package.json` (un script), `.gitignore`, `docs/AUDITORIA.md` I9,
`docs/CHANGELOG.md`. **Ni una línea de `apps/api` ni de `apps/web`.**

### A. Arquitectura

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| A1–A6 | Regla de dependencia, capas, motor sin base | ✅ sin cambio | `audit:arch` — `✔ no dependency violations found (291 modules, 1284 dependencies cruised)`. El commit no toca `apps/api` |

### B. Código

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| B1 | Sin `any`, `@ts-ignore`, `eslint-disable` | ✅ | `audit:forbidden` — **40 reglas sobre 361 archivos** (36 + tres del frontend + `override-de-npm-reflejado-en-el-lock`) |
| B2 | Compila en estricto | ✅ | `audit:types` — los cuatro proyectos; `scripts/medir-bundle.mjs` entra por `tools/tsconfig.json` (`checkJs`, `nodenext`) |
| B3 | Lint | ✅ | `audit:lint` sin avisos |
| B4–B6 | Tamaño, profundidad, parámetros | ✅ | `audit:complexity` sin avisos: la función más larga del script nuevo, `medir`, tiene 11 sentencias |
| B7 | Sin números mágicos | ✅ | `KIB`, `PRESUPUESTO_KIB`, `RUTAS_DE_NEXT` con nombre y con su porqué |
| B10 | Sin `catch` que silencie | ✅ | El script no tiene `catch`: un manifiesto ausente falla con el comando que hay que correr |
| B11 | Sin código comentado | ✅ | Revisión del diff |

### C. Seguridad

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| C11 | Secretos fuera del repositorio | ✅ | `audit:secrets` sobre `**/*`, incluido `PLAN.md` |
| C26 | Vulnerabilidades | ✅ **tras corregir** | `audit:deps` paró el commit: cuatro CVE altos de `multer@2.2.0` (GHSA-wc9g-mqfw-jrwm, -qfvm-cv95-jqjf, -qvfw-j98x-7q72, -535w-7cp7-47q4), publicados después de P14b. `multer` **sí** viaja a la imagen, así que no se acepta: `overrides` a 2.3.0 y lock trasplantado, verificado con `npm ci` en copia limpia. Ver «Correcciones» e INC-021 |
| C19 | Cabeceras | ✅ sin cambio | `audit:sec-headers` — 18 pruebas |
| resto | — | — no aplica | El commit no añade endpoints, tablas, entradas ni dependencias |

### D. Base de datos

**— No aplica.** Sin migraciones ni consultas. `audit:migrations` sigue en M1–M11 sobre 13 migraciones.

### E. Reglas de negocio

**— Sin cambio.** `audit:tests` en verde con las mismas pruebas que P14b (abajo).

### F. Frontend

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| F1–F9 | — | — no aplica | El diff no toca `apps/web`. Lo que sí hace es dejar armados **tres guardianes** (`no-fecha-a-medianoche`, `no-number-en-frontend`, `no-tipti`) y el medidor de I9 **antes** de la primera pantalla de la pasada |

### G. Pruebas

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| G1 | Todas en verde | ✅ | Salida de `npm run audit`, abajo |
| **G2** | **Guardián de cada verificación nueva** (AUDITORIA.md, «la prueba del guardián») | ✅ | **Tres reglas:** cinco líneas coladas en `ui/Tabla.tsx` → `FALLO — 5 infraccion(es)`, dos por regla de fechas, dos por la de números, una por Tipti, con línea; revertido → `OK`. **`override-de-npm-reflejado-en-el-lock`:** `overrides.multer` puesto a 2.4.0 → `FALLO — 1 infraccion(es)` · `overrides pide multer@2.4.0, el lock instala node_modules/multer en 2.3.0`; revertido → `OK — 40 reglas sobre 361 archivos`. **`medir-bundle`:** presupuesto bajado a 100/135 → `PASA` en el piso y en cuatro pantallas, `exit=1`; revertido → `OK`. Salidas literales en `CONSTRUCCION.md` |
| G2 bis | El contador de `audit:forbidden` (INC-007 caso 10) | ✅ | **360 → 361, y el +1 está identificado:** `scripts/medir-bundle.mjs`, que entra por el glob `scripts/**/*.mjs`. Las tres reglas nuevas no lo mueven —aplican a `apps/web/src/**/*.{ts,tsx}`, que las 36 anteriores ya examinaban desde P14—; lo mueve el archivo nuevo, que es lo que el caso 10 exige comprobar. (El guardián corrió antes de crear el script y por eso su salida dice 360) |
| G7 | Sin datos reales | ✅ | No hay datos en el commit |

### H. Documentación

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| H1 | `CONSTRUCCION.md` | ✅ | `docs/pasos/P16/CONSTRUCCION.md`, sección «Commit 0» completa |
| H2–H4 | Endpoints, FUNCIONAMIENTO, modelo de datos | — no aplica | Sin endpoints ni migraciones |
| H5 | Configuración | — no aplica | Sin variables nuevas |
| H6 | ADR | — no aplica | Las decisiones de este commit son de tooling y están en `CONSTRUCCION.md`; las de la pasada (ADR-019…ADR-025) llegan con el paquete que las implementa |
| H8 | CHANGELOG | ✅ | Entrada «P16 · commit 0 — Tooling de la pasada» |
| H10–H12 | Incidencias | ✅ | Ninguna cumple el criterio: el rojo de `docs/Sistema ejemplo/` lo explicaba el propio mensaje del check |
| H13 | Describe lo construido | ✅ | Los números del bundle son los medidos, no los previstos |
| H14 | Este archivo | ✅ | |

### I. Optimización

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| I1 | Sin código muerto | ✅ | `audit:deadcode` — `knip` sale con 0 (imprime pistas de configuración, no hallazgos) |
| I2 | Complejidad | ✅ | `audit:complexity` |
| I3 | Duplicación | ✅ | `audit:duplication` — `Found 0 clones` |
| I8 | `npm run bench` | — no aplica | El commit no toca ningún camino de lectura |
| **I9** | **Presupuesto de bundle** | ✅ | `medir-bundle`: piso **126,9 KiB** gzip (428,6 bruto), pantalla más cara `/menu` **138,6 KiB**; presupuesto 200 / 350. Es la línea base de la pasada |

### Salida de `npm run audit`

Líneas de resultado de cada check, sin los códigos de color (la salida completa de las pruebas son ~2.000 líneas de vitest):

```
audit:forbidden  OK — 40 reglas sobre 361 archivos
✔ no dependency violations found (291 modules, 1284 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 13 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 22 skipped (24)
      Tests  19 passed | 299 skipped (318)
 Test Files  39 passed (39)
      Tests  585 passed (585)
 Test Files  24 passed (24)
      Tests  313 passed | 5 skipped (318)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

Corrida sobre el árbol exacto del commit, con `costeo-api` parado (INC-016). Las 5 saltadas son las de rendimiento que solo se exigen en CI; las 299 «skipped» de la primera pasada son `audit:sec-headers`, que filtra por nombre.

### Correcciones hechas durante la auditoría

| Check que falló | Qué se corrigió |
|---|---|
| `audit:forbidden` (antes de tocar nada) | `docs/Sistema ejemplo/package.json` con un `start` que apunta a `dist/server.cjs`, inexistente. La carpeta se ignora en git (D-16.39): es una referencia, no código del proyecto |
| `audit:deps` — 4 altas sin aceptar | Un solo paquete, `multer@2.2.0`, arrastrado por `@nestjs/platform-express@11.2.3` (que lo fija exacto) y por eso `core` y `terminus` salían en la lista. Se fuerza 2.3.0 con `overrides`; como npm no re-resuelve una arista sobreescrita cuando ya hay lockfile, la entrada se trasplantó de una resolución sin lock (mismas dependencias) y se probó con `npm ci --ignore-scripts` en copia limpia: 2.3.0, sin copia anidada, lock idéntico. **INC-021**, con regla nueva `override-de-npm-reflejado-en-el-lock` y su guardián |
