# P16 → P20 — Documento de construcción de la pasada

**Pasada:** P16 → P20 — la aplicación completa · **Inicio:** 2026-09-09 · **Estado:** 🟡 en curso

> Un documento por pasada, con una sección por commit. Los paquetes de API (P16-A1, A2, B, C y P20)
> llevan además su carpeta propia con `CONSTRUCCION.md` y `AUDITORIA-RESULTADO.md` completos, como
> cualquier paquete. El plan aprobado, versión 6, está en [`PLAN.md`](PLAN.md); las decisiones
> cerradas, en `ESTADO.md` → «Pasada P16 → P20».

---

## Por qué existe la pasada

El backend está completo —36 escrituras, tres barreras, 585 + 313 pruebas— y desplegado en local
con marca. **La interfaz usaba 5 de las 41 rutas, y solo dos escribían.** Un dueño de restaurante no
podía dar de alta un insumo, escribir una receta, subir un precio ni registrar la compra de hoy. No
era un producto que se le entregue a un restaurante: era un motor con un visor encima.

El usuario decidió construirlo todo en una pasada, como Noctis Commerce y con lo que trae la
referencia visual de `docs/Sistema ejemplo/`, con parada de entrega al piloto tras las pantallas
operativas y cinco evidencias.

---

## Commit 0 — Tooling · 2026-09-09

### Objetivo

Dejar registradas las 47 decisiones (U1–U8, D-16.1…D-16.39) **antes del primer commit de código**,
y poner los tres guardianes del frontend y el medidor de bundle **antes de la primera pantalla
nueva**. Una regla que llega después de treinta pantallas encuentra treinta infracciones y se acaba
relajando; la que llega antes no encuentra ninguna y se queda.

### Plan aprobado

Fase 0 del plan: `ESTADO.md` gana la sección «Pasada P16 → P20» con las decisiones, el tablero y la
nota de P17/P18/P19 diferidos por decisión de producto. Tooling: tres reglas de `audit:forbidden`
para `apps/web/src/**/*.{ts,tsx}` con guardián, y `scripts/medir-bundle.mjs` con presupuesto
200 KiB de piso / 350 KiB por pantalla. El glob `.tsx` de `audit:complexity` va en el commit
«Armazón», que es el que crea los primeros componentes que lo necesitan.

### Qué se construyó

| Archivo | Qué |
|---|---|
| `ESTADO.md` | Sección «Pasada P16 → P20»: por qué, dónde está la referencia visual, tablero por commit, U1–U8, D-16.1…D-16.39, P17/P18/P19 con sus preguntas abiertas, las cinco evidencias de la parada. El encabezado dice que hay fase en curso |
| `docs/pasos/P16/PLAN.md` | El plan aprobado, copiado del archivo de planificación **para que sobreviva a una compactación** (D-16.39): antes vivía fuera del repositorio |
| `tools/audit/rules/frontend.rules.mjs` | **Tres reglas nuevas**, registradas en `forbidden.mjs`: `no-fecha-a-medianoche` (INC-013), `no-number-en-frontend` (CLAUDE.md §3, cierra `parseInt`, `Number(variable)` y `.toNumber()` que `no-restricted-syntax` deja pasar) y `no-tipti` (D8). De 36 reglas a 39 (y a **40** con la de INC-021, abajo); el contador de archivos pasa de 360 a **361**, y el +1 es exactamente `scripts/medir-bundle.mjs`, que las reglas de `scripts/**` examinan desde que existe (INC-007 caso 10: el número se mueve cuando el repositorio gana un archivo, y aquí se movió) |
| `scripts/medir-bundle.mjs` · `npm run medir-bundle` | Lee el último build de `apps/web` y suma, por ruta, los chunks de JavaScript que el navegador baja para pintarla: el piso (`rootMainFiles`) más los del `page_client-reference-manifest.js` de esa ruta. Imprime bruto y gzip, y **el presupuesto se exige sobre gzip** |
| `.gitignore` | `docs/Sistema ejemplo/` fuera de git (D-16.39) |
| `docs/AUDITORIA.md` I9 | El presupuesto de bundle pasa de «solo P12/P13» a «todo commit que toque `apps/web`», con el comando |
| `package.json` · `package-lock.json` | **`overrides: { multer: "2.3.0" }`** y la entrada del lock trasplantada a 2.3.0. Cierra los cuatro CVE altos de `multer@2.2.0` que `audit:deps` paró; ver «Problemas» e INC-021 |
| `tools/audit/rules/repo.rules.mjs` | Regla nueva **`override-de-npm-reflejado-en-el-lock`**: cada `overrides` de la raíz tiene que verse en `package-lock.json`, porque npm lo ignora en silencio cuando ya hay lock (INC-021) |
| `docs/incidencias/INC-021` | La ficha, con la prevención automatizada |

