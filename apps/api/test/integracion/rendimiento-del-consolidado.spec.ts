/**
 * El presupuesto del consolidado — CLAUDE.md §5, medido.
 *
 *   «Consolidado de company con 10 ubicaciones: **< 800 ms** (p95)»
 *
 * ES EL PRESUPUESTO MÁS EXPUESTO DEL SISTEMA, porque el consolidado no calcula
 * nada nuevo: arma el contexto de cada ubicación y suma. Diez ubicaciones son
 * diez veces el trabajo del costeo de una carta, y el de una carta ya tiene su
 * propio presupuesto de 400 ms. El techo del consolidado es el doble, no diez
 * veces más, así que el margen sale de que cada ubicación cueste poco — no de
 * que las diez se solapen.
 *
 * SE MIDE Y SE PUBLICA SIEMPRE; SE EXIGE DONDE LA MEDICIÓN VALE. El proxy de
 * Docker en Windows falsea el tiempo (INC-016), así que el presupuesto lo
 * guarda CI. Lo que sí corre en todas partes es la comprobación de que el
 * volumen sembrado es el que §5 nombra: sin eso, el número no significa nada
 * (INC-007 caso 8).
 *
 * MEDIDO EN LA TOPOLOGÍA DE PRODUCCIÓN, el 2026-09-06, con este mismo volumen:
 *
 * ```
 *   una ubicación  (/analitica/resumen)   mediana  69 ms
 *   diez           (/consolidado)         mediana 616 ms · p95 734 · max 848
 * ```
 *
 * **Cumple, y cumple por poco: el 92 % del presupuesto.** Y la proporción es
 * 8,9× — el consolidado escala practicamente LINEAL con el numero de
 * ubicaciones, pese a resolverlas con `Promise.all`. La razon es que la mayor
 * parte del trabajo es CPU de Node, que es un solo hilo: esperar en paralelo no
 * multiplica lo que hay que calcular.
 *
 * **La consecuencia, escrita para que nadie la descubra tarde: doce ubicaciones
 * se salen del presupuesto.** Ahi es donde entra la vista materializada de
 * periodos cerrados que el plan de P9 nombra, y por eso no se construyo antes
 * (ADR-012 §5). El umbral esta medido, no supuesto.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { MOTIVO_TRANSPORTE, SE_EXIGE_EL_PRESUPUESTO } from '../soporte/transporte';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const CONTRASENA = 'doce platos servidos';

/** El volumen que CLAUDE.md §5 nombra para el consolidado. */
const UBICACIONES = 10;
const PRODUCTOS_POR_UBICACION = 20;
const ITEMS = 120;
const PRESUPUESTO_MS = 800;
const MEDICIONES = 20;
const ANIO = 2026;
const MARZO = 3;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

function p95(muestras: readonly number[]): number {
  const ordenadas = [...muestras].sort((izquierda, derecha) => izquierda - derecha);
  const indice = Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1);
  return ordenadas[indice] ?? 0;
}

