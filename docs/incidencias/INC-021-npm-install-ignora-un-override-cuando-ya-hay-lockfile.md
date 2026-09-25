# INC-021 — `npm install` dice «up to date» y la dependencia sigue en la versión vieja, aunque `overrides` la sobreescribe

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-09 |
| **Paquete** | P16 · commit 0 (Tooling) |
| **Área** | build · dependencias |
| **Tiempo perdido** | ~45 min |
| **Recurrencias** | 0 |

> **Lo que lo hace peligroso no es el bug, es el silencio.** Un override es casi
> siempre una corrección de seguridad de una dependencia transitiva. Si npm lo
> ignora y además dice «up to date», uno cree que la vulnerabilidad está cerrada
> y no lo está. Aquí lo delató `audit:deps`, que mira el árbol instalado y no
> lo que el `package.json` promete.

## Síntoma

`audit:deps` en rojo por cuatro CVE altos de `multer@2.2.0` (arrastrado por
`@nestjs/platform-express@11.2.3`, que lo fija exacto). Se añade en la raíz:

```json
"overrides": { "multer": "2.3.0" }
```

y entonces:

```
$ npm install
up to date in 18s
$ npm ls multer
    `-- multer@2.2.0
$ npm run audit:deps
audit:deps  FALLO — 4 vulnerabilidad(es) alta(s) sin aceptar
```

`package-lock.json` no cambia ni un byte y no aparece ninguna advertencia.

Segundo síntoma, peor: al borrar la entrada `node_modules/multer` del lock para
obligar a re-resolver, `npm install` dice `removed 15 packages`, **`multer`
desaparece de `node_modules` y del lock**, `npm ls` no lo lista como faltante y
`npm explain multer` responde `No dependencies found matching multer`. La API
arrancaría sin el módulo que `platform-express` importa.

## Contexto

Commit 0 de la pasada P16. Registro npm consultado el 2026-09-09; npm 11.17.0
sobre Node 24.19; monorepo con `workspaces: ["apps/*"]` y la dependencia
declarada en `apps/api/package.json`, no en la raíz.

## Causa raíz

**Con un lockfile existente, npm no re-resuelve una arista sobreescrita.** Carga
el árbol «virtual» desde `package-lock.json`, da la arista por válida tal como
está, y como `package.json` no cambió en sus dependencias directas, no hay nada
que lo empuje a reconsiderarla. Los `overrides` solo se aplican cuando
construye el árbol ideal **desde cero**.

Se aisló con dos experimentos en carpetas temporales:

| Experimento | Resultado |
|---|---|
| Los tres `package.json` (raíz + dos workspaces) **sin** lockfile → `npm install --package-lock-only` | `multer@2.3.0`, izado, **sin copia anidada**: el override funciona con workspaces |
| Los mismos **con** el lockfile actual → igual | `multer@2.2.0`: el lockfile es lo que bloquea |

No es de la versión: `npx npm@12.0.2` (el `latest` del día) hace exactamente lo
mismo.

## Solución

Como `multer@2.3.0` declara **las mismas cuatro dependencias con los mismos
rangos** que 2.2.0, la entrada resuelta sin lock se trasplanta al lock real y
se reifica:

```sh
# 1. resolver sin lock en una carpeta temporal (solo los package.json)
npm install --package-lock-only --ignore-scripts
# 2. copiar version/resolved/integrity de packages["node_modules/multer"] al lock real
# 3. instalar lo que el lock dice
npm install
npm ls multer          # multer@2.3.0 invalid: "2.2.0" from @nestjs/platform-express  <- cosmético, ver abajo
npm run audit:deps     # OK
```

Y la comprobación que decide si sirve, porque es lo que corren la imagen, CI y
el VPS: **`npm ci --ignore-scripts` en una copia limpia** con el lock parcheado
instala `multer@2.3.0`, no anida ninguna 2.2.0 bajo `platform-express`, sale
con 0 y deja el lock idéntico.

`npm ls` sigue marcando la arista como `invalid` por el mismo defecto de carga
(al leer el lock tampoco aplica el override para validar). Es cosmético: el
paquete instalado y el que `npm ci` instala son 2.3.0.

## Qué NO era

- `overrides` no funciona con workspaces → **descartada**: sin lock resuelve
  bien, con la dependencia declarada en el workspace.
- Un bug de npm 11.17 → **descartada**: npm 12.0.2 se comporta igual.
- `npm install --force` o `npm dedupe` lo reharían → **descartada**: los dos
  dicen «up to date» o cambian otra cosa y dejan 2.2.0.
- Declarar el override dentro de `apps/api/package.json` → **descartada**:
  npm solo lee `overrides` de la raíz.
- Añadir `multer@2.3.0` como dependencia directa de la raíz → **descartada y
  peor**: la raíz recibe 2.3.0 y `platform-express` **anida su propia 2.2.0**,
  que es la que cargaría.
- Regenerar el lock entero borrándolo → funcionaría, pero re-resuelve todos
  los rangos `^` de las devDependencies y el diff deja de ser revisable.

## Prevención

- [x] **Verificación en `npm run audit`:** `override-de-npm-reflejado-en-el-lock`
  (`tools/audit/rules/repo.rules.mjs`). Por cada `overrides` de la raíz con
  versión exacta, exige que **todas** las copias del paquete en el lock —la
  izada y cualquier anidada— tengan esa versión. Con `multer: 2.4.0` a mano
  falla nombrando la copia y su versión; revertido, pasa.
- [ ] Prueba automatizada: no aplica, es estado del repositorio.
- [ ] Regla en `CLAUDE.md`: no. La regla de `audit:forbidden` la hace cumplir.
- [ ] ADR: no. La decisión de forzar `multer` está en
  `docs/pasos/P16/CONSTRUCCION.md`, con su condición de salida (retirar el
  override cuando `platform-express` fije `multer ≥ 2.3.0`).

## Referencias

- Avisos: GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-qvfw-j98x-7q72,
  GHSA-535w-7cp7-47q4 (consultados el 2026-09-09 vía `npm audit --json`).
- `npm view @nestjs/platform-express@11.2.3 dependencies.multer` → `2.2.0`;
  la 12.0.1 es la primera que no lo fija ahí, y es ESM (fuera de ADR-001).
