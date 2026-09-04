/**
 * Reglas de la FUENTE UNICA DE VERDAD — CLAUDE.md §2.
 *
 * «`catalog` es transversal y fuente unica de verdad. Ningun otro modulo crea,
 * edita ni borra items, articulos ni unidades. Los demas modulos referencian
 * por ID y leen a traves de sus puertos.»
 *
 * DOS REGLAS PORQUE HAY DOS FORMAS DE SALTARSELO, y cada una se ve en un sitio
 * distinto:
 *
 *   `audit:arch`        impide IMPORTAR la infraestructura de `catalog`. Es la
 *                       via limpia, la que alguien tomaria sin mala intencion.
 *
 *   esta regla          impide TOCAR las tablas, venga el cliente de donde
 *                       venga. `dependency-cruiser` no ve un `tx.item.create()`
 *                       escrito dentro del repositorio de otro modulo: para el
 *                       es un import de `shared/infrastructure/persistence`,
 *                       que es legitimo.
 *
 * Las dos juntas cierran las dos puertas. Una sola dejaria la otra abierta, y
 * la abierta es siempre la que alguien encuentra.
 */

const CODIGO = ['apps/*/src/**/*.ts', 'apps/*/test/**/*.ts'];
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

/** Lo unico autorizado a escribir en las tablas del catalogo. */
const EL_CATALOGO = ['apps/*/src/modules/catalog/**'];

export const catalogRules = [
  {
    id: 'tablas-de-catalogo-solo-en-catalog',
    descripcion: 'Escribir en `item`, `purchase_article`, `item_group` o `unit` fuera de `catalog`',
    porQue:
      'CLAUDE.md §2: el catalogo es la fuente unica de verdad. Un item creado desde `recipes` o desde ' +
      '`imports` es un item que no paso por las reglas del catalogo —rendimiento, unidad, tipo— y que ' +
      'nadie sabe de donde salio. Los demas modulos referencian por ID y leen por los puertos.',
    patron: /\btx\.(item|purchaseArticle|itemGroup|unit|unitDimension)\s*\./g,
    incluye: CODIGO,
    // Las pruebas de integracion SIEMBRAN catalogo con el rol dueno, igual que
    // haria una carga inicial: eso no es la aplicacion escribiendo.
    excluye: [...META, ...EL_CATALOGO, 'apps/*/test/integracion/**'],
    desde: 'P2',
    referencia: 'CLAUDE.md §2 · SPEC §5',
  },
];
