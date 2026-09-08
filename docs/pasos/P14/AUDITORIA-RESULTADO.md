# P14 — Resultado de auditoría

**Paquete:** P14 — Capa visual · **Fecha:** 2026-09-08 · **Resultado:** ✅ los doce checks en verde

---

## A. Arquitectura

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| A1 | La regla de dependencia se respeta | ✅ | `audit:arch` — `✔ no dependency violations found (291 modules, 1284 dependencies cruised)` |
| A2 | **El paquete no toca `domain` ni `application`** | ✅ | `git diff --stat` no lista un solo archivo bajo `apps/api/`. Es el criterio de aceptación de P14 |
| A3 | La capa de UI existe y está separada | ✅ | `componentes/ui/` con `Marca`, `Tabla` y `Estados`. Antes de P14 no existía |
| A4 | La apariencia no vive en los archivos que traen datos | ✅ | `grep -rn "style={{" apps/web/src` → tres coincidencias, **las tres dentro de comentarios** |

## B. Código

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| B1 | Compila en modo estricto máximo | ✅ | `audit:types` sobre los cuatro proyectos |
| B2 | Sin `any`, `@ts-ignore` ni `eslint-disable` | ✅ | `audit:forbidden` — **34 reglas sobre 359 archivos** |
| B3 | Complejidad, profundidad y tamaño de función | ✅ | `audit:complexity` sin avisos |
| B4 | Sin duplicación | ✅ | `audit:duplication` — `Found 0 clones` |
| B5 | Sin código muerto | ✅ | `audit:deadcode` (knip) sin hallazgos |
| B6 | Textos visibles en el archivo de recursos (D11) | ✅ | Se sacaron dos que estaban escritos dentro de la pantalla de costeo: `sinPrecio` y `sinDato` |

## C. Seguridad

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| C1 | Sin secretos en el diff | ✅ | `audit:secrets` sobre `**/*`, incluidos los seis `.woff2` |
| C2 | Cabeceras de seguridad | ✅ | `audit:sec-headers` — 18 pruebas |
| C3 | **El navegador no habla con ningún tercero** | ✅ | Fuentes autoalojadas en `public/fuentes/`. Cero peticiones a `fonts.gstatic.com`; la CSP se queda en `self` |
| C4 | Sin dependencias nuevas | ✅ | `apps/web/package.json` sin cambios: sigue en `next`, `react`, `react-dom` |
| C5 | Vulnerabilidades | ✅ | `audit:deps` — sin vulnerabilidades altas fuera de las 4 aceptadas |
| C6 | Licencias de lo que se redistribuye | ✅ | SIL OFL 1.1 verificada para Inter e IBM Plex Mono, con el texto junto a los archivos. Cierra un pendiente que el propio manual declaraba sin verificar |

## D. Base de datos

**No aplica.** El paquete no añade migraciones ni consultas.
`audit:migrations` sigue en verde: **13 migraciones reversibles y con RLS**.

## E. Reglas de negocio

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| E1 | R1–R14 intactas | ✅ | Ninguna línea de `apps/api` cambia; las 898 pruebas pasan sin modificarse |
| E2 | **El frontend sigue sin calcular nada** | ✅ | `no-restricted-syntax` en `eslint.config.mjs` sigue prohibiendo `parseFloat` y `Number()` sobre campos de la API, y `audit:lint` pasa |
| E3 | El semáforo compara decimales como cadena | ✅ | `claseDelFoodCost` usa `localeCompare` numérico; lo único que P14 cambió es que devuelve una clase en vez de un color |

## F. Frontend

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| F1 | **Cero estilos literales en componentes** (§10) | ✅ | Cero `style={{…}}` y cero `var(--…)` fuera de las hojas de estilo |
| F2 | Todo valor sale del manual | ✅ | Cada bloque de `tokens.css` cita su página. Las dos derivaciones —borde y radio— llevan la regla del manual con la que se derivaron |
| F3 | La lectura del manual es correcta | ✅ | **Los seis ratios de contraste que publica se recalcularon y dan sus mismas cifras** hasta el segundo decimal |
| F4 | Objetivo táctil de 44 px | ✅ | `--tactil` en `button`, `input`, `select` y `.nav-enlace` |
| F5 | Cuerpo de 16 px y contraste de 14,58:1 | ✅ | `--texto-base: 1rem`; Pizarra sobre Cloud Dancer |
| F6 | Estados de carga, vacío y error en toda vista | ✅ | `componentes/ui/Estados.tsx`, usados por las cuatro pantallas con datos |
| F7 | El foco se ve | ✅ | `:focus-visible` con contorno de 2 px. No existe ningún `outline: none` |
| F8 | Sin desbordamiento horizontal de la página | ✅ | **Medido**: `scrollWidth === clientWidth` a 500 px y a 320 px. Las tablas se desplazan dentro de su marco |
| F9 | Se ve lo que se dice que se ve | ✅ | Capturas con Chrome sin cabeza del logotipo, `/entrar`, `/sucursal`, la barra y la tabla, a escritorio y a móvil |

