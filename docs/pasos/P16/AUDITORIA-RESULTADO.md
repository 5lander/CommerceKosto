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
| H6 | ADR | — no aplica | Las decisiones de este commit son de tooling y están en `CONSTRUCCION.md`; las de la pasada (ADR-020…ADR-026: ADR-019 ya es la capa visual) llegan con el paquete que las implementa |
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

---

## Armazón (pantalla 1) · 2026-09-13

**Alcance del diff:** `apps/web` (grupo de rutas `(app)`, `componentes/armazon/`, tres primitivas de
`ui/`, cinco módulos de `lib/`, las seis páginas, `global.css`, `textos/es.ts`, `package.json`),
`eslint.complexity.config.mjs`, `tools/doctor.mjs`, `tools/audit/tests.mjs`, ADR-020, ADR-022, INC-023,
INC-015, INC-007, `.env.example`, `docs/sistema/configuracion.md`, `ESTADO.md`, `CHANGELOG`,
`FUNCIONAMIENTO.md` y este documento. **De `apps/api`, solo `test/soporte/guardia-sin-base.ts`**: ni
una línea de `src`.

### A. Arquitectura

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| A1–A6 | Regla de dependencia | ✅ sin cambio | `audit:arch` — `✔ no dependency violations found (390 modules, 1751 dependencies cruised)`. El commit no toca `apps/api` |
| A7 | Cero lógica de negocio en el frontend | ✅ | Los permisos salen de la API; el mes por defecto es una fecha, no una regla; `sinCerosDeSobra` quita ceros de un texto sin cambiar el número; nada compara contra umbrales |

### B. Código

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| B1 | Sin `any`, `@ts-ignore`, `eslint-disable` | ✅ | `audit:forbidden` — **47 reglas sobre 504 archivos** |
| B2 | Compila en estricto | ✅ | `audit:types` — los cuatro proyectos; el web con `next typegen` delante |
| B3 | Lint | ✅ | `audit:lint` sin avisos |
| B4–B6 | Tamaño, profundidad, parámetros | ✅ | `audit:complexity` **ahora sobre los `.tsx`**: de 10 incumplimientos a 0 |
| B10 | Sin `catch` que silencie | ✅ | `useEnvio` y `useCarga` capturan para **enseñar** el mensaje; `tokenDeMutacion` solo absorbe `SESION_INVALIDA` y relanza lo demás |
| B11 | Sin código comentado | ✅ | Revisión del diff |

### C. Seguridad

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| C-CSRF | El token sigue en toda mutación con sesión | ✅ | Verificado en el navegador: `POST /analitica/ventas` y `PUT /conteos/:id/lineas` con sesión llevan `X-CSRF-Token` y guardan. Sin sesión sale sin cabecera y la API decide (ADR-022, decisión 4): una ruta protegida responde `SESION_INVALIDA` antes del guard de CSRF |
| C-autorización | El frontend no decide permisos | ✅ | Con `BODEGA`, `/costeo`, `/menu` y `/ventas` escritas a mano enseñan el estado sin permiso; la conciliación no llega (403 de la API) |
| C11 | Secretos | ✅ | `audit:secrets`. Las contraseñas del tenant de ensayo viven en el scratchpad de la sesión, no en el repositorio |
| C26 | Vulnerabilidades | ✅ | `audit:deps` — sin altas fuera de las 4 aceptadas. **Sin dependencias nuevas** |

### D. Base de datos

**— No aplica.** Sin migraciones ni consultas. `audit:migrations` — 18 migraciones reversibles y con RLS.

### E. Reglas de negocio

**— Sin cambio en la API.** `audit:tests` en verde: 891 unitarias y 536 + 5 de integración, las mismas
que P16-C.

### F. Frontend

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| F1 | Cero estilos literales | ✅ | Todo en `global.css` con tokens; los componentes solo ponen `className` |
| F2 | Estados de carga, error y vacío | ✅ | `Vista` los exige; las cuatro secciones y `/sucursal` la usan |
| F3 | Accesibilidad básica | ✅ | `aria-expanded`/`aria-controls` en «Menú», `aria-current` en el enlace activo, etiquetas ocultas a la vista y no al lector, foco que baja con Enter |
| F4 | Datos protegidos no llegan | ✅ | `BODEGA` sin diferencia en el conteo |
| F5 | Móvil | ✅ | 33 capturas; ninguna desborda a 360 px |
| F6 | Sin `localStorage` sensible | ✅ | Solo el id de la sucursal, como antes; permisos y token en memoria |

