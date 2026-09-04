/**
 * El presupuesto de rendimiento del inventario, medido — no supuesto.
 *
 *   «Vista de inventario de una ubicación con 500 ítems: **< 300 ms**» (p95)
 *   «Probar con volumen sintético realista, **nunca con 20 filas**»
 *   — CLAUDE.md §5
 *
 * **EL VOLUMEN QUE IMPORTA AQUÍ NO ES EL DE ÍTEMS, SINO EL DE MOVIMIENTOS.** El
 * saldo es una agregación sobre el libro, y el libro crece para siempre: 500
 * ítems con dos movimientos cada uno es un inventario del primer día. Se siembra
 * un año de operación —**24 movimientos por ítem, 12.000 filas**— porque es con
 * ese tamaño donde un `Seq Scan` empieza a doler, y es el tamaño que cualquier
 * cliente real alcanza sin hacer nada raro.
 *
 * **DOS COSAS SE COMPRUEBAN, Y LA SEGUNDA ES LA QUE DURA.** El tiempo depende de
 * la máquina y del día; el PLAN de ejecución no. Un `Seq Scan` sobre
 * `inventory_movement` pasa el umbral con 12.000 filas y deja de pasarlo con
 * medio millón, así que se exige además que el índice se use.
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

/** El volumen que CLAUDE.md §5 nombra para el inventario, no uno cómodo. */
const ITEMS = 500;
/** Un año de operación: dos movimientos por ítem y mes. */
const MOVIMIENTOS_POR_ITEM = 24;
const PRESUPUESTO_MS = 300;
const MEDICIONES = 20;
/**
 * Ubicaciones de RUIDO, y son imprescindibles.
 *
 * Sin ellas la tabla entera pertenece a la ubicación que se consulta, el filtro
 * no descarta nada y PostgreSQL elige —correctamente— un `Seq Scan`. La prueba
 * del plan pasaría o fallaría por un motivo que no tiene que ver con el índice.
 * Es la lección de INC-007 aplicada a un dato en vez de a un glob: un check
 * sobre volumen irreal no mide nada.
 *
 * Con 20 ubicaciones, la que se mide es el 5 % de la tabla, que es la
 * selectividad de un inventario multi-ubicación de verdad.
 */
const UBICACIONES_DE_RUIDO = 19;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

function p95(muestras: readonly number[]): number {
  const ordenadas = [...muestras].sort((a, b) => a - b);
  const indice = Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1);
  return ordenadas[indice] ?? 0;
}

