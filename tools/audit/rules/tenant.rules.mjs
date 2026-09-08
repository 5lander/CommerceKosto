/**
 * Reglas de la BARRERA 2 — la capa de transaccion-con-tenant (CLAUDE.md §4.1).
 *
 * D12 pone cuatro condiciones para que la eleccion de Prisma sea valida. Estas
 * dos reglas son la segunda: "una regla de `audit:forbidden` que impida usar el
 * cliente fuera de ese envoltorio". Sin ellas, el aislamiento dependeria de que
 * nadie se equivoque nunca, que es exactamente lo que D12 dice que no es una
 * garantia.
 *
 * QUE PASA SI ALGUIEN SE SALTA LA CAPA. No hay fuga: hay cero filas. Sin tenant
 * fijado, `current_company()` es NULL y ninguna fila pasa el filtro de la
 * politica. Estas reglas no son la defensa —la defensa es RLS, en la base—:
 * son el aviso temprano, en el editor, antes de que alguien se pregunte por que
 * su consulta no devuelve nada.
 */

const CODIGO = ['apps/*/src/**/*.{ts,tsx}', 'apps/*/test/**/*.ts'];
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

/** Los dos unicos archivos autorizados a tocar el cliente crudo. */
const LA_CAPA_DE_TENANT = [
  'apps/*/src/shared/infrastructure/persistence/prisma-connection.ts',
  'apps/*/src/shared/infrastructure/persistence/tenant-transaction.ts',
];

export const tenantRules = [
  {
    id: 'cliente-crudo-solo-en-la-capa-de-tenant',
    descripcion: 'Usar `rawClient` (el cliente de Prisma sin transaccion ni tenant) fuera de la capa de tenant',
    porQue:
      'RLS necesita el tenant fijado en la MISMA transaccion que ejecuta la consulta, y el ORM usa un pool. ' +
      'Una consulta por el cliente crudo corre sin tenant: devuelve cero filas, y quien la escribio pierde una ' +
      'tarde averiguando por que. Todo acceso a datos va por `TenantTransaction.run()`.',
    patron: /\brawClient\b/g,
    incluye: CODIGO,
    excluye: [...META, ...LA_CAPA_DE_TENANT],
    desde: 'P1',
    referencia: 'CLAUDE.md §4.1 · DECISIONES.md D12 · ADR-006',
  },
  {
    id: 'prisma-client-solo-en-persistence',
    descripcion: 'Importar el cliente generado de Prisma fuera de `persistence/`',
    porQue:
      'Construir un `PrismaClient` propio esquiva la capa de tenant entera. Solo `prisma-connection.ts` lo ' +
      'instancia, y solo `tenant-transaction.ts` lo usa. El resto del sistema ve `ClienteDeTransaccion`, que ' +
      'ya viene atado a una transaccion con su tenant.',
    patron: /from\s+['"][^'"]*generated\/prisma['"]/g,
    incluye: CODIGO,
    // El back office construye SU PROPIO cliente, con otro rol y otro pool, y
    // eso es justo lo que SPEC §1 exige: dos procesos que no comparten conexion.
    // Que pueda instanciarlo no lo deja suelto — `backoffice.rules.mjs` impide
    // que esa clase se nombre fuera de su modulo.
    excluye: [
      ...META,
      'apps/*/src/shared/infrastructure/persistence/**',
      'apps/*/src/modules/backoffice/infrastructure/backoffice-connection.ts',
    ],
    desde: 'P1',
    referencia: 'CLAUDE.md §4.1 · ADR-006 · ADR-017',
  },
  {
    id: 'sin-set-local-a-mano',
    descripcion: 'Fijar el tenant con `SET LOCAL` o `set_config` fuera de la capa de tenant',
    porQue:
      'Un `SET` fuera de una transaccion interactiva se aplica a una conexion del pool cualquiera, y la consulta ' +
      'puede acabar en otra. Es la forma exacta de creerse aislado sin estarlo. La unica via es ' +
      '`TenantTransaction`, que lo fija DENTRO de la transaccion que ejecuta el trabajo.',
    patron: /\bSET\s+LOCAL\b|\bset_config\s*\(/gi,
    incluye: CODIGO,
    excluye: [...META, ...LA_CAPA_DE_TENANT],
    desde: 'P1',
    referencia: 'CLAUDE.md §4.1',
  },
];
