/**
 * Reglas de contenido de `audit:forbidden` — el FRONTEND (`apps/web`).
 *
 * `apps/web` no lleva las 7 fases del protocolo: alli no vive ninguna regla de
 * negocio. Lo que si lleva son las prohibiciones que no se relajan en ningun
 * sitio, y estas tres son las que ESLint no cubre o cubre a medias:
 *
 *   - una fecha construida a medianoche (INC-013)
 *   - un decimal convertido a `number` por las vias que `no-restricted-syntax`
 *     deja abiertas (CLAUDE.md §3)
 *   - cualquier rastro de Tipti (DECISIONES.md D8)
 *
 * ENTRAN EN LA PASADA P16 ANTES DE LA PRIMERA PANTALLA NUEVA, a proposito. Una
 * regla que llega despues de treinta pantallas encuentra treinta infracciones
 * y se acaba relajando. La que llega antes no encuentra ninguna y se queda.
 */

const FRONTEND = ['apps/web/src/**/*.{ts,tsx}'];

/** El escaner contiene los textos que prohibe; ver core.rules.mjs. */
const META = ['tools/audit/**'];

export const frontendRules = [
  {
    id: 'no-fecha-a-medianoche',
    descripcion: 'Un instante construido a las 00:00: `T00:00`, `new Date(aaaa, mm, dd)` o `setHours(0)`',
    porQue:
      'Las cinco primeras horas UTC de cada dia 1 son del mes anterior en Ecuador: un movimiento ' +
      'fechado `2026-09-01T00:00:00Z` cae en agosto y lo rechaza un periodo que nadie cerro ' +
      '(INC-013). Toda fecha de este proyecto se construye a `12:00Z`, que cae en el mismo dia ' +
      'natural en toda America, y en el frontend eso lo hace `lib/fechas.ts`, no cada pantalla. ' +
      '`new Date()` sin argumentos —el instante actual— no es una fecha a medianoche y no se marca.',
    patron:
      /T00:00(?::00)?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?['"`]|\bnew\s+Date\(\s*\d{4}\s*,|\.set(?:UTC)?Hours\(\s*0\b/g,
    incluye: FRONTEND,
    excluye: META,
    desde: 'P16',
    referencia: 'docs/incidencias/INC-013 · ESTADO.md D-16.4',
  },
  {
    id: 'no-number-en-frontend',
    // Sin cadenas: el texto de ayuda de `decimales.ts` nombra `Number()` para
    // explicar por que no se usa, y eso no es codigo.
    analiza: 'codigo-sin-cadenas',
    descripcion: '`parseInt`, `parseFloat`, `Number(...)` o `.toNumber()` en `apps/web`',
    porQue:
      'Los decimales de la API llegan como cadena y se muestran como cadena; convertirlos a `number` ' +
      'es punto flotante sobre un valor exacto, y 0.1 + 0.2 deja de dar 0.3. `no-restricted-syntax` ' +
      'de ESLint ya para `parseFloat` y `Number(x.y)`; esta regla cierra las vias que deja abiertas ' +
      '(`parseInt`, `Number(variable)`, `.toNumber()`). Las unidades vendidas tambien viajan como ' +
      'cadena. Si hace falta un calculo, va en la API; si hace falta comparar, `lib/decimales.ts`.',
    patron: /\bparse(?:Int|Float)\s*\(|\bNumber\s*\(|\.toNumber\s*\(/g,
    incluye: FRONTEND,
    excluye: META,
    desde: 'P16',
    referencia: 'CLAUDE.md §3 · docs/incidencias/INC-020',
  },
  {
    id: 'lectura-con-funcion-estable',
    descripcion: '`useCarga(` con una funcion escrita alli mismo, en vez de una estable',
    porQue:
      'Una funcion nueva en cada render es, para `useCarga`, una lectura DISTINTA: vuelve a pedir, ' +
      'el estado cambia, y la pantalla se queda en «Cargando...» para siempre. La documentacion de ' +
      '`useLectura.ts` lo dice —«leer tiene que ser estable»— y aun asi paso en la pantalla 18. ' +
      'No lo ven ni los tipos ni el linter: solo se ve abriendo la pantalla, y por eso existe esta ' +
      'regla. La funcion va en un `useMemo` o un `useCallback`, o se usa `useLectura(ruta)`.',
    patron: /\buseCarga\s*\(\s*(?:async\b|\(|function\b)/g,
    incluye: FRONTEND,
    excluye: META,
    desde: 'P16 (pantalla 18)',
    referencia: 'apps/web/src/lib/useLectura.ts · docs/incidencias/INC-031',
  },
  {
    id: 'no-tipti',
    descripcion: 'Cualquier mencion a Tipti en el codigo del frontend',
    porQue:
      'D8 deja las fuentes externas de precios FUERA del proyecto: sin integracion, sin scraping, sin ' +
      'un boton que prometa lo que no existe. El campo `origen = EXTERNO` del precio de referencia es ' +
      'todo lo que se construye. Un texto visible que nombre a Tipti seria una promesa de producto ' +
      'que nadie ha hecho.',
    patron: /\btipti\b/gi,
    incluye: FRONTEND,
    excluye: META,
    desde: 'P16',
    referencia: 'DECISIONES.md D8 · CLAUDE.md §12',
  },
];