### Decisiones técnicas tomadas

| # | Decisión | Alternativas descartadas | Razón |
|---|---|---|---|
| 1 | **El presupuesto de bundle se mide en gzip**, y el script imprime también el bruto | Medir en bruto (piso 429 KiB, imposible bajo 200); medir con el tamaño que imprime `next build` (Next 16 ya no lo imprime) | El servidor autocontenido de Next comprime por defecto (`compress: true`) y Caddy solo reenvía: lo que viaja es gzip. El piso real son **126,9 KiB** comprimidos; la pantalla más cara, 138,6. El presupuesto 200/350 deja margen para el armazón y el kit, no para una dependencia nueva |
| 2 | **Los chunks de una ruta salen del manifiesto por ruta, no del HTML prerenderizado** | Leer los `<script>` del `.html` | Una ruta dinámica (`/insumos/[id]`) no tiene HTML y sí manifiesto. Verificado: para las siete rutas actuales, manifiesto y HTML dan el mismo conjunto salvo el polyfill `noModule`, que solo baja un navegador antiguo y se excluye a propósito |
| 3 | **`medir-bundle` mide el último build; no construye** | Que el script lanzara `next build` | Construir tarda medio minuto y ya lo hace `npm run build`. Para que un build viejo no pase por reciente, imprime el `BUILD_ID` y la hora del manifiesto |
| 4 | **Caddy no gana `encode`** en este commit | Añadir `encode zstd gzip` al `Caddyfile` | Next ya comprime; añadirlo en el proxy sería comprimir dos veces o, peor, cambiar el despliegue sin repetir el ensayo que P14b enseñó a exigir |
| 5 | **`docs/Sistema ejemplo/` se ignora, no se versiona** (D-16.39) | Commitearla como referencia | Es una app Vite ajena con su `package.json`, `bun.lock` y `server.ts`. Bajo los doce checks ya ponía `audit:forbidden` en rojo (`"start": node dist/server.cjs` → no existe). Vive en disco como el Excel de referencia, y `ESTADO.md` dice dónde |
| 6 | `no-fecha-a-medianoche` **no marca `new Date()` sin argumentos** | Prohibir `new Date` entero | Las tres pantallas actuales lo usan para el mes por defecto; el instante actual no es una fecha a medianoche. Lo que se marca es `T00:00…` en una cadena, `new Date(aaaa, mm, …)` y `setHours(0)` |
| 7 | **`multer` se fuerza a 2.3.0 con `overrides`, no se acepta en `ACEPTADAS`** | Aceptar el aviso con motivo; subir NestJS | `multer` viaja a la imagen de producción (`@nestjs/platform-express` lo importa al arrancar), así que no cumple el único criterio de `ACEPTADAS`. Toda la línea 11 de NestJS lo fija en 2.2.0 y la 12 es ESM (fuera de ADR-001). El override deja `core`/`common`/`platform-express` en 11.2.3 y cambia solo el paquete vulnerable. **Se retira cuando `platform-express` fije `multer ≥ 2.3.0`** |

### Pruebas — los guardianes

Salida literal, con la violación metida a mano en `ui/Tabla.tsx` y revertida después (el diff de
`apps/web` queda vacío):

```
=== LINEA BASE ===
audit:forbidden  OK — 39 reglas sobre 360 archivos
=== GUARDIAN: cinco lineas coladas en ui/Tabla.tsx ===
audit:forbidden  FALLO — 5 infraccion(es)
  [no-fecha-a-medianoche]
     apps/web/src/componentes/ui/Tabla.tsx:38  const colado1 = new Date('2026-09-01T00:00:00Z');
     apps/web/src/componentes/ui/Tabla.tsx:39  const colado2 = new Date(2026, 8, 1);
  [no-number-en-frontend]
     apps/web/src/componentes/ui/Tabla.tsx:40  const colado3 = parseInt('   );
     apps/web/src/componentes/ui/Tabla.tsx:41  const colado4 = Number(colado3);
  [no-tipti]
     apps/web/src/componentes/ui/Tabla.tsx:42  const colado5 = 'precio de tipti';
=== REVERTIDO ===
audit:forbidden  OK — 39 reglas sobre 360 archivos
```