## G. Pruebas

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| G1 | **Todas en verde sin modificarse** | ✅ | **585 unitarias** + **313 de integración**, 5 saltadas con motivo (INC-016). Es criterio de aceptación de P14 y se cumple: el diff no toca ni un `.spec.ts` |
| G2 | El guardián del check ampliado | ✅ | Se provocó la violación: `FALLO — 2 infraccion(es)` en `ui/Tabla.tsx`, con línea. Ver «Correcciones» |
| G3 | Presupuestos de rendimiento | ✅ | Sin cambio: consolidado p95 480,2 ms de 800 |

## H. Documentación

| # | Punto | Resultado |
|---|---|---|
| H1 | `CONSTRUCCION.md` completo | ✅ |
| H2 | ADR por decisión relevante | ✅ `ADR-019`, con las seis |
| H3 | Diagrama Mermaid | ✅ en `CONSTRUCCION.md` |
| H4 | Incidencias | ✅ **INC-007 sube a 10 recurrencias**, con su caso 10 escrito |
| H5 | `CHANGELOG.md` | ✅ |
| H6 | `ESTADO.md` y `DECISIONES.md` | ✅ D1 pasa a ✅ |

---

## Salida de `npm run audit`

```
audit:types        OK — cuatro proyectos, modo estricto máximo
audit:lint         OK — sin avisos, con --no-inline-config
audit:forbidden    OK — 34 reglas sobre 359 archivos
audit:arch         ✔ no dependency violations found (291 modules, 1284 dependencies cruised)
audit:deadcode     OK — knip sin hallazgos
audit:complexity   OK
audit:duplication  Found 0 clones
audit:migrations   OK — 13 migracion(es) reversibles y con RLS
audit:secrets      OK
audit:deps         OK — sin vulnerabilidades altas fuera de las 4 aceptadas
audit:sec-headers  OK — 18 pruebas
audit:tests        OK — 585 unitarias (sin base) + 313 de integración
```

---

## Correcciones hechas durante la auditoría

### 1. `audit:forbidden` no había examinado nunca un archivo del frontend

**Lo destapó el contador, por no moverse.** Los patrones decían
`apps/*/src/**/*.ts` y ninguno `.tsx`: las 34 reglas nunca miraron las 2.000
líneas que construyó la Fase C.

Corregido en los seis archivos de reglas → `apps/*/src/**/*.{ts,tsx}`. El
contador pasa de **346 a 359**, que son los 13 `.tsx` exactos.

**Guardián, obligatorio al ampliar el alcance de un check:**

```
# con un @ts-ignore y un `const colado: any` metidos en ui/Tabla.tsx
audit:forbidden  FALLO — 2 infraccion(es)
     apps/web/src/componentes/ui/Tabla.tsx:23  const colado: any = 1;
     apps/web/src/componentes/ui/Tabla.tsx:22  // @ts-ignore
# revertido
audit:forbidden  OK — 34 reglas sobre 359 archivos
```

Es la décima recurrencia de INC-007 y está escrita ahí como caso 10.

### 2. La barra de navegación se partía en dos filas

`--f6` (144 px) es el «margen lateral» del manual, pero de una lámina de
1600 × 900. En una barra a 1280 px no deja sitio a la navegación. Se pasó a
`--f3`. Lo encontró una captura.

### 3. Dos correcciones de CSS que no corregían nada — revertidas

Se añadieron `minmax(0, 1fr)` y `min-width: 0` contra un desbordamiento
horizontal deducido de una captura. **Medido, el desbordamiento no existía**: la
maqueta de prueba no llevaba `meta viewport`. `scrollWidth` daba idéntico con y
sin las reglas, a 500 y a 320 px.

Se revirtieron las dos. Queda una nota que dice por qué no lleva el remiendo y
que se midió. **Un comentario que dice «esto evita un fallo» cuando no lo evita
es peor que no tener comentario.**
