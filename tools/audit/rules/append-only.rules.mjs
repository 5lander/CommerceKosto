/**
 * Reglas de tablas append-only.
 *
 * La lista de tablas es el unico dato que cambia entre paquetes:
 *   P0 -> audit_log
 *   P6 -> inventory_movement  (R3: el libro de inventario no se edita jamas;
 *         un error se corrige con un movimiento de signo contrario)
 *
 * Anadir una tabla a `TABLAS_APPEND_ONLY` la protege en las tres capas de una
 * vez, sin tocar el escaner ni escribir una regla nueva.
 *
 * Esta es la TERCERA capa de defensa, la mas debil de las tres y la unica que
 * avisa temprano. Las otras dos viven en la base de datos:
 *   1. REVOKE UPDATE, DELETE, TRUNCATE para el rol de la aplicacion
 *   2. Trigger BEFORE UPDATE OR DELETE OR TRUNCATE ... FOR EACH STATEMENT,
 *      que alcanza tambien al dueno de la tabla
 */

const CODIGO = ['apps/*/src/**/*.ts', 'tools/**/*.mjs', 'scripts/**/*.mjs'];
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

/** Nombre de la tabla en snake_case y su equivalente en el cliente de Prisma. */
export const TABLAS_APPEND_ONLY = [
  { tabla: 'audit_log', modeloPrisma: 'auditLog', desde: 'P0' },
  // P6: { tabla: 'inventory_movement', modeloPrisma: 'inventoryMovement', desde: 'P6' },
];

const MUTACIONES = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'];

/** @param {{tabla: string, modeloPrisma: string, desde: string}} entrada */
function reglaCliente(entrada) {
  return {
    id: `append-only-cliente-${entrada.tabla}`,
    descripcion: `Mutar \`${entrada.tabla}\` a traves del cliente de Prisma`,
    porQue: `\`${entrada.tabla}\` es append-only. La base lo rechaza por privilegio y por trigger; esta regla lo detiene antes, en el editor.`,
    patron: new RegExp(`\\.${entrada.modeloPrisma}\\s*\\.\\s*(?:${MUTACIONES.join('|')})\\b`, 'g'),
    incluye: CODIGO,
    excluye: META,
    desde: entrada.desde,
    referencia: 'CLAUDE.md §5 y §13 · SEGURIDAD.md §10b',
  };
}

/** @param {{tabla: string, modeloPrisma: string, desde: string}} entrada */
function reglaSql(entrada) {
  return {
    id: `append-only-sql-${entrada.tabla}`,
    descripcion: `\`UPDATE\` o \`DELETE\` sobre \`${entrada.tabla}\` en SQL`,
    porQue: 'Ni siquiera en una migracion. Un error se corrige con una fila nueva, nunca editando el historial.',
    patron: new RegExp(
      `\\b(?:UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+"?${entrada.tabla}"?\\b`,
      'gi',
    ),
    incluye: [...CODIGO, 'prisma/migrations/**/*.sql'],
    // El `down.sql` de la migracion que CREA la tabla necesita poder soltarla;
    // eso es DROP TABLE, no UPDATE/DELETE, asi que no hace falta excepcion.
    excluye: META,
    desde: entrada.desde,
    referencia: 'CLAUDE.md §5 · AUDITORIA.md E5',
  };
}

export const appendOnlyRules = TABLAS_APPEND_ONLY.flatMap((entrada) => [
  reglaCliente(entrada),
  reglaSql(entrada),
]);