(El extracto de `parseInt('   )` sale así porque la regla enmascara las cadenas antes de buscar:
es lo que evita que el texto de ayuda de `decimales.ts`, que nombra `Number()` para explicar por qué
no se usa, cuente como infracción.)

`override-de-npm-reflejado-en-el-lock`, con `overrides.multer` puesto a mano en 2.4.0 y revertido:

```
audit:forbidden  FALLO — 1 infraccion(es)
  [override-de-npm-reflejado-en-el-lock]  Un `overrides` de la raiz cuya version no es la que `package-lock.json` instala
     package-lock.json  overrides pide multer@2.4.0, el lock instala node_modules/multer en 2.3.0
exit=1
=== REVERTIDO ===
audit:forbidden  OK — 40 reglas sobre 361 archivos
```

`medir-bundle`, con el presupuesto bajado a mano a 100/135 y revertido:

```
  PASA    126.9 KiB gzip    428.6 KiB bruto  (piso, comun a todas)
  PASA    138.2 KiB gzip    462.8 KiB bruto  /costeo
  ok      133.6 KiB gzip    449.4 KiB bruto  /entrar
  …
medir-bundle  FALLO — alguna pantalla se pasa del presupuesto
exit=1
```

### Problemas encontrados

| Problema | Solución | Tiempo perdido |
|---|---|---|
| `audit:forbidden` estaba en rojo **antes de tocar nada**: el escáner lista también los archivos nuevos sin versionar, y `docs/Sistema ejemplo/package.json` tiene un `start` que apunta a un `dist/` que no existe | Ignorarla en git (D-16.39). No es incidencia: el mensaje decía exactamente qué pasaba | 5 min |
| Turbopack no escribe `app-build-manifest.json`, que era la fuente prevista para medir por ruta | Se mide con `build-manifest.json` (`rootMainFiles`) más el `page_client-reference-manifest.js` de cada ruta, y se contrastó contra los `<script>` del HTML prerenderizado | 15 min |
| El `.next` que había era de desarrollo (`next dev`), sin `server/app` | Se construyó en producción con `NEXT_PUBLIC_API_URL=/api`, que es lo que el script exige y dice | — |
| **`audit:deps` en rojo por cuatro CVE altos nuevos de `multer@2.2.0`** (publicados después de P14b; `@nestjs/core` y `terminus` aparecían por la cadena). Y el arreglo se resistió: con `overrides` en la raíz, `npm install` decía «up to date» y dejaba 2.2.0; `--force`, `dedupe` y el override en el workspace, igual; borrar la entrada del lock hizo que npm **descartara `multer` entero** y siguiera sin quejarse; npm 12 lo mismo | Aislado con dos experimentos: sin lockfile npm resuelve 2.3.0 bien (también con workspaces); el bloqueo es que **con lock existente no re-resuelve la arista sobreescrita**. Como 2.3.0 declara exactamente las mismas dependencias que 2.2.0, se trasplantó al lock la entrada que npm resolvió sin lock, y se verificó con `npm ci --ignore-scripts` en copia limpia: instala 2.3.0, sin copia anidada, lock idéntico. `npm ls` la marca `invalid` por el mismo bug de carga; es cosmético y está dicho en INC-021 | 45 min |

### Cómo probar

```sh
npm run audit                                   # 39 reglas; guardián arriba
npm run build --workspace @costeo/web && npm run medir-bundle
```

### Incidencias registradas en este commit

| Incidencia | Síntoma | ¿Se automatizó la prevención? |
|---|---|---|
| INC-021 | `npm install` dice «up to date» y la dependencia sigue en la versión vieja aunque `package.json` la sobreescribe con `overrides` | ✅ `override-de-npm-reflejado-en-el-lock` en `audit:forbidden`, con guardián |

### Deuda y pendientes

**El override de `multer` es deuda con condición de salida:** se retira cuando `@nestjs/platform-express` fije `multer ≥ 2.3.0`. Está en `ESTADO.md`. Lo demás: El glob `.tsx` de `audit:complexity` es del commit «Armazón», y está en el plan.
