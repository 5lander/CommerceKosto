# ADR-027 — Las pruebas de `apps/web` corren con el ejecutor de Node, sin dependencias

> Architecture Decision Record. Vive en `docs/decisiones/ADR-027-las-pruebas-de-apps-web-con-el-ejecutor-de-node.md`. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

**Fecha:** 2026-09-14 · **Paquete:** P16 · Inicio (pantalla 2) · **Estado:** aceptada · **Decisores:** Claude Code (D-16.148), sobre el criterio que INC-023 dejó escrito

**Supersede la consecuencia de ADR-022** que decía «queda sin prueba automatizada del cliente». Lo
demás de ADR-022 sigue vigente.

---

## Contexto

Hasta Inicio, `apps/web` no tenía ninguna prueba: lo que no es visual se verificaba entrando con el
navegador. INC-023 dejó escrito cuándo cambiaría eso: **«si vuelve un fallo del cliente que ninguna
prueba de la API puede ver, se monta»**. Volvió un commit después, y peor que el anterior: preparando
Inicio, `comoImporte('-9.999')` daba **`100.00`** —el acarreo convertía el signo en un nueve— y un
−7,5 % salía `-007,5 %` (INC-024). La pantalla de menú ya pasaba por ahí el margen de contribución, que
es negativo en un plato que pierde dinero. Es el mismo archivo donde vivió INC-020.

Son **funciones puras**: entra un texto, sale un texto. Lo que había que decidir era con qué correrlas.

## Decisión

**`node --test`**, el ejecutor que trae Node 24, sobre `apps/web/src/**/*.spec.ts`:

- **Node 24 quita los tipos de un `.ts` por su cuenta**: no hace falta compilar ni transpilar.
- **Las pruebas importan con extensión** (`from './decimales.ts'`), que es lo que exige la resolución
  ESM de Node. `apps/web/tsconfig.json` gana `allowImportingTsExtensions`, que su `noEmit` ya permitía.
- **`audit:tests` las corre** después de las unitarias de la API y antes de sondear la base, con
  `process.execPath` (el mismo binario, INC-006). Una en rojo para el pre-commit y CI.
- **`knip`** las toma como punto de entrada; **`eslint`** las examina con las mismas reglas que el resto
  del web, con una sola excepción, por nombre y por módulo: `describe` e `it` de `node:test` devuelven
  una promesa que el propio ejecutor espera, y `no-floating-promises` no debe marcarlas.

**Qué se prueba así:** lo de `lib/` que es función pura —`decimales`, `fechas`— y lo que venga con esa
forma. **Qué no:** componentes y hooks de React, que siguen verificándose en el navegador (deuda #8).

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Vitest en `apps/web`** | Ya está en el repositorio (`apps/api`), pero declararlo en el web es una dependencia nueva de ese paquete, y CLAUDE.md §8 las pide autorizadas. Para funciones puras no aporta nada que `node:test` no dé; se reabre el día que haga falta montar componentes o simular `fetch` con módulos |
| **Un proyecto más en `apps/api/vitest.config.ts` que apunte a `../web`** | Ata la configuración de pruebas de un paquete al código de otro; el día que el web cambie de estructura, se rompen las pruebas de la API |
| **Seguir sin pruebas y verificar en el navegador** | Ya falló dos veces en dos commits. Un redondeo con signo no se ve en una captura salvo que el dato sea negativo ese día |

## Señal para reabrirla

La primera prueba del web que necesite un DOM, un componente o un `fetch` simulado con módulos.

## Referencias

- INC-020, INC-023, **INC-024** · ADR-022 · `tools/audit/tests.mjs` · `apps/web/src/lib/*.spec.ts`