### G. Pruebas

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| G1 | Todas en verde | ✅ | 891 unitarias; 536 de integración + 5 de rendimiento saltadas (solo se exigen en CI). Salida abajo |
| **G2** | Guardián de cada verificación nueva | ✅ | Glob `.tsx`: 10 → 0. `next typegen`: sonda en rojo en clon limpio, verde al retirarla. `doctor`: `cortada`, `rechazada`, `contestan`. **Guardia de «unitarias sin base» con la base en el 5442**: la vieja deja pasar una unitaria que conecta a la base, la nueva la para con su mensaje. Salidas en `CONSTRUCCION.md` |
| G2 bis | Contador de `audit:forbidden` (INC-007 caso 10) | ✅ | **483 → 504, y los +21 están identificados**: 16 archivos nuevos (`fechas`, `periodo`, `useLectura`, `useEnvio`, `rejilla`, `permisos`, `Vista`, `CeldaEditable`, `Campo` y los siete de `armazon/`) y 5 `layout.tsx` (el del grupo y los cuatro de sección). Los `git mv` no suman |
| G7 | Sin datos reales | ✅ | Tenant `Ensayo de Despliegue (sintetico)`, dominio `.invalid` |

### H. Documentación

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| H1 | `CONSTRUCCION.md` | ✅ | Sección «Armazón» |
| H3 | FUNCIONAMIENTO | ✅ | «El armazón de la aplicación cliente», con diagrama |
| H6 | ADR | ✅ | **ADR-020** y **ADR-022**, los dos números que el plan reservó |
| H8 | CHANGELOG | ✅ | Entrada «P16 · Armazón» |
| H10–H12 | Incidencias | ✅ | INC-023 nueva; INC-015 (→1) e INC-007 (→13) con su prevención |
| H13 | Describe lo construido | ✅ | Los números son los medidos: capturas, bundle, contador |

### I. Optimización

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| I1 | Sin código muerto | ✅ | `audit:deadcode` — `knip` sale con 0 |
| I2 | Complejidad | ✅ | `audit:complexity` |
| I3 | Duplicación | ✅ | `audit:duplication` — `Found 0 clones`. La casilla editable y la navegación por la rejilla, que ventas e inventario copiaban, viven una vez |
| I8 | `npm run bench` | — no aplica | Sin cambios de lectura en la API |
| **I9** | Presupuesto de bundle | ✅ | `medir-bundle`: piso **126,9 KiB** gzip (428,6 bruto), pantalla más cara `/inventario` **142,6 KiB** (antes 138,7); presupuesto 200 / 350 |

### Salida de `npm run audit`

Líneas de resultado de cada check, sin los códigos de color:

