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

---

## Armazón (pantalla 1) · 2026-09-13

### Objetivo

Que las treinta pantallas que faltan sean **una carpeta y una línea**: el esqueleto común —cabecera,
barra lateral por grupos, guardia de sucursal, permisos, mes— y el kit con el que se lee y se escribe,
con las cuatro pantallas que ya existían migradas a él y partidas por debajo de los límites de
complejidad que desde este commit también se miden en los `.tsx`.

### Plan aprobado

«Commit Armazón» del plan (`PLAN.md`): `app/(app)/layout.tsx` + `armazon/*` + `navegacion.ts` +
`lib/permisos.tsx` + `lib/periodo.ts` + `lib/fechas.ts` + fábrica `seccion(permiso)`; `useLectura` +
`Vista` y cada primitiva con su primer consumidor; `git mv` de las cuatro páginas con partición ≤ 40
líneas; glob `.tsx` en `audit:complexity` con guardián; `/` → `/inicio`. **Lo último se movió al
commit «Inicio»** (D-16.136): con `typedRoutes` no compila un `redirect` a una ruta que no existe.

### Qué se construyó

| Archivo | Qué |
|---|---|
| `app/(app)/layout.tsx` | El grupo de rutas autenticado: `ProveedorDePermisos` → `Suspense` → `Armazon`. `/entrar` y `/sucursal` quedan fuera |
| `app/(app)/{costeo,menu,ventas,inventario}/layout.tsx` | Una línea cada uno: `export default seccion('<permiso>')` |
| `app/(app)/{costeo,menu,ventas,inventario}/page.tsx` | Movidas con `git mv`. **Costeo y menú** leen con `useLectura` + `Vista`; el menú, con el mes de la URL y su fila extraída (`FilaDelMenu`). **Ventas**: `useVentasDelMes` (carta + mes + anterior en paralelo, con `useCarga`), `useCapturaDeVentas`, `RejillaDeVentas`, `BarraDeGuardado`, `FilaDeVenta`. **Inventario**: `conteoDelMes`, `conciliacionSiSePuede`, `useConteoDelMes`, `ConteoAbierto`, `AccionesDelConteo`, `HojaDeConteo`, `FilaParaContar`, `FilaConciliadaDeLaTabla` |
| `componentes/armazon/` | `Armazon` (cabecera + lateral + lámina; la lámina enseña el error si la sesión no se pudo leer), `Cabecera` (marca, sucursal, mes si la sección lo tiene, salir), `BarraLateral` (grupos filtrados por permiso; el mes viaja en el enlace), `SelectorDeSucursal`, `SelectorDeMes`, `Permitido` + `seccion`, `navegacion.ts` (el registro) |
| `componentes/Marco.tsx` | Adelgaza a lo que es de cada pantalla: título, ayuda, acciones y la guardia de sucursal. Ya no pinta la barra ni el `main` |
| `componentes/ui/Vista.tsx` · `CeldaEditable.tsx` · `Campo.tsx` | Los cuatro estados de una lectura; la casilla de una rejilla de captura; el campo de texto con etiqueta (primer consumidor: `Entrar`) |
| `lib/useLectura.ts` · `lib/useEnvio.ts` · `lib/rejilla.ts` | `useCarga`/`useLectura` con el origen del resultado; la escritura con su estado; Enter y flechas por la rejilla |
| `lib/permisos.tsx` | `ProveedorDePermisos`, `usePermisos`, `useEntrarAlCaducar` |
| `lib/fechas.ts` · `lib/periodo.ts` | El mes de Ecuador, `mesDeTexto` sin parsear, `mesAnterior`, `consultaDelMes`; `usePeriodo` sobre la URL |
| `lib/api.ts` | `alCaducarSesion` (devuelve cómo quitarlo), `mensajeDe`, `codigoDe` y **la mutación sin sesión que sale sin token** (INC-023) |
| `lib/decimales.ts` | `sinCerosDeSobra` |
| `app/entrar/page.tsx` · `app/sucursal/page.tsx` | Partidas: `useEntrada` + `FormularioDeEntrada`; `/sucursal` con `useLectura` + `Vista` y `useEntrarAlCaducar` |
| `styles/global.css` | `.aplicacion`, `.armazon`, `.lateral`, `.barra__contexto`, `.selector-compacto`, `.barra__interior--ancha`; todo con tokens |
| `textos/es.ts` | Navegación, etiqueta de sucursal, nombres de los meses, mes sin abrir |
| `apps/web/package.json` | `"typecheck": "next typegen && tsc --noEmit"` (INC-007, caso 13) |
| `eslint.complexity.config.mjs` | El glob `'apps/*/src/**/*.tsx'` |
| `tools/doctor.mjs` | «Puertos de la base (INC-015)»: `SSLRequest` a cada `host:puerto` de las cadenas de conexión; `revisar` pasa a asíncrono |
| `apps/api/test/soporte/guardia-sin-base.ts` | Vigila **los puertos de las cadenas de conexión** (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PGBOUNCER_DATABASE_URL`, del entorno o del `.env` leído sin cargarlo), además de `POSTGRES_PORT` y el 5432. Antes: `POSTGRES_PORT ?? 5432` de un entorno sin `.env` |
| `tools/audit/tests.mjs` | La sonda pregunta al host y al puerto de `MIGRATION_DATABASE_URL`, que es donde conectan las de integración. Antes: `POSTGRES_PORT ?? 5432` sin leer el `.env` |
| `docs/decisiones/ADR-020`, `ADR-022` | El armazón; cómo leen y escriben las pantallas |
| `docs/incidencias/INC-023` · INC-015 · INC-007 | La nueva y las dos recurrencias |

### Decisiones técnicas tomadas

D-16.131…D-16.144 en `ESTADO.md`, con su porqué en ADR-020 y ADR-022. Las que más pesan:

| # | Decisión | Alternativas descartadas | Razón |
|---|---|---|---|
| 1 | **Sin sesión, la mutación sale sin token** (D-16.137) | Flag `sinSesion` por llamada; token vacío | El flag es una lista en el cliente que se olvida en la quinta ruta pública (1b trae tres); el token vacío da 403 `CSRF_INVALIDO` donde el error verdadero es `SESION_INVALIDA` |
| 2 | **El resultado de una lectura recuerda su origen** (D-16.131) | Poner a «cargando» en el efecto; cancelar con `AbortController` | Poner el estado en el efecto deja un render con los datos viejos bajo el mes nuevo; abortar no evita que llegue una respuesta que ya estaba en camino, y `llamar` no admite señal. Comparar el origen es una línea y no deja ventana |
| 3 | **El estado editable se monta con los datos** (D-16.139) | Copiar los datos al estado con un `useEffect` | El efecto copia en cada relectura y pisa lo que se estaba escribiendo; montado, se inicializa una vez y `Vista` lo remonta al cambiar de mes |
| 4 | **Dos `select` para el mes** (D-16.134) | `<input type="month">` | Firefox de escritorio lo degrada a texto libre |
| 5 | **`typecheck` con `next typegen`** (D-16.138) | Construir el web en CI | Construir cuesta medio minuto y no es lo que el check dice medir; generar los tipos cuesta un segundo y deja el mismo `tsc` en local y en CI |

### Cómo se verificó — en el navegador, con datos y con tres roles

La pila de producción local (Caddy y el web viejo) no se tocó. Se levantaron **la API compilada en el
puerto 3000 y el build de producción del web en el 3100**, con el tenant de ensayo sintético del
runbook (`duena@`, `gerente@`, `bodega@ensayo.invalid`, dominio `.invalid`) y su catálogo de cinco
ítems, cinco artículos, dos productos y seis líneas de receta, importado con `npm run importar`. Y
Chrome sin cabeza conducido por el protocolo de DevTools desde un guion de la sesión (sin
dependencias: `WebSocket` de Node 24), **entrando por el formulario**, no pegando una cookie.

**33 capturas**: tres roles × 1280 y 360 px × `/sucursal`, `/costeo`, `/menu`, `/ventas`,
`/inventario`, más el menú abierto en móvil. En todas, `scrollWidth ≤ clientWidth` (ninguna desborda).
Lo que enseñan:

| Rol | Barra lateral | `/costeo` · `/menu` · `/ventas` | `/inventario` |
|---|---|---|---|
| Dueña | Análisis (2) + Operación diaria (2) | Datos; en la bodega, costos `0.00` (duda #12) | Hoja + diferencia |
| Gerente (Local Centro) | Las cuatro | Costeo 1,03 / 1,16 / 1,18 · food cost 17,2 % y 26,5 %; rejilla con los dos productos | Hoja + diferencia |
| Bodega (Bodega Norte) | **Solo «Inventario y conteo»** | «Tu usuario no tiene acceso a esta pantalla», también escribiendo la URL | **Hoja sin diferencia** (el 403 de `count.read`) |

**Y la escritura, en el mismo navegador** (gerente):

```
{
  "antes": "Sin cambios que guardar",
  "focoBajo": true,                    ← Enter en la primera casilla lleva el foco a la segunda
  "letrasRechazadas": true,            ← «1a» no entra
  "boton": "Guardar (1)",
  "guardado": true,                    ← «Guardado» tras el POST con versión y token
  "persistido": "29",                  ← tras recargar
  "editable": "297",                   ← y se puede seguir escribiendo (antes: imposible)
  "contado": "1.5",                    ← «1,5» anotado en la hoja, tras recargar
  "contadoEditable": "1.",
  "mesAnteriorEnOctubre": "29"         ← octubre enseña septiembre como mes anterior
}
```

### Guardianes

**El glob `.tsx` de `audit:complexity`** — el árbol de P16-C (`git show HEAD:…`) con la configuración
nueva; con la de HEAD esos archivos no se examinaban y P16-C salió con `audit exit=0`:

```
  37:16  error  Function 'Entrar' has too many lines (79). Maximum allowed is 40
   87:16  error  Function 'Inventario' has too many lines (141). Maximum allowed is 40
   87:16  error  Function 'Inventario' has a complexity of 15. Maximum allowed is 10
  258:1   error  Function 'HojaDeConteo' has too many lines (58). Maximum allowed is 40
   71:16  error  Function 'MenuEngineering' has too many lines (43). Maximum allowed is 40
  171:1   error  Function 'Cuadrante' has too many lines (49). Maximum allowed is 40
  28:16  error  Function 'ElegirSucursal' has too many lines (71). Maximum allowed is 40
  94:16  error  Function 'Ventas' has too many lines (163). Maximum allowed is 40
  94:16  error  Function 'Ventas' has a complexity of 15. Maximum allowed is 10
  35:8  error  Function 'Marco' has too many lines (87). Maximum allowed is 40
✖ 10 problems (10 errors, 0 warnings)
```

Con el árbol de este commit: 0.

**`typecheck` con `next typegen`** — `.next/types` y `next-env.d.ts` borrados, como en un clon limpio,
y una sonda `<Link href="/ruta-que-no-existe">`:

```
--- antes del cambio (tsc a secas): sin salida, en verde
--- ROJO esperado:
✓ Types generated successfully
src/app/sonda-rutas.tsx:5:16 - error TS2322: Type '"/ruta-que-no-existe"' is not assignable to type 'UrlObject | RouteImpl<"/ruta-que-no-existe">'.
--- VERDE esperado (sonda retirada):
✓ Types generated successfully
```

**`doctor`** — con el reenvío roto de verdad, con puertos cerrados y con el 6432 que sí contesta:

```
[ FALLO]  Puertos de la base (INC-015)   localhost:5432 cortada
[ FALLO]  Puertos de la base (INC-015)   localhost:5999 rechazada · localhost:5998 rechazada
[  OK  ]  Puertos de la base (INC-015)   localhost:6432 contestan
```

**La guardia de «unitarias sin base» con la base en otro puerto** — `.env` en el 5442 y una prueba unitaria que abre un socket a ese puerto:

```
=== GUARDIA VIEJA  (POSTGRES_PORT ?? 5432, sin .env)
 ✓  unit  src/sonda-puerto.spec.ts (1 test) 7ms
 Test Files  1 passed (1)                        ← una unitaria que toca la base, en verde
=== GUARDIA NUEVA  (los puertos de las cadenas de conexión)
 ×  sonda del puerto de la base > una unitaria que conecta al puerto de la base del .env
Una prueba del proyecto "unit" intento conectar al puerto 5442 (PostgreSQL).
 Test Files  1 failed (1)
```

Retirada la sonda, las 891 unitarias en verde. La de `audit:tests` se ve en la corrida completa: con
la base en el 5442, sondeó el 5442 y corrió las 536 de integración.

**INC-023 y las filas no editables** no tienen guardián automático —`apps/web` no tiene ejecutor de
pruebas—: su guardián es el recorrido de arriba, hecho antes y después del arreglo (antes: «no
coinciden» con 60 `GET /auth/sesion` y ningún `POST /auth/login`; «19.000000000000» que no admitía
teclas).

### Problemas encontrados

| Problema | Solución | Tiempo perdido |
|---|---|---|
| **«Entrar» no funcionaba desde un navegador sin sesión**, desde P16-A2 | La mutación sin sesión sale sin token (D-16.137). **INC-023** | 15 min |
| **Las filas guardadas de ventas y del conteo no se podían editar**: la API las devuelve a escala de almacenamiento y las casillas solo admiten dígitos o tres decimales | `sinCerosDeSobra` al precargar (D-16.140) | 10 min |
| `tsc` del web en rojo contra un `.next/types/validator.ts` rancio tras el `git mv`; y, al tirar del hilo, **en un clon limpio no comprobaba las rutas tipadas** | `next typegen` antes de `tsc`. INC-007, caso 13 | 10 min |
| **El puerto 5432 del host aceptaba y cortaba** (`Connection terminated unexpectedly`) con la base sana, tras un reinicio de Docker Desktop | Las capturas, por el 6432 de PgBouncer; la comprobación, escrita en `doctor`. **El usuario pidió publicar la base en otro puerto**: `.env` local al 5442 y contenedor recreado (D-16.145); datos intactos, Caddy, web y PgBouncer sin tocar. INC-015, recurrencia 1 | 20 min |
| **Mover el puerto habría dejado ciegos dos checks**: la guardia de «unitarias sin base» y la sonda de `audit:tests` leían `POSTGRES_PORT ?? 5432` de un entorno sin `.env` | Las dos leen las cadenas de conexión. Guardián arriba. INC-007, caso 13 | 15 min |
| El CSV de artículos del ensayo traía la cabecera `ivaTarifa`, que el importador no reconoce (acepta `iva` y sus alias, y el mensaje lo dice) | Copia con `iva`. Pendiente: D-16.44 nombra la columna `ivaTarifa` (abajo) | 5 min |
| En escritorio el fondo de la lateral acababa a media pantalla; en el teléfono la cabecera ocupaba cuatro filas; «MES» pegado al selector de sucursal | `.aplicacion` a alto de ventana y lateral estirada; sucursal y mes a su fila con la etiqueta oculta a la vista; `column-gap`. **Visto en capturas** | 15 min |
| El guion de bash con Python embebido se rompió con las comillas (otra vez) | Los guiones van a archivo con Write | 2 min |

### Cómo probar

```sh
npm run typecheck --workspace @costeo/web     # genera los tipos de rutas y comprueba
npm run audit:complexity                      # ahora también los .tsx
npm run build --workspace @costeo/web && npm run medir-bundle
npm run doctor                                # incluye los puertos de la base
```

Y en el navegador, con el tenant de ensayo del runbook: entrar con cada rol, elegir sucursal, recorrer
las cuatro secciones a 1280 y 360 px, guardar ventas y un conteo, recargar y volver a editar.

### Incidencias registradas en este commit

| Incidencia | Síntoma | ¿Se automatizó la prevención? |
|---|---|---|
| **INC-023** (nueva) | «Entrar» dice «no coinciden» con credenciales correctas | Se eliminó el modo de fallo (no hay lista de rutas públicas que olvidar). Sin prueba automatizada: `apps/web` no tiene ejecutor |
| INC-015, recurrencia 1 | `Connection terminated unexpectedly` en 5432 con la base sana | ✅ `npm run doctor`, con guardián |
| INC-007, caso 13 | `tsc` en verde con un `href` a una ruta que no existe; y dos checks atados al 5432 | ✅ `next typegen` en `typecheck`, el glob `.tsx`, y la guardia y la sonda leyendo las cadenas de conexión; los cuatro con guardián |

### Deuda y pendientes

- **Duda #12**: el costeo de un producto sin receta en la sucursal sale `0.00`.
- **La conciliación del conteo enseña doce decimales** (`3.652173913044`): es de la pantalla 23, que
  la rehace.
- **`/ventas` sigue leyendo `/costeo` entero** para saber qué productos hay: la pantalla 3 lo cambia a
  `GET /productos/ubicaciones`, que existe desde P16-B.
- **A 360 px la tabla de ventas desplaza en horizontal** dentro de su marco y la cabecera «Unidades»
  queda a la derecha del borde. No desborda la página; se revisa con la pantalla 3.
- **D-16.44 nombra la columna del CSV `ivaTarifa`**, y el importador acepta `iva`, `tarifa iva`,
  `iva compra` y `tarifa de iva`, no `ivaTarifa`. El runbook dice `iva`. Se corrige el texto de la
  decisión o se añade el alias en el próximo paquete que toque `imports`.
- Siguen en pie: `DELETE /usuarios/roles` por Caddy (P16-C) y las dudas #9, #10 y #11.

---

## Inicio (pantalla 2) · 2026-09-14

### Objetivo

U2: la primera pantalla tras entrar es el mes de la sucursal de un vistazo —y, para `BODEGA`, qué
reponer—; `/` y la elección de sucursal llevan ahí.

### Qué se construyó

| Archivo | Qué |
|---|---|
| `app/(app)/inicio/page.tsx` · `layout.tsx` | `ResumenDelMes` (nueve indicadores de `GET /analitica/resumen`) si la sesión tiene `analytics.read`; si no, `ReposicionDelMes` (`GET /analitica/reposicion`, lo que hay que reponer primero). La sección pide `replenishment.read`, que tienen todos los roles |
| `componentes/ui/Indicador.tsx` | Etiqueta, cifra, nota y `data-semaforo`: el color lo decide `global.css` con el semáforo de la API |
| `componentes/armazon/navegacion.ts` · `textos/es.ts` | Grupo «General» con Inicio arriba; los textos de la pantalla |
| `componentes/ui/Vista.tsx` + las cinco pantallas | `vacio` pasa a ser `{ esVacio, titulo, ayuda } \| 'nunca'`: un resumen sin estado vacío propio lo declara en vez de pasar un vacío falso |
| `app/page.tsx` · `app/sucursal/page.tsx` | `/` y la elección de sucursal van a `/inicio` (D-16.136) |
| `lib/decimales.ts` | **`conSigno`** —el arreglo de INC-024— y `enPuntos` para la brecha en puntos porcentuales |
| `lib/decimales.spec.ts` · `lib/fechas.spec.ts` | **Las primeras pruebas de `apps/web`**: 20, con `node --test` (ADR-027) |
| `tools/audit/tests.mjs` | Corre las del web tras las unitarias de la API |
| `apps/web/tsconfig.json` · `knip.json` · `eslint.config.mjs` | `allowImportingTsExtensions`; las pruebas como entrada de knip; `describe`/`it` de `node:test` fuera de `no-floating-promises` |
| `styles/global.css` | `.indicadores` (rejilla que baja de fila) e `.indicador[data-semaforo]` |

### Decisiones

D-16.148…D-16.151 en `ESTADO.md`; la de las pruebas, con su porqué, en **ADR-027**.

### Cómo se verificó

**En el navegador** (build de producción, tenant de ensayo; se registraron dos compras sintéticas en la
Bodega Norte para que `BODEGA` tuviera algo que reponer):

| Rol | `/inicio` |
|---|---|
| Gerente (Local Centro, septiembre) | Venta neta 199.22 · food cost real **16,9 %** en verde (teórico 16,9 %) · brecha 0,0 pp · utilidad **164.96** en verde, margen de seguridad 100,0 % · prime cost 17,2 % · varianza 0.00 · cobertura «—» con «Sin conteo» · 3 por reponer · 0 sin costo |
| Dueña (Bodega Norte) | Venta 0.00 y el resto «—»: la bodega no vende |
| Bodega (Bodega Norte) | «Qué reponer»: Arroz · Bien, Cebolla paitena · Bien. **Sin cantidades**, y sin el resumen |

Ninguna captura desborda a 360 px. `/` responde `307 → /inicio`. Ajustado **mirando las capturas**: la
cifra no arrancaba a la misma altura en tarjetas vecinas (`align-content: start`), y «Sin conteo» iba
como cifra en dos líneas (ahora es la nota bajo la raya).

### Guardianes

```
=== W1-redondear-sin-signo: apps/web/src/lib/decimales.ts
    $ node --test src/**/*.spec.ts -> exit 1
      ✖ un negativo con acarreo conserva el signo (antes: 100.00) (3.5811ms)
      ✖ un cero no lleva signo (0.6636ms)
      ✖ el signo — el `-` no es un dígito (8.5992ms)
      ℹ pass 18
      ℹ fail 2
      ✖ failing tests:
      ✖ un negativo con acarreo conserva el signo (antes: 100.00) (3.5811ms)
      ✖ un cero no lleva signo (0.6636ms)

=== W2-porcentaje-sin-signo: apps/web/src/lib/decimales.ts
    $ node --test src/**/*.spec.ts -> exit 1
      ✖ un porcentaje negativo corre la coma sin ceros de más (antes: -007,5 %) (1.527ms)
      ✖ el signo — el `-` no es un dígito (4.7826ms)
      ℹ pass 19
      ℹ fail 1
      ✖ failing tests:
      ✖ un porcentaje negativo corre la coma sin ceros de más (antes: -007,5 %) (1.527ms)

=== W3-audit-tests-ve-el-web: apps/web/src/lib/fechas.spec.ts
    $ node tools/audit/tests.mjs --solo-unitarias -> exit 1
      ✓  unit  src/shared/infrastructure/http/error.filter.spec.ts (20 tests) 23ms
      ✓  unit  src/shared/domain/errors/valor-en-mensaje.spec.ts (6 tests) 7ms
      ✖ es la consulta que piden la API y la URL (1.3403ms)
      ✖ consultaDelMes (1.6839ms)
      ℹ pass 19
      ℹ fail 1
      ✖ failing tests:
      ✖ es la consulta que piden la API y la URL (1.3403ms)
      audit:tests  FALLO — pruebas de apps/web en rojo

=== W4-lint-mira-las-pruebas-del-web: eslint.config.mjs
    $ npx.cmd eslint apps/web/src/lib/fechas.spec.ts --max-warnings=0 --no-inline-config -> exit 1
      10:1  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
      11:3  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
      17:3  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
      … (diez errores, uno por cada describe/it del archivo)
```

### Problemas encontrados

| Problema | Solución | Tiempo |
|---|---|---|
| **`comoImporte('-9.999')` daba `100.00`** y un −7,5 % salía `-007,5 %` | `conSigno` y las pruebas del web. **INC-024** | 10 min |
| El guion de aplicación se paró a medias: el ancla de `no-empty` está dos veces en `eslint.config.mjs` | Ancla única y segundo guion con los pasos que faltaban; nada quedó aplicado dos veces | 5 min |

### Incidencias registradas

| Incidencia | Síntoma | ¿Prevención automatizada? |
|---|---|---|
| **INC-024** | Un margen negativo se enseña como `100.00` | ✅ `lib/decimales.spec.ts` en `audit:tests`, con guardián |

### Deuda y pendientes

- La tabla de reposición de `BODEGA` enseña «Bien» para `OK`: la API colapsa `SIN_CONSUMO` y `OK`
  (§4.3), así que «Bien» también significa «no se consume». Es lo que la API puede decir sin revelar el
  teórico.
- Siguen en pie: dudas #9, #10, #11 y #13; `DELETE /usuarios/roles` por Caddy.

---

## Pantalla 1b — Olvidé mi contraseña · Restablecer · 2026-09-14

### Qué se construyó

| Archivo | Qué |
|---|---|
| `app/olvide/page.tsx` | Correo → `POST /auth/password/olvido` → **la misma frase exista o no la cuenta**. El 429 se enseña con el mensaje de la API (dice cuánto esperar) |
| `app/restablecer/page.tsx` | `?token=` → contraseña y repetición → `POST /auth/password/restablecimiento`. Sin token: «enlace incompleto». **Antes de enviar**, que tenga 12 caracteres y que coincidan: la API gasta el token antes de mirar la contraseña, y un error de tecleo obligaría a pedir otro enlace. Cualquier 400 ofrece «Pedir otro enlace»; un 429 deja el formulario, porque el límite se comprueba antes de tocar el token |
| `app/entrar/page.tsx` | «¿Olvidaste tu contraseña?» |
| `lib/useEnvio.ts` | Expone `codigo`, como `useLectura` |
| `lib/api.ts` | **`cuerpoDe`**: un 202 sin cuerpo ya no revienta (INC-025). Importe `./csrf.ts` y `ErrorDeApi` con campos explícitos, para cargarlo con `node --test` |
| `lib/api.spec.ts` | **11 pruebas del transporte** con `fetch` simulado: 202/204 vacíos, JSON, fallos con código y mensaje, sin red, **sin sesión la mutación sale sin cabecera (INC-023)**, con sesión lleva el token, una lectura no lo pide, reintento único ante `CSRF_INVALIDO` y sin bucle, el aviso de sesión caída solo al registrado |
| `apps/web/tsconfig.json` | **`erasableSyntaxOnly`**: la sintaxis que Node no sabe quitar falla en `tsc` |
| `textos/es.ts` · `styles/global.css` | Los textos de la recuperación; `.enlace` |

### Decisiones

D-16.152…D-16.155 en `ESTADO.md`.

### Cómo se verificó — en el navegador

Build de producción, 360 px, con la dueña del tenant de ensayo; el enlace se leyó del outbox, donde
existe en claro solo mientras el correo está en vuelo:

```
enlaceEnEntrar     true
pedidoInexistente  «Si ese correo tiene una cuenta activa, te llegará un enlace…»
pedidoExistente    «Si ese correo tiene una cuenta activa, te llegará un enlace…»   ← mismaFrase: true
sinToken           «Este enlace está incompleto. Ábrelo tal cual llegó en el correo, o pide otro.»
tokenInventado     «El enlace de restablecimiento no es valido o ya caduco. Pide uno nuevo.» + Pedir otro enlace
corta              «Tiene menos de 12 caracteres. Alárgala antes de guardar…»          (no se envió)
noCoinciden        «Las dos contraseñas no coinciden.»                                  (no se envió)
hecho              «Listo. Tu contraseña cambió y las demás sesiones se cerraron…»
reutilizado        «El enlace … no es valido o ya caduco.» + Pedir otro enlace          (un solo uso)
entraConLaNueva    true
```

**La primera pasada falló** en los dos «pedido»: la pantalla enseñaba «Failed to execute 'json' on
'Response': Unexpected end of JSON input» (INC-025). La contraseña de ensayo se devolvió a la original
con `POST /auth/password` tras cada pasada.

### Guardianes

```
=== W5-cuerpo-vacio-como-json: apps/web/src/lib/api.ts -> exit 1
      ✖ un 202 sin cuerpo es `undefined`, no un error de JSON (INC-025) (27.4865ms)
      ✖ un 204 también (0.6583ms)
      ✖ el cuerpo de una respuesta que salió bien (35.2827ms)
      ℹ pass 9
      ℹ fail 2
      ✖ failing tests:

=== W6-sin-sesion-el-error-sube: apps/web/src/lib/api.ts -> exit 1
      ✖ sin sesión, la mutación sale SIN cabecera y llega a la API (INC-023) (0.9772ms)
      ✖ el token anti-CSRF (5.497ms)
      ℹ pass 10
      ℹ fail 1
      ✖ failing tests:
      ✖ sin sesión, la mutación sale SIN cabecera y llega a la API (INC-023) (0.9772ms)

=== erasableSyntaxOnly: una clase con `public readonly` en el constructor, colada en lib/csrf.ts
src/lib/csrf.ts:38:22 - error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
```

### Problemas encontrados

| Problema | Solución | Tiempo |
|---|---|---|
| **Un 202 sin cuerpo reventaba al leerse como JSON** | `cuerpoDe`. **INC-025** | 5 min |
| `api.spec.ts` no cargaba: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` («parameter property is not supported in strip-only mode») | `ErrorDeApi` con campos explícitos y `erasableSyntaxOnly`, que lo caza en `tsc` | 5 min |

### Deuda y pendientes

- **Los mensajes de `iam/domain/errores.ts` van sin tildes** («no es valido o ya caduco») y llegan tal
  cual a la pantalla. Es texto de la API; se corrige en el próximo paquete que toque `iam`.
- El largo mínimo (12) está en el cliente como **ayuda**, con su porqué: si la API lo cambia, manda su 400.

---

## Pantalla 3 — Ventas (arreglo) · 2026-09-14

### Qué se construyó

| Archivo | Qué |
|---|---|
| `app/(app)/ventas/page.tsx` | **La carta sale de `GET /productos/ubicaciones`** y no de `GET /costeo`: la rejilla costeaba la carta entera —recetas, precios, cascada— solo para saber qué productos hay y cómo se llaman. Los cuatro roles que leen ventas leen productos (comprobado en `role_permission`) |
| `styles/global.css` | `.celda-editable` a **5rem** en el teléfono y 7rem desde `60rem` |

Cierra dos pendientes del armazón: «`/ventas` sigue leyendo `/costeo` entero» y «a 360 px la tabla de
ventas desplaza en horizontal».

La versión de la carga del mes (D-16.1, D-16.121), la precarga del mes anterior como referencia y el
guardado de todas las filas con valor **ya estaban** desde P16-C y el armazón; esta pantalla no los toca.

### Cómo se verificó

- **Log de la API** durante el recorrido: `/productos/ubicaciones` 7 veces, `/costeo` **ninguna**.
- **Escritura en el navegador** (gerente, Local Centro): Enter baja de fila, las letras no entran,
  «Guardar (1)» → «Guardado», tras recargar `97` y se puede seguir escribiendo (`977`), y octubre enseña
  septiembre como mes anterior.
- **Capturas** de ventas e inventario, tres roles × 1280 y 360: ninguna desborda, y a 360 px las casillas
  y la cabecera «Unidades» caben en su marco (antes se cortaban).

### Decisiones

D-16.156 y D-16.157 en `ESTADO.md`.

---

## Pantalla 4 — Insumos: listado · 2026-09-14

### Qué se construyó

| Archivo | Qué |
|---|---|
| `app/(app)/insumos/page.tsx` · `layout.tsx` | El catálogo: nombre (con tipo, unidad y «Archivado»), grupo, rendimiento y **costo neto por unidad de uso**. Lee ítems y grupos, y **`GET /precios/costos` solo si la sesión tiene `pricing.read`**: `BODEGA` ve el catálogo para contar, sin la columna y sin la llamada. Filtros de nombre (sin tildes ni mayúsculas) y grupo sobre la lista leída; «Incluir archivados» va a la API |
| `componentes/ui/Casilla.tsx` · `Selector.tsx` | Primitivas con su primer consumidor |
| `lib/decimales.ts` | **`comoCostoDeUso`**: con parte entera, dos decimales (`8.70 / kg`); sin ella, hasta cuatro (`0.0012 / g`). `comoImporte` enseñaría `0.00` a un costo por gramo |
| `componentes/armazon/navegacion.ts` · `textos/es.ts` · `styles/global.css` | Grupo «Catálogo»; textos; `.filtros` y `.casilla` |

**Sin enlaces a la ficha ni al alta todavía**: son las pantallas 5 y 6, y con `typedRoutes` un `href` a una
ruta que no existe no compila. Entran con ellas.

### Cómo se verificó

- **Log de la API**: `/precios/costos` 4 veces (dueña y gerente, dos anchos) y **ninguna para `BODEGA`**.
- **Capturas**, tres roles × 1280 y 360, sin desbordes: el gerente ve `2.43 / lt`, `1.20 / kg`, `8.70 / kg`
  (tras el ajuste; la primera captura decía `8.6957`, que era ruido); `BODEGA` ve tres columnas y la ayuda
  sin «cuánto cuesta» (también ajustado mirando la captura).
- **Filtros en el navegador**: «LIMÓN» → `Limon sutil`; grupo «Granos» → `Arroz`; «zzz» → «Ningún insumo
  coincide con la búsqueda».

### Guardián

`comoCostoDeUso` cambiado a `comoImporte` → «lo pequeño conserva hasta cuatro decimales» y «lo que cabe en
dos se lee como un importe» en rojo (`ℹ fail 2`); restaurado → verde.

### Decisiones

D-16.158…D-16.160 en `ESTADO.md`.
