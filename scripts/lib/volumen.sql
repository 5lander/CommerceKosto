-- ============================================================================
-- VOLUMEN SINTETICO PARA `npm run bench`
--
-- CLAUDE.md §5 lo exige con todas las letras: «probar con volumen sintetico
-- realista, NUNCA con 20 filas». Un presupuesto de rendimiento medido sobre una
-- tabla vacia no mide nada: PostgreSQL resuelve cualquier cosa con un
-- Seq Scan de tres paginas y todos los numeros salen verdes. Es INC-007 —una
-- comprobacion que pasa sin medir— aplicada al rendimiento.
--
-- NO HAY UN SOLO DATO DE CLIENTE AQUI, ni como marcador. Todo se genera con
-- `generate_series` (CLAUDE.md §7: nunca datos reales en desarrollo).
--
-- SE EJECUTA COMO `costeo_migrator`, que tiene politica `FOR ALL ... USING
-- (true)` en cada tabla. No es un puente sobre RLS: es el mismo rol con el que
-- corren las migraciones y las pruebas de integracion, y sigue siendo
-- NOBYPASSRLS.
--
-- CERO INTERPOLACION. No hay variables, no hay `:'algo'`, no hay identificadores
-- dinamicos: la base contra la que corre la elige `bench.mjs` por la cadena de
-- conexion, y todo lo demas son constantes. Es la unica forma de que
-- `audit:forbidden` no tenga nada que decir.
--
-- CUANTO Y POR QUE. Los cuatro numeros salen de los presupuestos de CLAUDE.md §5:
--   · 500 items en una ubicacion        -> presupuesto de inventario
--   · 200 productos, 1.500 lineas/ubic. -> presupuesto de costeo
--   · 10 ubicaciones                    -> presupuesto de consolidado
--   · 5 companies                       -> para que RLS tenga algo que filtrar.
--     Medir el aislamiento con un solo tenant es medirlo sin aislamiento.
-- ============================================================================