```
audit:forbidden  OK — 47 reglas sobre 504 archivos
✔ no dependency violations found (390 modules, 1751 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 31 skipped (33)
      Tests  19 passed | 522 skipped (541)
 Test Files  66 passed (66)
      Tests  891 passed (891)
 Test Files  33 passed (33)
      Tests  536 passed | 5 skipped (541)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

Corrida con la base publicada en el 5442 (D-16.145) y `costeo-api` parado (INC-016). Las 522
«skipped» de la primera pasada son `audit:sec-headers`, que filtra por nombre.

### Correcciones hechas durante la auditoría

| Check que falló | Qué se corrigió |
|---|---|
| `audit:types` (web) | `.next/types` rancio tras el `git mv` → `next typegen` en `typecheck` (INC-007, caso 13) |
| `audit:complexity` con el glob `.tsx` | Diez funciones partidas; `HojaDeConteo` (41) y `FormularioDeEntrada` (46) en una segunda vuelta, con `FilaParaContar` y `CampoDeTexto` |
| Recorrido en el navegador | INC-023, filas guardadas no editables, lateral corta, cabecera móvil de cuatro filas |
| Mover la base al 5442 | La guardia de «unitarias sin base» y la sonda de `audit:tests` vigilaban el 5432 fijo; leen las cadenas de conexión |

---

## Inicio (pantalla 2) · 2026-09-14

**Alcance del diff:** `apps/web` (Inicio, `Indicador`, `Vista` y sus cinco llamadas, `decimales` y las
dos primeras pruebas, navegación, textos, CSS, `tsconfig`), `tools/audit/tests.mjs`, `knip.json`,
`eslint.config.mjs`, ADR-027, INC-024, INC-023, `ESTRATEGIA.md`, `ESTADO.md`, `CHANGELOG`,
`FUNCIONAMIENTO.md` y este documento. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Ninguna regla en el cliente: cifras y colores de `GET /analitica/resumen`; qué pantalla ver sale del permiso, no del rol |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 510 archivos** |
| C · Seguridad | ✅ | `BODEGA` no recibe el resumen (403 de la API) y su reposición no trae cantidades (capturado); ninguna dependencia nueva |
| D · Base de datos | — no aplica | |
| E · Reglas de negocio | ✅ sin cambio | `audit:tests` |
| F · Frontend | ✅ | Estados con `Vista`; semáforo por atributo y CSS; 6 capturas sin desbordes |
| G · Pruebas | ✅ | **20 pruebas nuevas en `apps/web`**; cuatro guardianes (W1–W4) en `CONSTRUCCION.md` |
| G2 bis · Contador | ✅ | **505 → 510, y los +5 están identificados**: `inicio/page.tsx`, `inicio/layout.tsx`, `ui/Indicador.tsx`, `lib/decimales.spec.ts` y `lib/fechas.spec.ts` |
| H · Documentación | ✅ | ADR-027, INC-024, ESTRATEGIA, FUNCIONAMIENTO, CHANGELOG, ESTADO |
| I9 · Bundle | ✅ | `medir-bundle`: piso **126,9 KiB**, `/inicio` **142,1**, la mayor `/inventario` **143,0**; presupuesto 200 / 350 |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 510 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 31 skipped (33)
      Tests  19 passed | 527 skipped (546)
 Test Files  67 passed (67)
      Tests  894 passed (894)
ℹ tests 20
ℹ pass 20
ℹ fail 0
 Test Files  33 passed (33)
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

Las tres líneas `ℹ` son las 20 pruebas nuevas de `apps/web`, entre las unitarias de la API y las de integración.

---

## Pantalla 1b — Olvidé mi contraseña · Restablecer · 2026-09-14

**Alcance del diff:** `apps/web` (`/olvide`, `/restablecer`, enlace en `/entrar`, `useEnvio`, `api.ts` y su
prueba, `tsconfig`, textos, CSS), INC-025, INC-023, `ESTRATEGIA.md`, `ESTADO.md`, `CHANGELOG`,
`FUNCIONAMIENTO.md` y este documento. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | La política de contraseñas la decide la API; el cliente solo evita gastar el enlace en un error de tecleo |
| B · Código | ✅ | `audit:types` (con `erasableSyntaxOnly`), `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 513 archivos** |
| C · Seguridad | ✅ | **La misma frase exista o no la cuenta** (verificado); el enlace de un solo uso (verificado); sin dependencias |
| F · Frontend | ✅ | Estados: pedido, sin token, token inválido, corta, no coinciden, 429, hecho |
| G · Pruebas | ✅ | **11 pruebas nuevas del transporte**, 31 en `apps/web`; guardianes W5, W6 y `erasableSyntaxOnly` |
| G2 bis · Contador | ✅ | **510 → 513**: `olvide/page.tsx`, `restablecer/page.tsx` y `lib/api.spec.ts` |
| H · Documentación | ✅ | INC-025, INC-023, ESTRATEGIA, FUNCIONAMIENTO, CHANGELOG, ESTADO |
| I9 · Bundle | ✅ | piso **126,9 KiB**; `/olvide` 138,5, `/restablecer` 138,8; la mayor `/inventario` **143,5** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 513 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 31 skipped (33)
      Tests  19 passed | 527 skipped (546)
 Test Files  67 passed (67)
      Tests  894 passed (894)
ℹ tests 31
ℹ pass 31
ℹ fail 0
 Test Files  33 passed (33)
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 3 — Ventas (arreglo) · 2026-09-14