describe('rendimiento del consolidado con diez ubicaciones', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let company: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  /**
   * Diez ubicaciones, cada una con su carta, su receta y sus ventas del mes.
   *
   * Se siembra por SQL como `costeo_migrator`: montar doscientos productos y
   * sus recetas a golpe de HTTP tardaría minutos y estaría midiendo el
   * servidor de pruebas, no el consolidado.
   */
  async function sembrar(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO location (company_id, name, type, status)
       SELECT $1, 'Local ' || n, 'AMBOS', 'ACTIVE' FROM generate_series(1, $2) AS n`,
      [company, UBICACIONES],
    );

    await duena.query(
      `INSERT INTO item (company_id, name, type, unit_of_use, yield, status, price_confidence)
       SELECT $1, 'Insumo ' || n, 'COMPRADO', 'g', 0.9, 'ACTIVE', 'FACTURA'
       FROM generate_series(1, $2) AS n`,
      [company, ITEMS],
    );

    await duena.query(
      `INSERT INTO purchase_article
         (company_id, item_id, name, presentation_amount, presentation_unit,
          conversion_factor, iva_tarifa, status)
       SELECT $1, i.id, 'Presentacion ' || i.name, 1000, 'kg', 1000, 0.15, 'ACTIVE'
       FROM item i WHERE i.company_id = $1`,
      [company],
    );

    await duena.query(
      `INSERT INTO reference_price
         (company_id, item_id, purchase_article_id, price, iva_compra, origin, status,
          valid_from, created_by, confirmed_by, confirmed_at)
       SELECT $1, a.item_id, a.id, 2.50, 0.15, 'MANUAL', 'CONFIRMED',
              TIMESTAMPTZ '2026-01-01', $2, $2, TIMESTAMPTZ '2026-01-01'
       FROM purchase_article a WHERE a.company_id = $1`,
      [company, usuario],
    );

    await duena.query(
      `INSERT INTO product (company_id, name, type, status)
       SELECT $1, 'Plato ' || n, 'SIMPLE', 'ACTIVE'
       FROM generate_series(1, $2) AS n`,
      [company, PRODUCTOS_POR_UBICACION],
    );

    // El MISMO catálogo activo en las diez: es el caso de la cadena real, y el
    // que hace que la comparativa de productos tenga diez filas por plato.
    await duena.query(
      `INSERT INTO product_location
         (company_id, product_id, location_id, activo, pvp, rendimiento_porciones)
       SELECT $1, p.id, l.id, true, 6.50, 2
       FROM product p, location l
       WHERE p.company_id = $1 AND l.company_id = $1`,
      [company],
    );

    await duena.query(
      `INSERT INTO recipe (company_id, location_id, product_id, status, valid_from, created_by)
       SELECT $1, l.id, p.id, 'ACTIVE', TIMESTAMPTZ '2026-01-01', $2
       FROM product p, location l
       WHERE p.company_id = $1 AND l.company_id = $1`,
      [company, usuario],
    );

    await duena.query(
      `WITH r AS (
         SELECT id, (row_number() OVER (ORDER BY id)) - 1 AS rn
         FROM recipe WHERE company_id = $1
       ), i AS (
         SELECT id, (row_number() OVER (ORDER BY id)) - 1 AS ino
         FROM item WHERE company_id = $1
       )
       INSERT INTO recipe_line (company_id, recipe_id, item_id, cantidad, base, estado, orden)
       SELECT $1, r.id, i.id, 0.05, 'EP', 'ACTIVA', k
       FROM r
       CROSS JOIN generate_series(0, 5) AS k
       JOIN i ON i.ino = ((r.rn * 7 + k * 13) % $2)`,
      [company, ITEMS],
    );

    await sembrarPeriodosYVentas(usuario);
    await duena.query('ANALYZE');
  }

  /** Un período abierto por ubicación, con sus unidades vendidas del mes. */
  async function sembrarPeriodosYVentas(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO period (company_id, location_id, year, month, starts_at, ends_at, status)
       SELECT $1, l.id, $2, $3,
              make_timestamptz($2, $3, 1, 0, 0, 0, 'America/Guayaquil'),
              make_timestamptz($2, $3, 1, 0, 0, 0, 'America/Guayaquil') + interval '1 month',
              'ABIERTO'
       FROM location l WHERE l.company_id = $1`,
      [company, ANIO, MARZO],
    );

    await duena.query(
      `INSERT INTO product_sales (company_id, period_id, product_id, units, created_by)
       SELECT $1, pe.id, pl.product_id, 30, $2
       FROM period pe
       JOIN product_location pl
         ON pl.company_id = $1 AND pl.location_id = pe.location_id
       WHERE pe.company_id = $1`,
      [company, usuario],
    );

    await duena.query(
      `INSERT INTO inventory_movement
         (company_id, location_id, item_id, type, direction, quantity, total_cost,
          occurred_at, created_by)
       SELECT $1, l.id, i.id, 'COMPRA', 'ENTRADA', 1000, 25.00,
              TIMESTAMPTZ '2026-03-15 12:00:00Z', $2
       FROM location l, item i
       WHERE l.company_id = $1 AND i.company_id = $1`,
      [company, usuario],
    );
  }

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();
    // Escuchando ANTES de cualquier lote en paralelo: supertest abre el puerto
    // perezosamente y varios `Test` creados en el mismo tick lo intentan a la
    // vez, lo que produce un `read ECONNRESET` intermitente. Ver INC-034.
    await app.listen(0);

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`cadena grande ${sufijo}`],
    );
    company = rows[0]?.id ?? '';

    const correo = `admin.${sufijo}@snacklab.ec`;
    const { rows: usuarios } = await duena.query<{ id: string }>(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [company, correo, hash],
    );
    const usuario = usuarios[0]?.id ?? '';
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       VALUES ($1, $2, 'OWNER', false)`,
      [company, usuario],
    );

    await sembrar(usuario);

    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email: correo, contrasena: CONTRASENA });
    cookie = cookieConCsrf(respuesta);
  }, 300_000);

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  it('el volumen sembrado es el que CLAUDE.md §5 nombra, no dos ubicaciones', async () => {
    const { rows } = await duena.query<{ ubicaciones: string; recetas: string; lineas: string }>(
      `SELECT
         (SELECT count(*) FROM location WHERE company_id = $1)::text     AS ubicaciones,
         (SELECT count(*) FROM recipe WHERE company_id = $1)::text       AS recetas,
         (SELECT count(*) FROM recipe_line WHERE company_id = $1)::text  AS lineas`,
      [company],
    );

    expect(rows[0]?.ubicaciones).toBe(String(UBICACIONES));
    expect(rows[0]?.recetas).toBe(String(UBICACIONES * PRODUCTOS_POR_UBICACION));
    expect(Number(rows[0]?.lineas)).toBeGreaterThan(1000);
  });

  it('el consolidado de diez ubicaciones sale por debajo de 800 ms en el p95', async (contexto) => {
    const tiempos: number[] = [];

    for (let i = 0; i < MEDICIONES; i += 1) {
      const inicio = performance.now();
      const respuesta = await request(servidor())
        .get('/consolidado')
        .query({ anio: ANIO, mes: MARZO })
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      tiempos.push(performance.now() - inicio);

      expect(respuesta.status).toBe(OK);
      expect((respuesta.body as { ubicaciones: unknown[] }).ubicaciones).toHaveLength(UBICACIONES);
    }

    const medido = p95(tiempos);
    if (!SE_EXIGE_EL_PRESUPUESTO) {
      contexto.skip(
        `consolidado p95 = ${medido.toFixed(1)} ms de ${String(PRESUPUESTO_MS)} · ${MOTIVO_TRANSPORTE}`,
      );
    }

    expect(medido, `p95 medido: ${medido.toFixed(1)} ms`).toBeLessThan(PRESUPUESTO_MS);
  }, 120_000);

});