-- Identificadores deterministas: la misma semilla da el mismo UUID siempre, asi
-- que las consultas de `EXPLAIN ANALYZE` se pueden repetir a mano sin volver a
-- sembrar. `familia` separa los espacios para que dos tablas no colisionen.
CREATE FUNCTION bench_uuid(familia int, n int) RETURNS uuid
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT (lpad(to_hex(familia), 8, '0') || '-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
  $$;

-- ---------------------------------------------------------------- companies --
--
-- `plan_code` Y NO `max_locations`: P11 borro esa columna y puso el limite en
-- la tabla `plan`, «dos sitios donde vive el mismo limite son dos sitios que un
-- dia dejan de coincidir» (D5). Este archivo se quedo insertandola y `npm run
-- bench` llevaba desde entonces muriendo con «column "max_locations" of
-- relation "company" does not exist» — sin que nadie lo viera, porque el bench
-- esta fuera de `npm run audit` a proposito (AUDITORIA.md I8) y nadie lo
-- ejecuto en dos paquetes. Es INC-017 otra vez: un script que apunta a algo que
-- ya no funciona.
--
-- PROFESIONAL y no BASICO: lo que se siembra aqui —10 ubicaciones, 500 items,
-- 200 productos— cabe en el primero (25/2000/1000) y NO en el segundo, que
-- permite 300 productos. Medir sobre una company cuyo plan no admite su propio
-- volumen seria medir un caso que la aplicacion habria rechazado.
INSERT INTO company (id, name, status, plan_code)
SELECT bench_uuid(1, n), 'Company de volumen ' || n, 'ACTIVE', 'PROFESIONAL'
FROM generate_series(1, 5) n;

-- --------------------------------------------------------------- ubicaciones --
-- La company 1 es la que se mide y lleva las 10 del presupuesto de consolidado.
INSERT INTO location (id, company_id, name, type, status)
SELECT bench_uuid(2, n), bench_uuid(1, 1), 'Sucursal ' || n, 'AMBOS', 'ACTIVE'
FROM generate_series(1, 10) n;

-- Las otras cuatro existen para que las consultas tengan filas que descartar.
INSERT INTO location (id, company_id, name, type, status)
SELECT bench_uuid(2, 100 + (c - 2) * 2 + n), bench_uuid(1, c), 'Sucursal ' || n, 'AMBOS', 'ACTIVE'
FROM generate_series(2, 5) c, generate_series(1, 2) n;

-- ------------------------------------------------------------------ usuarios --
-- El hash es el de una contrasena que no existe: `bench.mjs` no hace login por
-- HTTP, construye la sesion contra la base. Un hash valido pero inutilizable es
-- mas seguro que uno que abra algo.
INSERT INTO app_user (id, company_id, email, password_hash, status)
SELECT bench_uuid(3, c), bench_uuid(1, c), 'volumen' || c || '@ejemplo.invalid',
       '$argon2id$v=19$m=19456,t=2,p=1$c2Vtb3M$sin-uso-en-bench', 'ACTIVE'
FROM generate_series(1, 5) c;

INSERT INTO user_role (id, company_id, user_id, role_code, location_id, has_location)
SELECT bench_uuid(3, 100 + c), bench_uuid(1, c), bench_uuid(3, c), 'OWNER', NULL, false
FROM generate_series(1, 5) c;

-- --------------------------------------------------------------------- items --
-- 500 en la company medida. `yield` entre 0,80 y 1,00 para que el costo neto no
-- sea igual al bruto: si todos los rendimientos fueran 1, la mitad de la formula
-- de costeo no se ejecutaria de verdad.
INSERT INTO item (id, company_id, name, type, unit_of_use, yield, status, price_confidence, keeps_stock)
SELECT bench_uuid(4, n), bench_uuid(1, 1), 'Insumo ' || n, 'COMPRADO',
       (ARRAY['kg', 'g', 'lt', 'ml', 'unid'])[1 + n % 5],
       0.80 + (n % 21) * 0.01, 'ACTIVE',
       CASE WHEN n % 4 = 0 THEN 'ESTIMADO' ELSE 'FACTURA' END,
       NULL
FROM generate_series(1, 500) n;

INSERT INTO item (id, company_id, name, type, unit_of_use, yield, status, price_confidence, keeps_stock)
SELECT bench_uuid(4, 1000 + (c - 2) * 50 + n), bench_uuid(1, c), 'Insumo ' || n, 'COMPRADO',
       'kg', 0.95, 'ACTIVE', 'FACTURA', NULL
FROM generate_series(2, 5) c, generate_series(1, 50) n;

-- ----------------------------------------------------- articulos y precios --
INSERT INTO purchase_article (id, company_id, item_id, name, presentation_amount,
                              presentation_unit, conversion_factor, iva_tarifa, status)
SELECT bench_uuid(5, n), bench_uuid(1, 1), bench_uuid(4, n), 'Presentacion ' || n,
       1, (ARRAY['kg', 'g', 'lt', 'ml', 'unid'])[1 + n % 5], 1, 0.15, 'ACTIVE'
FROM generate_series(1, 500) n;

-- CONFIRMED a proposito: un precio SUGGESTED no entra en el costeo (R5), y el
-- presupuesto que se quiere medir es el del calculo completo, no el del vacio.
INSERT INTO reference_price (id, company_id, item_id, purchase_article_id, price, iva_compra,
                             origin, status, valid_from, created_by, confirmed_by, confirmed_at)
SELECT bench_uuid(6, n), bench_uuid(1, 1), bench_uuid(4, n), bench_uuid(5, n),
       0.50 + (n % 400) * 0.05, 0.15, 'MANUAL', 'CONFIRMED',
       TIMESTAMPTZ '2024-01-01 12:00:00+00', bench_uuid(3, 1), bench_uuid(3, 1),
       TIMESTAMPTZ '2024-01-01 12:00:00+00'
FROM generate_series(1, 500) n;

-- ---------------------------------------------------------------- productos --
INSERT INTO product (id, company_id, name, type, category, status, packaging_item_id)
SELECT bench_uuid(7, n), bench_uuid(1, 1), 'Plato ' || n, 'SIMPLE',
       (ARRAY['Entradas', 'Fuertes', 'Postres', 'Bebidas'])[1 + n % 4], 'ACTIVE',
       CASE WHEN n % 3 = 0 THEN bench_uuid(4, 1 + n % 500) ELSE NULL END
FROM generate_series(1, 200) n;

INSERT INTO product_location (company_id, product_id, location_id, activo, pvp, rendimiento_porciones)
SELECT bench_uuid(1, 1), bench_uuid(7, p), bench_uuid(2, l), true,
       3.00 + (p % 30) * 0.75, 1
FROM generate_series(1, 200) p, generate_series(1, 10) l;

-- ----------------------------------------------------------------- recetas --
-- Una receta por (producto, ubicacion): 2.000. Con 7 lineas cada una salen
-- 1.400 lineas POR UBICACION, que es el presupuesto de CLAUDE.md §5 —«200
-- productos con 1.500 lineas de receta»— y 14.000 en total.
INSERT INTO recipe (id, company_id, location_id, product_id, item_id, status, valid_from, created_by)
SELECT bench_uuid(8, (l - 1) * 200 + p), bench_uuid(1, 1), bench_uuid(2, l), bench_uuid(7, p),
       NULL, 'ACTIVE', TIMESTAMPTZ '2024-01-01 12:00:00+00', bench_uuid(3, 1)
FROM generate_series(1, 200) p, generate_series(1, 10) l;

-- El insumo se elige con un salto primo sobre el indice del producto para que
-- las recetas no compartan todas los mismos siete items: si lo hicieran, la
-- cache de precios acertaria siempre y el costeo saldria mas rapido de lo que es.
INSERT INTO recipe_line (id, company_id, recipe_id, item_id, cantidad, base, estado, orden)
SELECT bench_uuid(9, ((l - 1) * 200 + p - 1) * 7 + k),
       bench_uuid(1, 1),
       bench_uuid(8, (l - 1) * 200 + p),
       bench_uuid(4, 1 + (p * 17 + k * 61) % 500),
       0.010 + (k % 9) * 0.025,
       CASE WHEN k % 3 = 0 THEN 'EP' ELSE 'AP' END,
       'ACTIVA',
       k
FROM generate_series(1, 200) p, generate_series(1, 10) l, generate_series(1, 7) k;

-- ---------------------------------------------------------------- periodos --
-- 24 meses cerrados por ubicacion. Las fechas se fijan al MEDIODIA (INC-013):
-- la medianoche UTC de un dia 1 pertenece al mes anterior en Ecuador, y ese
-- error convertiria el volumen en un volumen mal fechado.
INSERT INTO period (id, company_id, location_id, year, month, starts_at, ends_at, status)
SELECT bench_uuid(10, (l - 1) * 24 + m),
       bench_uuid(1, 1), bench_uuid(2, l),
       2024 + (m - 1) / 12, 1 + (m - 1) % 12,
       (DATE '2024-01-01' + ((m - 1) || ' months')::interval + INTERVAL '12 hours'),
       (DATE '2024-01-01' + (m || ' months')::interval - INTERVAL '12 hours'),
       'ABIERTO'
FROM generate_series(1, 10) l, generate_series(1, 24) m;

INSERT INTO product_sales (id, company_id, period_id, product_id, units, created_by)
SELECT bench_uuid(11, ((l - 1) * 24 + m - 1) * 200 + p),
       bench_uuid(1, 1), bench_uuid(10, (l - 1) * 24 + m), bench_uuid(7, p),
       10 + (p * 7 + m * 13) % 400,
       bench_uuid(3, 1)
FROM generate_series(1, 10) l, generate_series(1, 24) m, generate_series(1, 200) p;

-- ------------------------------------------------- el libro de inventario --
-- Lo que de verdad hace lentas las consultas. Dos anos, diez ubicaciones, ~30
-- movimientos por dia y ubicacion: unas 220.000 filas. Una cadena pequena de
-- verdad esta en este orden de magnitud despues de dos anos.
INSERT INTO inventory_movement (id, company_id, location_id, item_id, type, direction,
                                quantity, total_cost, purchase_article_id,
                                occurred_at, created_by)
SELECT bench_uuid(12, ((l - 1) * 730 + d - 1) * 30 + k),
       bench_uuid(1, 1),
       bench_uuid(2, l),
       bench_uuid(4, 1 + (d * 23 + k * 97) % 500),
       CASE WHEN k % 6 = 0 THEN 'COMPRA' ELSE 'CONSUMO_POR_VENTA' END,
       CASE WHEN k % 6 = 0 THEN 'ENTRADA' ELSE 'SALIDA' END,
       -- EL SIGNO LO MANDA LA DIRECCION, y la base lo obliga con un CHECK: una
       -- salida es negativa. Es lo que hace que el saldo sea una suma y no un
       -- `CASE` esparcido por cada consulta que lea el libro.
       (CASE WHEN k % 6 = 0 THEN 1 ELSE -1 END) * (0.100 + (k % 40) * 0.25),
       CASE WHEN k % 6 = 0 THEN 1.00 + (k % 30) * 0.40 ELSE NULL END,
       CASE WHEN k % 6 = 0 THEN bench_uuid(5, 1 + (d * 23 + k * 97) % 500) ELSE NULL END,
       (DATE '2024-01-01' + (d - 1) * INTERVAL '1 day' + INTERVAL '12 hours'),
       bench_uuid(3, 1)
FROM generate_series(1, 10) l, generate_series(1, 730) d, generate_series(1, 30) k;

DROP FUNCTION bench_uuid(int, int);

-- NI `BEGIN` NI `VACUUM` AQUI, y las dos ausencias son a proposito. La
-- transaccion la abre `psql --single-transaction` desde `aplicarSql`, que es el
-- camino unico del proyecto para aplicar SQL de forma atomica (INC-002); y
-- `VACUUM` NO PUEDE correr dentro de una transaccion, asi que lo lanza
-- `bench.mjs` justo despues. Sin ese `ANALYZE` el planificador seguiria con
-- estimaciones de tabla vacia y mediriamos los planes de otro sistema.