**Alcance del diff:** `app/(app)/ventas/page.tsx`, `styles/global.css`, `ESTADO.md`, `CHANGELOG` y
`docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Una lectura más barata de la misma verdad; ningún cálculo en el cliente |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 513 archivos** (sin archivos nuevos) |
| C · Seguridad | ✅ | `GET /productos/ubicaciones` lleva PVP y `BODEGA` no la recibe; `BODEGA` tampoco entra en ventas (capturado) |
| F · Frontend | ✅ | Escritura y capturas en `CONSTRUCCION.md` |
| G · Pruebas | ✅ | Salida abajo |
| I9 · Bundle | ✅ | piso **126,9 KiB**; `/ventas` 143,3; la mayor `/inventario` **143,5** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 513 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  67 passed (67)
      Tests  894 passed (894)
ℹ tests 31
ℹ pass 31
ℹ fail 0
 Test Files  33 passed (33)
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 4 — Insumos: listado · 2026-09-14

**Alcance del diff:** `apps/web` (`/insumos`, `Casilla`, `Selector`, `comoCostoDeUso` y sus pruebas,
navegación, textos, CSS), `ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El costo lo calcula la API; el cliente redondea para enseñar. Los filtros no deciden nada |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 517 archivos** (+4: `Casilla`, `Selector`, `insumos/page.tsx`, `insumos/layout.tsx`) |
| C · Seguridad | ✅ | `BODEGA` no pide `GET /precios/costos` (log de la API) y no tiene `pricing.read` (403 en la API) |
| F · Frontend | ✅ | Estados vacío y sin coincidencias; capturas y filtros en `CONSTRUCCION.md` |
| G · Pruebas | ✅ | **34 del web** (+3 de `comoCostoDeUso`), con guardián |
| I9 · Bundle | ✅ | piso **126,9 KiB**; `/insumos` 143,4; la mayor `/inventario` **143,9** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 517 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  894 passed (894)
ℹ tests 34
ℹ pass 34
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 5 — Insumo: alta · 2026-09-14

**Alcance del diff:** `apps/web` (`/insumos/nuevo`, `Formulario`, `Volver`, `fraccionDePorcentaje` y sus
pruebas, botón en `/insumos`, textos, CSS), `ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de
`apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Las reglas del ítem (rendimiento 0–1, `llevaStock` según tipo, unidad existente, nombre único) las aplica la API; la pantalla ofrece solo lo válido y enseña su 400/409 |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 520 archivos** (+3: `Formulario`, `Volver`, `insumos/nuevo/page.tsx`) |
| C · Seguridad | ✅ | Sin `catalog.create`, ni botón ni formulario (verificado con el gerente); la frontera es el 403 de la API |
| F · Frontend | ✅ | Error de la API junto al botón; botón bloqueado al enviar |
| G · Pruebas | ✅ | **37 del web** (+3 de `fraccionDePorcentaje`), con guardián |
| I9 · Bundle | ✅ | piso **126,9 KiB**; `/insumos/nuevo` 144,0; la mayor `/inventario` **144,3** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 520 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  894 passed (894)
ℹ tests 37
ℹ pass 37
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 6 — Insumo: ficha, editar y archivar · 2026-09-14

**Alcance del diff:** `apps/web` (ficha, edición, `componentes/insumos/`, `Confirmar`, `Pildora`, `Volver`,
`porcentajeDeFraccion`, `comoFecha` y sus pruebas, enlaces, textos, CSS), `ESTADO.md`, `CHANGELOG` y
`docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Qué precio es vigente y cuánto cuesta lo dice la API; archivar es su `PUT` |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 526 archivos** (+6) |
| C · Seguridad | ✅ | `BODEGA` no pide precios y no ve botones (verificado); la concurrencia con versión (409 verificado) |
| F · Frontend | ✅ | Confirmación en línea; conflicto accionable; sin desbordes |
| G · Pruebas | ✅ | **40 del web** (+3), dos guardianes nuevos |
| I9 · Bundle | ✅ | piso **126,9 KiB**; la mayor `/insumos/[id]` **145,1** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 526 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  894 passed (894)
ℹ tests 40
ℹ pass 40
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 7 — Grupos · 2026-09-14

**Alcance del diff:** `apps/web` (`/grupos`, alta, edición, `FormularioDeGrupo`, navegación, textos),
`ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | La precedencia de la tarifa la aplica la API; la pantalla distingue `null` de 0 |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 531 archivos** (+5) |
| C · Seguridad | ✅ | Sin `catalog.create`/`catalog.update`, ni botón ni enlaces (gerente verificado) |
| G · Pruebas | ✅ | Sin funciones nuevas en `lib/`: reutiliza `fraccionDePorcentaje` y `porcentajeDeFraccion`, ya probadas |
| I9 · Bundle | ✅ | piso **126,9 KiB**; `/grupos/[id]/editar` 144,6; la mayor `/insumos/[id]` **145,4** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 531 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  894 passed (894)
ℹ tests 40
ℹ pass 40
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 8 — Artículo: alta y editar · 2026-09-14

