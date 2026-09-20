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
  // LAS LINEAS VAN ANTES QUE SU CONTEO, y es la unica pareja del orden que no
  // sigue a las claves foraneas — D-16.198. `physical_count_line_solo_en_borrador`
  // rechaza escribir lineas de un conteo CONFIRMADO, asi que el conteo tiene que
  // llegar DESPUES: el guardian se ejecuta, no encuentra conteo todavia y deja
  // pasar. Quien comprueba que cada linea acabo teniendo el suyo es la clave
  // foranea al COMMIT, diferida por `SQL_DIFERIR_LA_FK_DEL_CONTEO`.
  'physical_count_line',
  'physical_count',
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

/**
 * LA FK DE LA LINEA DE CONTEO SE DIFIERE, Y SOLO ELLA — D-16.198.
 *
 * Es lo que permite insertar las lineas ANTES que su conteo, que es lo unico
 * que deja reponer un conteo CONFIRMADO sin apagar su guardian ni tocar sus
 * CHECK (ver la migracion `p16g2_fk_diferible_del_conteo`).
 *
 * EL CONTRA, ESCRITO DONDE SE PAGA: durante esta transaccion
 * `physical_count_line_solo_en_borrador` pasa EN VACIO —lee un conteo que
 * todavia no esta y no encuentra 'CONFIRMADO'—, asi que la coherencia de esas
 * filas la sostiene la clave foranea al COMMIT y no el trigger. Fuera de aqui
 * nada cambia: la FK es `INITIALLY IMMEDIATE` y la aplicacion no difiere nunca.
 */
export const SQL_DIFERIR_LA_FK_DEL_CONTEO = `
SET CONSTRAINTS "physical_count_line_count_id_company_id_fkey" DEFERRED;
`;

/**
 * LOS PERÍODOS CERRADOS SE REABREN PARA REINSERTAR, Y SE VUELVEN A CERRAR — D-16.198.
 *
 * `inventory_movement_respeta_periodo_cerrado` rechaza TODO movimiento cuya
 * fecha caiga en un periodo `CERRADO` de esa ubicacion, y tiene razon: es R3
 * vista desde el mes contable. Pero una restauracion reinserta justamente eso:
 * movimientos viejos, de meses ya cerrados.
 *
 * Las dos salidas faciles son las dos que este proyecto no toma: desactivar el
 * trigger (`ALTER TABLE ... DISABLE TRIGGER` necesita ser dueno y apaga la
 * regla para todos) o entrar como superusuario (que ademas se salta RLS, la
 * barrera que hace segura toda esta operacion).
 *
 * La salida buena es el ORDEN: dentro de la MISMA transaccion se anota que
 * periodos estaban cerrados, se reabren, se reinserta el libro y se vuelven a
 * cerrar. El trigger nunca se apaga —comprueba, y deja pasar porque el mes
 * esta abierto de verdad—, RLS sigue puesta, y al COMMIT el mes vuelve a estar
 * cerrado. Si algo falla por el camino, la transaccion entera se revierte y no
 * queda ningun mes abierto por accidente.
 *
 * `closed_at` y `closed_by` NO se tocan: `period_cerrado_tiene_autor` exige que
 * un CERRADO tenga autor, y conservarlos es lo que permite volver a cerrarlo
 * con su rastro intacto.
 *
 * QUE PERIODOS RECERRAR SE RECUERDA EN UN PARAMETRO DE LA TRANSACCION, y no en
 * una tabla temporal: `costeo_app` NO tiene privilegio `TEMP` sobre la base, y
 * eso es una decision de minimo privilegio, no un descuido que arreglar para
 * que este script funcione. El simulacro de D-16.198 lo dijo con todas las
 * letras —«permission denied to create temporary tables»— y la respuesta es
 * amoldarse a la barrera, no bajarla. `set_config(..., true)` es local a la
 * transaccion, igual que `app.company_id`, asi que si algo falla se va con ella.
 *
 * TODO NOMBRE VA CUALIFICADO —`public.period`— y no es estilo: `pg_dump
 * --data-only` abre cada volcado con `set_config('search_path', '', false)`.
 * Sus propios `INSERT` llevan el esquema delante y no lo notan; este SQL,
 * escrito a mano y pegado entre dos volcados, se encontro con `relation
 * "period" does not exist` a la primera.
 */
export const SQL_REABRIR_PERIODOS = `
SELECT set_config(
  'app.periodos_a_recerrar',
  coalesce((SELECT string_agg(id::text, ',') FROM public.period WHERE status = 'CERRADO'), ''),
  true);
UPDATE public.period SET status = 'ABIERTO' WHERE status = 'CERRADO';
`;

export const SQL_RECERRAR_PERIODOS = `
UPDATE public.period SET status = 'CERRADO'
 WHERE id::text = ANY (string_to_array(current_setting('app.periodos_a_recerrar', true), ','));
`;

/** Cuantos periodos se reabrieron: para decirlo en la salida. */
export const SQL_PERIODOS_CERRADOS = `SELECT count(*)::text FROM period WHERE status = 'CERRADO'`;

/** La company existe y está activa, vista desde la propia sesión del tenant. */
export const SQL_LA_COMPANY = `SELECT name, status FROM company`;
