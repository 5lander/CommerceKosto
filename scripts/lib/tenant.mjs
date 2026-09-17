/**
 * Qué tablas forman UN tenant, y en qué orden se reinsertan — D-16.195.
 *
 * EL ORDEN ES EL DE LAS CLAVES FORANEAS, no el alfabetico. `pg_dump --data-only`
 * no garantiza orden seguro entre tablas, y restaurar `recipe_line` antes que
 * `recipe` falla. Aqui esta escrito, se lee y se revisa.
 *
 * LA LISTA SE COMPARA CONTRA EL CATALOGO EN CADA CORRIDA. Si alguien anade una
 * tabla con `company_id` y no la mete aqui, el script se para: una restauracion
 * que deja una tabla fuera es peor que una que no arranca, porque no se nota
 * hasta que el cliente busca lo que falta.
 */

/** Las tablas del tenant, en orden de dependencia. */
export const TABLAS_DEL_TENANT = Object.freeze([
  'app_user',
  'location',
  'user_role',
  'item_group',
  'item',
  'purchase_article',
  'reference_price',
  'product',
  'product_location',
  'combo_component',
  'recipe',
  'recipe_line',
  'recipe_propagation',
  'period',
  'product_sales',
  'fixed_cost',
  'physical_count',
  'physical_count_line',
  'inventory_movement',
  'inventory_transfer',
  'inventory_production',
  'import_job',
]);

/**
 * Lo que NO se restaura, y por que. Son tablas del tenant que la aplicacion sí
 * lee, asi que quedarse fuera es una decision, no un olvido:
 *
 *   session        son CREDENCIALES VIVAS. Devolver las sesiones de hace tres
 *                  dias es devolver la validez a tokens que ya circularon.
 *                  Quien entre, entra otra vez.
 *   email_outbox   correos que ya salieron —o que ya no deben salir—. Reponer
 *                  la cola es reenviar invitaciones viejas a buzones ajenos.
 */
export const TABLAS_QUE_NO_VUELVEN = Object.freeze(['session', 'email_outbox', 'company_settings']);

/**
 * LOS AJUSTES DE COSTEO NO SE REINSERTAN: SE COMPARAN.
 *
 * `company_settings` nace con la company —lo crea el trigger
 * `company_nace_con_ajustes`— y la aplicacion puede leerla y ACTUALIZARLA, pero
 * no insertarla ni borrarla. Eso significa dos cosas:
 *
 *   1. en una perdida real esa fila SIGUE AHI: lo que puede haberse ido son sus
 *      VALORES, no la fila;
 *   2. reinsertarla con el rol de la aplicacion es imposible por diseno, y
 *      hacerlo con el de migracion seria saltarse la barrera justo en la tabla
 *      que decide el IVA y los objetivos de food cost de un cliente.
 *
 * Asi que el script compara los valores de la copia con los del destino y, si
 * difieren, los IMPRIME para que se repongan desde la pantalla de Ajustes. Un
 * `iva_compra_recuperable` mal puesto cambia el costo de cada plato: es
 * demasiado importante para restaurarlo en silencio.
 */
export const SQL_DE_LOS_AJUSTES = `
SELECT iva_venta, iva_compra_recuperable, provision_merma, food_cost_objetivo,
       food_cost_maximo, food_cost_umbral_verde, prime_cost_maximo,
       regla_popularidad, dias_operativos_mes, dias_cobertura
  FROM company_settings
`;

/**
 * Las que la aplicacion NO puede leer, asi que ni aparecen en el volcado: los
 * dos registros append-only. `audit_log` es de solo lectura para el back office
 * (SEGURIDAD.md §10) y `backoffice_access_log` es suyo. Restaurar un log
 * seria escribir historia.
 */
export const REGISTROS_FUERA_DEL_ALCANCE = Object.freeze(['audit_log', 'backoffice_access_log']);

/**
 * Las tablas con `company_id` que la aplicacion puede LEER — las candidatas a
 * volver. Se compara con `TABLAS_DEL_TENANT` + `TABLAS_QUE_NO_VUELVEN`.
 *
 * Mira las politicas de verdad (`pg_policy`), no una lista escrita a mano: si
 * una politica cambia, este guardian se entera.
 */
export const SQL_TABLAS_CON_TENANT = `
SELECT c.relname AS tabla
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND a.attnum > 0
 WHERE c.relkind = 'r'
   AND c.relnamespace = 'public'::regnamespace
   AND EXISTS (
     SELECT 1
       FROM pg_policy p
      WHERE p.polrelid = c.oid
        AND p.polcmd IN ('r', '*')
        AND 'costeo_app' = ANY (SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles))
        AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%false%'
   )
 ORDER BY c.relname
`;

/**
 * Cuantas filas tiene cada tabla del tenant EN LA CONEXION QUE PREGUNTA. Con el
 * rol de la aplicacion y `app.company_id` fijado, RLS ya hace el filtro: no hay
 * `WHERE company_id` que escribir ni que equivocar.
 *
 * Es una union escrita a mano, como `testigos.mjs`: un identificador no se
 * interpola (`no-sql-interpolado`), y esta es la forma que el proyecto acepta.
 */
export const SQL_DE_RECUENTOS_DEL_TENANT = `
            SELECT 'app_user' AS tabla,        count(*)::text AS filas FROM app_user
  UNION ALL SELECT 'location',                 count(*)::text FROM location
  UNION ALL SELECT 'user_role',                count(*)::text FROM user_role
  UNION ALL SELECT 'item_group',               count(*)::text FROM item_group
  UNION ALL SELECT 'item',                     count(*)::text FROM item
  UNION ALL SELECT 'purchase_article',         count(*)::text FROM purchase_article
  UNION ALL SELECT 'reference_price',          count(*)::text FROM reference_price
  UNION ALL SELECT 'product',                  count(*)::text FROM product
  UNION ALL SELECT 'product_location',         count(*)::text FROM product_location
  UNION ALL SELECT 'combo_component',          count(*)::text FROM combo_component
  UNION ALL SELECT 'recipe',                   count(*)::text FROM recipe
  UNION ALL SELECT 'recipe_line',              count(*)::text FROM recipe_line
  UNION ALL SELECT 'recipe_propagation',       count(*)::text FROM recipe_propagation
  UNION ALL SELECT 'period',                   count(*)::text FROM period
  UNION ALL SELECT 'product_sales',            count(*)::text FROM product_sales
  UNION ALL SELECT 'fixed_cost',               count(*)::text FROM fixed_cost
  UNION ALL SELECT 'physical_count',           count(*)::text FROM physical_count
  UNION ALL SELECT 'physical_count_line',      count(*)::text FROM physical_count_line
  UNION ALL SELECT 'inventory_movement',       count(*)::text FROM inventory_movement
  UNION ALL SELECT 'inventory_transfer',       count(*)::text FROM inventory_transfer
  UNION ALL SELECT 'inventory_production',     count(*)::text FROM inventory_production
  UNION ALL SELECT 'import_job',               count(*)::text FROM import_job
  ORDER BY tabla
`;

/** La company existe y está activa, vista desde la propia sesión del tenant. */
export const SQL_LA_COMPANY = `SELECT name, status FROM company`;