**Alcance del diff:** `apps/web` (alta y edición de artículos, `CampoNumerico`, `conPuntoDecimal` y su
prueba, enlaces en la ficha, sustitución del campo de porcentaje en insumos y grupos, textos),
`ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El factor lo calcula o exige la API; la pantalla solo enseña el campo cuando la dimensión difiere |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 534 archivos** (+3) |
| C · Seguridad | ✅ | Sin `catalog.create`/`catalog.update`, ni botón ni enlaces (gerente verificado) |
| G · Pruebas | ✅ | **41 del web** (+1) |
| I · Duplicación | ✅ | `Found 0 clones`; el filtro de forma de número vive una vez |
| I9 · Bundle | ✅ | la mayor `/insumos/[id]` **145,7 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 534 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  894 passed (894)
ℹ tests 41
ℹ pass 41
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 9 — Precios: bandeja y decidir · 2026-09-14

**Alcance del diff:** `apps/web` (bandeja de precios, su sección, la entrada de navegación y los textos),
`ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Ni la variación ni si se puede decidir se calculan en la pantalla: el vigente y el 409 son de la API |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 536 archivos** (+2) |
| C · Seguridad | ✅ | Sin `pricing.confirm`, sin botones (gerente verificado); sin `pricing.read`, «sin acceso» y sin enlace (bodega verificado); la frontera sigue siendo el 403 |
| D · Base de datos | ✅ | Paginación por cursor (`despuesDe`), nunca `OFFSET` |
| G · Pruebas | ✅ | Sin lógica nueva que probar en `lib/`; **41 del web** |
| I · Duplicación | ✅ | `Found 0 clones` |
| I9 · Bundle | ✅ | `/precios` **144,8 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 536 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 41
ℹ pass 41
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 10 — Precio: sugerir · 2026-09-14

**Alcance del diff:** `apps/web` (alta de precio, enlaces desde bandeja y ficha, `lib/fechas` y `lib/campos`
con sus pruebas, `textoOpcional` en artículos, formato de precios, `.campo select`, textos), `ESTADO.md`,
`CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | La precedencia de la tarifa, la regla comprado/preparación y el precio positivo los decide la API; la pantalla elige qué campos enseña por el `tipo` que devuelve |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 539 archivos** (+3); la fecha a `12:00Z` en `lib/fechas.ts`, no en la pantalla (`no-fecha-a-medianoche`) |
| C · Seguridad | ✅ | Sin `pricing.suggest`, ni enlace ni formulario (bodega verificado); gerente sugiere y no decide |
| G · Pruebas | ✅ | **46 del web** (+5) |
| I · Duplicación | ✅ | `Found 0 clones`; «vacío viaja como `null`» vive una vez |
| I9 · Bundle | ✅ | `/precios/nuevo` **146,3 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 539 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 46
ℹ pass 46
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 11 — Productos: listado, alta y ficha · 2026-09-14

**Alcance del diff:** `apps/web` (listado, alta y ficha de productos, grupo «Carta», `lib/busqueda` y su
prueba, `ui/Dato`, textos), `ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Qué sucursales ve cada rol lo filtra la API (D-16.113); la pantalla pinta lo que llega |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 546 archivos** (+7) |
| C · Seguridad | ✅ | BODEGA sin `product.read`: «sin acceso» y sin enlace; gerente sin `product.write`: ni botón ni alta |
| G · Pruebas | ✅ | **49 del web** (+3) |
| I · Duplicación | ✅ | `Found 0 clones`; la búsqueda y el dato de ficha viven una vez |
| I9 · Bundle | ✅ | `/productos` **146,0 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 546 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 12 — Producto: PVP y activación, empaque, simulador y desglose · 2026-09-14

