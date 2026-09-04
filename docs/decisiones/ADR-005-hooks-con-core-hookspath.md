# ADR-005: Hooks de git con `core.hooksPath` en vez de husky

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-08-27 |
| Paquete | P0 |
| Decisores | Usuario / Claude Code |

## Contexto

`CLAUDE.md` §13 exige que `npm run audit` corra **en CI y en pre-commit**. Los hooks de git no se versionan por defecto: viven en `.git/hooks/`, que no está bajo control de versiones, así que hace falta algún mecanismo para que todos los clones los tengan.

La opción estándar del ecosistema es **husky**. `CLAUDE.md` §3 dice que no se trae una dependencia para lo que se resuelve a mano en diez líneas.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **husky** | Estándar de facto, documentación abundante | Una dependencia con su propio ciclo de vida y sus propios cambios rompedores entre majors, para escribir dos líneas de configuración de git |
| **Copiar los hooks a `.git/hooks/` en `postinstall`** | Sin dependencias | Copiar deja dos copias: se editan una y otra sin darse cuenta |
| **`core.hooksPath` apuntando a `.githooks/` versionado** | Sin dependencias, sin copias, un solo archivo que es a la vez el fuente y el que se ejecuta | Requiere git ≥ 2.9 (de 2016) |

## Decisión

**Los hooks viven en `.githooks/`, versionados, y `tools/setup-hooks.mjs` apunta `core.hooksPath` ahí desde el script `prepare` de npm.**

Tres propiedades del script que importan más que su brevedad:

1. **Es idempotente.** Si `core.hooksPath` ya apunta al sitio correcto, no hace nada y lo dice.
2. **Nunca hace fallar el `npm install`.** Si git no está disponible —una imagen de contenedor, un CI sin repositorio— avisa y **sale con éxito**. Un hook que no se puede instalar no es motivo para que la instalación falle; el `Dockerfile` de la API depende de esto.
3. **Es lo único que `prepare` hace además de generar el cliente de Prisma**, así que el efecto de un `npm ci` es predecible.

### Por qué el hook no corre exactamente lo mismo que CI

El pre-commit corre los checks de `npm run audit` pero invoca `tools/audit/tests.mjs --solo-unitarias`: si el desarrollador no tiene Docker levantado, las pruebas de integración se omiten **con aviso**, y el commit sigue.

Es una concesión deliberada y acotada. **En CI nunca se pasa esa bandera**: allí la base siempre está, y las pruebas de aislamiento y de cabeceras corren sin excepción. La diferencia va en el sentido correcto — el hook es un filtro rápido, la rama la protege CI.

### El detalle de Windows que hace que esto funcione

Un hook de git es un script `sh`. Con `core.autocrlf=true` activo —que es el valor por defecto en Windows— git le añade `CRLF` al pasarlo al disco, y entonces el intérprete falla con `bad interpreter: /bin/sh^M`. **Por eso `.gitattributes` con `eol=lf` entra en el primer commit**, junto con `git add --renormalize .`. Es la incidencia INC-001, y se verifica con `git ls-files --eol`.

## Consecuencias

- Se gana: los hooks son parte del repositorio, se revisan en el diff como cualquier otro archivo, y no hay una dependencia más que actualizar.
- Se sacrifica: quien clone y no ejecute `npm install` no tendrá el hook. Es aceptable porque CI vuelve a comprobarlo todo, y porque sin `npm install` tampoco hay nada que ejecutar.
- Nota: `core.hooksPath` es configuración **local** de cada clon, no se propaga por git. Ese es justamente el motivo de que la instale un script en vez de darla por hecha.
- **Qué lo revertiría:** que git deje de soportar `core.hooksPath`, o que el proyecto necesite orquestación de hooks por etapas y por archivo modificado. Lo segundo es lo plausible, y llegaría con el frontend en P12; aun así, `lint-staged` resolvería eso sin necesidad de husky.
