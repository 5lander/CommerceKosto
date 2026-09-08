/**
 * Las tablas testigo de un respaldo, y la consulta que las cuenta.
 *
 * QUE ES UNA TABLA TESTIGO. Aquella cuyo recuento tiene que coincidir
 * exactamente entre el original y la copia restaurada. **No son las 56**, y es
 * deliberado: contarlas todas vuelve el respaldo lento y nadie lo correria a
 * diario. Estas cinco cubren las formas de perder algo irrecuperable.
 *
 *   inventory_movement   el libro. Append-only (R3): no se reconstruye desde
 *                        ningun otro sitio, ni desde el Excel del cliente, ni
 *                        volviendo a importar
 *   audit_log            quien hizo que. Append-only
 *   item                 el catalogo
 *   recipe_line          las recetas
 *   product_sales        las ventas del mes
 *
 * POR QUE UNA SOLA CONSULTA CON LOS NOMBRES ESCRITOS A MANO, y no un bucle
 * interpolando el nombre de la tabla: un identificador **no se puede pasar como
 * parametro** en SQL, y la respuesta de este proyecto a eso no es abrir una
 * exencion a `no-sql-interpolado`, es no tener identificadores dinamicos. Aqui
 * son cinco y son constantes, asi que se escriben.
 *
 * De paso sale mas rapido: cinco `count(*)` en un viaje en vez de cinco viajes.
 */

/** El orden en que salen las filas de `SQL_DE_RECUENTOS`. */
export const TABLAS_TESTIGO = Object.freeze([
  'inventory_movement',
  'audit_log',
  'item',
  'recipe_line',
  'product_sales',
]);

export const SQL_DE_RECUENTOS = `
SELECT 'inventory_movement' AS tabla, count(*)::text AS filas FROM inventory_movement
UNION ALL SELECT 'audit_log',         count(*)::text FROM audit_log
UNION ALL SELECT 'item',              count(*)::text FROM item
UNION ALL SELECT 'recipe_line',       count(*)::text FROM recipe_line
UNION ALL SELECT 'product_sales',     count(*)::text FROM product_sales
ORDER BY tabla
`;

/**
 * Convierte la salida de `psql -t -A` en un mapa de tabla a recuento.
 *
 * @param {string} salida
 * @returns {ReadonlyMap<string, string>}
 */
export function comoRecuentos(salida) {
  const filas = salida
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.includes('|'));

  return new Map(
    filas.map((linea) => {
      const [tabla = '', valor = ''] = linea.split('|');
      return [tabla, valor];
    }),
  );
}