describe('rendimiento del inventario con volumen realista', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let ubicacion: string;
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
      [`inventario volumen ${sufijo}`],
    );
    company = rows[0]?.id ?? '';

    const { rows: ubicaciones } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, 'Bodega', 'BODEGA', 'ACTIVE') RETURNING id`,
      [company],
    );
    ubicacion = ubicaciones[0]?.id ?? '';

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
   * 500 ítems y 12.000 movimientos, con `generate_series`.
   *
   * Un movimiento de cada dos entra y el otro sale, de modo que los saldos
   * queden en el orden de magnitud de un inventario real y no en el de una
   * bodega que solo compra. El `CHECK` de signo obliga a que la cantidad
   * concuerde con la dirección, así que la fórmula del signo no es decorativa:
   * si estuviera mal, la siembra no entraría.
   */
  async function sembrarVolumen(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO item (company_id, name, type, unit_of_use, yield, status, price_confidence)
       SELECT $1, 'Insumo ' || n, 'COMPRADO', 'g', 1.00, 'ACTIVE', 'FACTURA'
       FROM generate_series(1, $2) AS n`,
      [company, ITEMS],
    );

    await duena.query(
      `INSERT INTO inventory_movement
         (company_id, location_id, item_id, type, direction, quantity, total_cost,
          occurred_at, created_by)
       SELECT $1, $2, i.id,
              CASE WHEN k % 2 = 0 THEN 'COMPRA' ELSE 'CONSUMO_POR_VENTA' END,
              CASE WHEN k % 2 = 0 THEN 'ENTRADA' ELSE 'SALIDA' END,
              CASE WHEN k % 2 = 0 THEN 1000 ELSE -900 END,
              CASE WHEN k % 2 = 0 THEN 25.00 ELSE NULL END,
              now() - (k || ' days')::interval,
              $3
       FROM item i, generate_series(1, $4) AS k
       WHERE i.company_id = $1`,
      [company, ubicacion, usuario, MOVIMIENTOS_POR_ITEM],
    );

    await sembrarRuido(usuario);
    await duena.query('ANALYZE inventory_movement');
  }

  /**
   * El mismo volumen en otras 19 ubicaciones de la company.
   *
   * No cambia lo que se mide —la consulta sigue pidiendo UNA ubicación— pero sí
   * lo que la tabla contiene, que es de lo que depende el plan.
   */
  async function sembrarRuido(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO location (company_id, name, type, status)
       SELECT $1, 'Bodega ruido ' || n, 'BODEGA', 'ACTIVE'
       FROM generate_series(1, $2) AS n`,
      [company, UBICACIONES_DE_RUIDO],
    );

    await duena.query(
      `INSERT INTO inventory_movement
         (company_id, location_id, item_id, type, direction, quantity, total_cost,
          occurred_at, created_by)
       SELECT $1, l.id, i.id,
              CASE WHEN k % 2 = 0 THEN 'COMPRA' ELSE 'CONSUMO_POR_VENTA' END,
              CASE WHEN k % 2 = 0 THEN 'ENTRADA' ELSE 'SALIDA' END,
              CASE WHEN k % 2 = 0 THEN 1000 ELSE -900 END,
              CASE WHEN k % 2 = 0 THEN 25.00 ELSE NULL END,
              now() - (k || ' days')::interval,
              $2
       FROM item i, location l, generate_series(1, $3) AS k
       WHERE i.company_id = $1 AND l.company_id = $1 AND l.id <> $4`,
      [company, usuario, MOVIMIENTOS_POR_ITEM, ubicacion],
    );
  }

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  it('el volumen sembrado es el que dice el presupuesto, no veinte filas', async () => {
    const { rows } = await duena.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM inventory_movement WHERE company_id = $1`,
      [company],
    );
    expect(Number(rows[0]?.total ?? '0')).toBe(
      ITEMS * MOVIMIENTOS_POR_ITEM * (UBICACIONES_DE_RUIDO + 1),
    );
  });

  it('el inventario de la ubicación sale por debajo de 300 ms en el p95', async () => {
    const tiempos: number[] = [];

    for (let vuelta = 0; vuelta < MEDICIONES; vuelta += 1) {
      const inicio = performance.now();
      const respuesta = await request(servidor())
        .get('/inventario/saldos')
        .query({ locationId: ubicacion })
        .set('Cookie', cookie);
      tiempos.push(performance.now() - inicio);

      expect(respuesta.status).toBe(OK);
      expect((respuesta.body as unknown[]).length).toBe(ITEMS);
    }

    const medido = p95(tiempos);
    expect(medido, `p95 medido: ${medido.toFixed(1)} ms`).toBeLessThan(PRESUPUESTO_MS);
  });

  it('la agregación del saldo usa el índice, no un Seq Scan', async () => {
    const { rows } = await duena.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT item_id, SUM(quantity) FROM inventory_movement
        WHERE company_id = $1 AND location_id = $2
        GROUP BY item_id`,
      [company, ubicacion],
    );

    const plan = rows.map((fila) => fila['QUERY PLAN']).join('\n');
    expect(plan).not.toContain('Seq Scan on inventory_movement');
  });

  it('el libro paginado de un ítem también usa el índice', async () => {
    const { rows: items } = await duena.query<{ id: string }>(
      `SELECT id FROM item WHERE company_id = $1 LIMIT 1`,
      [company],
    );

    const { rows } = await duena.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, quantity FROM inventory_movement
        WHERE company_id = $1 AND location_id = $2 AND item_id = $3
        ORDER BY occurred_at DESC, id DESC LIMIT 50`,
      [company, ubicacion, items[0]?.id ?? ''],
    );

    const plan = rows.map((fila) => fila['QUERY PLAN']).join('\n');
    expect(plan).not.toContain('Seq Scan on inventory_movement');
  });
});