**Alcance del diff:** `apps/web` (bloques de la ficha del producto, tipos de costeo compartidos,
`VolverACargar`, `CONFLICTO_DE_VERSION`, textos), `docs/incidencias/INC-026`, `ESTADO.md`, `CHANGELOG` y
`docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Ni un cálculo: costos, venta, semáforo y simulación son de `GET /costeo/:id`; la regla «activo necesita PVP» la decide la API (el `required` del campo es ayuda) |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 553 archivos** (+7) |
| C · Seguridad | ✅ | Gerente sin `product.write`: sin formularios; el desglose depende de `recipe.read` en la API (D-16.106) |
| E · Reglas | ✅ | R14 (PVP con IVA, venta neta de la API); concurrencia de ADR-023 con 409 verificado |
| G · Pruebas | ✅ | **49 del web**; sin lógica nueva en `lib/` |
| H · Documentación | ✅ | INC-026 con su prevención |
| I · Duplicación | ✅ | `Found 0 clones`; tipos de costeo y botón del 409 viven una vez |
| I9 · Bundle | ✅ | `/productos/[id]` **148,3 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 553 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 13 — Componentes de combo · 2026-09-14

**Alcance del diff:** `apps/web` (bloque de componentes en la ficha, editor de componentes, aviso de costo
de un combo, textos), `ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Qué puede ser componente lo decide la API (400 con motivo); el selector solo filtra la oferta |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 555 archivos** (+2) |
| C · Seguridad | ✅ | Gerente lee componentes y no edita (sin enlace, editor «sin acceso»); la frontera es el 403 |
| E · Reglas | ✅ | Reemplazo total con `version` y 409 verificado (ADR-023); filas con clave propia (INC-026) |
| G · Pruebas | ✅ | **49 del web**; sin lógica nueva en `lib/` |
| I · Duplicación | ✅ | `Found 0 clones` |
| I9 · Bundle | ✅ | `/productos/[id]` **148,8 KiB**; `/productos/[id]/componentes` 146,8 |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 555 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Pantalla 14 — Receta · 2026-09-14

**Alcance del diff:** `apps/web` (lectura, editor, fila y página de receta, dos rutas, enlaces en las fichas,
textos), `ESTADO.md`, `CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/api`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El rendimiento de EP, los ciclos (R9) y el costo los resuelve la API; la pantalla manda `base` y `estado` tal cual |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 561 archivos** (+6); la vigencia a `12:00Z` por `lib/fechas` |
| C · Seguridad | ✅ | BODEGA sin `recipe.read`: «sin acceso» (R8); la receta de otra sucursal es 403 en la API |
| E · Reglas | ✅ | R4 (AP/EP con resultados distintos en el costo), versión nueva y no edición (SPEC §9), `basadaEn` y 409 (ADR-023) |
| G · Pruebas | ✅ | **49 del web**; sin lógica nueva en `lib/` |
| I · Duplicación | ✅ | `Found 0 clones`; una sola página para producto y preparación |
| I9 · Bundle | ✅ | `/productos/[id]/receta` **148,5 KiB** |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 561 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 527 skipped (546)
      Tests  894 passed (894)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

---

## Verificación multi-tenant · 2026-09-17

**Alcance del diff:** `apps/api` (`ProductoRepetidoError` y su uso, tildes de cinco mensajes de `iam`,
🔴 del nombre por company), `docs/pruebas/ESTRATEGIA.md`, `docs/apis/app-cliente.md`, `ESTADO.md`,
`CHANGELOG` y `docs/pasos/P16/`. **Ni una línea de `apps/web`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El error nuevo es de dominio y no sabe de HTTP; el 409 lo pone `ErrorFilter` por su código |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 561 archivos** |
| C · Seguridad | ✅ | **Las tres barreras, vistas desde la pantalla**: 0 fugas en 8 listados, «no encontrado» en sitio en 7 fichas ajenas, «no está en tu alcance» en 3 pantallas con sucursal ajena, y 404/403 en la API sobre nueve rutas ajenas |
| E · Reglas | ✅ | R1 verificada también por la interfaz (D-16.193); el nombre único por company, con 🔴 |
| G · Pruebas | ✅ | **894 unitarias** (sin base) y **542 de integración**, una más: la 🔴 del nombre por company |
| H · Documentación | ✅ | Estrategia de pruebas, `app-cliente.md` (el 409 y por qué es por company), ESTADO con «tenant cruzado ✓» en las 15 filas |
| I · Duplicación | ✅ | `Found 0 clones` |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 561 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 528 skipped (547)
      Tests  894 passed (894)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  542 passed | 5 skipped (547)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```
