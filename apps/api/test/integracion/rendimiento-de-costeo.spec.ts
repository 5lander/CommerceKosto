/**
 * El presupuesto de rendimiento de CLAUDE.md §5, medido — no supuesto.
 *
 *   «Costeo completo de un catálogo de 200 productos con 1.500 líneas de
 *    receta: **< 400 ms** (p95)»
 *   «Probar con volumen sintético realista, **nunca con 20 filas**»
 *
 * **AQUÍ EMPIEZA A MEDIRSE EL PRESUPUESTO**, y es el ítem 6 de lo que P5 debía
 * cerrar. P0–P4 lo dejaron escrito; sin volumen no significaba nada: cualquier
 * consulta es rápida sobre veinte filas, incluido un `Seq Scan`.
 *
 * DOS COSAS SE COMPRUEBAN, Y LA SEGUNDA ES LA QUE DURA. El tiempo depende de la
 * máquina y del día; el PLAN de ejecución no. Un `Seq Scan` sobre `recipe`
 * sigue pasando el umbral de 400 ms con este volumen y deja de pasarlo con diez
 * veces más, así que se exige además que el índice se use.
 *
 * EL VOLUMEN SE SIEMBRA POR SQL como `costeo_migrator`, no por la API: montar
 * 200 productos a golpe de HTTP tardaría minutos y estaría midiendo el
 * servidor de pruebas, no el costeo.
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

const OK = 200;
const CONTRASENA = 'tres cebollas moradas';

/** El volumen que CLAUDE.md §5 nombra, no uno cómodo. */
const PRODUCTOS = 200;
const ITEMS = 300;
const LINEAS_POR_PRODUCTO = 8;
const PRESUPUESTO_MS = 400;
const MEDICIONES = 20;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

/** El percentil 95 de una lista de tiempos, que es lo que el presupuesto fija. */
function p95(muestras: readonly number[]): number {
  const ordenadas = [...muestras].sort((a, b) => a - b);
  const indice = Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1);
  return ordenadas[indice] ?? 0;
}

describe('rendimiento del costeo con volumen realista', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let centro: string;
  let company: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
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

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`volumen ${sufijo}`],
    );
    company = rows[0]?.id ?? '';

    const { rows: ubicaciones } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, 'Centro', 'LOCAL', 'ACTIVE') RETURNING id`,
      [company],
    );
    centro = ubicaciones[0]?.id ?? '';

    const correo = `admin.${sufijo}@snacklab.ec`;
    const { rows: usuarios } = await duena.query<{ id: string }>(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [company, correo, hash],
    );
    const usuario = usuarios[0]?.id ?? '';
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       VALUES ($1, $2, 'ADMIN', false)`,
      [company, usuario],
    );

    await sembrarVolumen(usuario);

    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email: correo, contrasena: CONTRASENA });
    cookie = (respuesta.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  }, 180_000);

  /**
   * 300 ítems con precio confirmado, 200 productos activos con PVP y 1.600
   * líneas de receta. Con `generate_series`, en unos segundos.
   */
  async function sembrarVolumen(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO item (company_id, name, type, unit_of_use, yield, status, price_confidence)
       SELECT $1, 'Insumo ' || n, 'COMPRADO', 'g', 0.85, 'ACTIVE', 'FACTURA'
       FROM generate_series(1, $2) AS n`,
      [company, ITEMS],
    );

    await duena.query(
      `INSERT INTO purchase_article
         (company_id, item_id, name, presentation_amount, presentation_unit, conversion_factor, status)
       SELECT $1, i.id, 'Presentacion ' || i.name, 1000, 'kg', 1000, 'ACTIVE'
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
      [company, PRODUCTOS],
    );

    await duena.query(
      `INSERT INTO product_location (company_id, product_id, location_id, activo, pvp, rendimiento_porciones)
       SELECT $1, p.id, $2, true, 6.50, 4
       FROM product p WHERE p.company_id = $1`,
      [company, centro],
    );

    await duena.query(
      `INSERT INTO recipe (company_id, location_id, product_id, status, valid_from, created_by)
       SELECT $1, $2, p.id, 'ACTIVE', TIMESTAMPTZ '2026-01-01', $3
       FROM product p WHERE p.company_id = $1`,
      [company, centro, usuario],
    );

    // 8 líneas por producto = 1.600, repartidas sobre los 300 ítems: es el
    // reparto realista, donde los mismos insumos se repiten en muchos platos y
    // la memorización de la cascada tiene algo que memorizar.
    await duena.query(
      // El item de cada linea sale de `(receta * 7 + linea * 13) mod 300`. No
      // es decorativo: 13 x 8 = 104 < 300, asi que las ocho lineas de una
      // receta caen SIEMPRE en items distintos —el indice unico
      // (recipe_id, item_id) lo exige— y a la vez los mismos insumos se repiten
      // entre platos, que es el reparto real de una carta y lo que le da
      // trabajo a la memorizacion de la cascada.
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
       CROSS JOIN generate_series(0, $2 - 1) AS k
       JOIN i ON i.ino = ((r.rn * 7 + k * 13) % $3)`,
      [company, LINEAS_POR_PRODUCTO, ITEMS],
    );

    await duena.query('ANALYZE');
  }

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  it('el volumen sembrado es el que CLAUDE.md §5 nombra, no veinte filas', async () => {
    const { rows } = await duena.query<{ productos: string; lineas: string }>(
      `SELECT (SELECT count(*) FROM product WHERE company_id = $1) AS productos,
              (SELECT count(*) FROM recipe_line WHERE company_id = $1) AS lineas`,
      [company],
    );

    expect(Number(rows[0]?.productos)).toBe(PRODUCTOS);
    expect(Number(rows[0]?.lineas)).toBeGreaterThanOrEqual(1500);
  });

  it('costea la carta entera por debajo de 400 ms en el p95', async () => {
    const tiempos: number[] = [];

    for (let i = 0; i < MEDICIONES; i += 1) {
      const inicio = performance.now();
      const respuesta = await request(servidor())
        .get('/costeo')
        .query({ locationId: centro })
        .set('Cookie', cookie);
      tiempos.push(performance.now() - inicio);

      expect(respuesta.status).toBe(OK);
      expect((respuesta.body as { productos: unknown[] }).productos).toHaveLength(PRODUCTOS);
    }

    const medido = p95(tiempos);
    // El número sale en el informe de auditoría: un presupuesto que se cumple
    // por poco es una alarma, no un aprobado.
    expect(medido, `p95 medido: ${medido.toFixed(1)} ms`).toBeLessThan(PRESUPUESTO_MS);
  }, 120_000);

  it('la consulta de recetas usa el índice, no un Seq Scan', async () => {
    // ES LA MITAD QUE DURA. El tiempo depende de la máquina; el plan no. Un
    // `Seq Scan` pasa el umbral con este volumen y deja de pasarlo con diez
    // veces más, que es cuando el cliente ya está en producción.
    const { rows } = await duena.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, product_id, item_id, status, valid_from
       FROM recipe
       WHERE company_id = $1 AND location_id = $2 AND valid_from <= now()
       ORDER BY valid_from DESC, created_at DESC`,
      [company, centro],
    );

    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('recipe_por_ubicacion_y_vigencia');
    expect(plan).not.toContain('Seq Scan on recipe');
  });

  it('la consulta de precios vigentes usa el índice de CLAUDE.md §5', async () => {
    const { rows } = await duena.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT item_id, price, iva_compra, valid_from
       FROM reference_price
       WHERE company_id = $1 AND status = 'CONFIRMED' AND valid_from <= now()
       ORDER BY item_id, valid_from DESC`,
      [company],
    );

    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).not.toContain('Seq Scan on reference_price');
  });
});
