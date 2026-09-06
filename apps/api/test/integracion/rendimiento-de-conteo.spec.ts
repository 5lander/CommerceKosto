/**
 * El presupuesto de la conciliación — CLAUDE.md §5.
 *
 * «Vista de inventario de una ubicación con 500 ítems: **< 300 ms** (p95)». La
 * conciliación de un conteo es esa vista: 500 líneas, cada una con su cantidad
 * contada, su stock teórico y su costo.
 *
 * **SOBRE UN CONTEO CONFIRMADO NO SE CALCULA NADA**, y eso es lo que se mide
 * aquí: la conciliación de un mes cerrado es una lectura de `physical_count_line`
 * más el catálogo. Si el número no cumpliera el presupuesto con esa forma, el
 * problema no sería el índice sino la decisión de congelar (ADR-010 §6).
 *
 * **Y SE MIDE TAMBIÉN LA GUARDA DEL PERÍODO**, porque es la consulta más
 * repetida que P7 añade: la hace **toda** escritura del libro, una vez por
 * movimiento. Una escritura que costara diez milisegundos de más se multiplica
 * por cada compra de cada ubicación de cada company.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { CalendarioDePeriodos } from '../../src/modules/periods/domain/periodo';
import { ZONA_HORARIA_DE_PERIODOS } from '../../src/shared/infrastructure/config/periods';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { MOTIVO_TRANSPORTE, SE_EXIGE_EL_PRESUPUESTO } from '../soporte/transporte';

const OK = 200;
const CREADO = 201;

const CLAVE = 'nueve panes de ayer';
const ITEMS = 500;
const MOVIMIENTOS_POR_ITEM = 24;
const PRESUPUESTO_MS = 300;
const MEDICIONES = 20;

/**
 * Ubicaciones de ruido, por la misma razón que en el rendimiento del libro: sin
 * ellas la tabla entera pertenece a la ubicación que se consulta, el filtro no
 * descarta nada y PostgreSQL elige —correctamente— un `Seq Scan`. Una prueba de
 * plan sobre volumen irreal no mide nada (INC-007, caso 8).
 */
const UBICACIONES_DE_RUIDO = 19;

const CALENDARIO = new CalendarioDePeriodos(ZONA_HORARIA_DE_PERIODOS);
const MARZO = CALENDARIO.de(2026, 3);

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

function p95(muestras: readonly number[]): number {
  const ordenadas = [...muestras].sort((izquierda, derecha) => izquierda - derecha);
  const indice = Math.min(ordenadas.length - 1, Math.ceil(ordenadas.length * 0.95) - 1);
  return ordenadas[indice] ?? 0;
}

describe('rendimiento del conteo fisico', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let company: string;
  let medida: string;
  let countId: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function plan(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
      [...valores],
    );
    return rows.map((fila) => fila['QUERY PLAN']).join('\n');
  }

  /**
   * 500 ítems, 12.000 movimientos y un conteo confirmado con sus 500 líneas
   * congeladas, sembrados en SQL: por la API serían diez minutos de peticiones
   * para preparar una medición de diez segundos.
   */
  async function sembrar(usuario: string): Promise<void> {
    await duena.query(
      `INSERT INTO item (company_id, name, type, unit_of_use, yield, status, price_confidence)
       SELECT $1, 'Insumo ' || n, 'COMPRADO', 'g', 1.00, 'ACTIVE', 'FACTURA'
       FROM generate_series(1, $2) AS n`,
      [company, ITEMS],
    );

    for (const ubicacion of await ubicaciones()) {
      await duena.query(
        `INSERT INTO inventory_movement
           (company_id, location_id, item_id, type, direction, quantity, total_cost,
            occurred_at, created_by)
         SELECT $1, $2, i.id,
                CASE WHEN k % 2 = 0 THEN 'COMPRA' ELSE 'CONSUMO_POR_VENTA' END,
                CASE WHEN k % 2 = 0 THEN 'ENTRADA' ELSE 'SALIDA' END,
                CASE WHEN k % 2 = 0 THEN 1000 ELSE -900 END,
                CASE WHEN k % 2 = 0 THEN 25.00 ELSE NULL END,
                $3::timestamptz - (k || ' days')::interval,
                $4
         FROM item i, generate_series(1, $5) AS k
         WHERE i.company_id = $1`,
        [company, ubicacion, MARZO.finEn.toISOString(), usuario, MOVIMIENTOS_POR_ITEM],
      );

      // Un ano de meses cerrados por ubicacion: es lo que la guarda del periodo
      // tiene que descartar en cada escritura del libro.
      await duena.query(
        `INSERT INTO period (company_id, location_id, year, month, starts_at, ends_at,
                             status, closed_at, closed_by)
         SELECT $1, $2, 2025, m,
                make_timestamptz(2025, m, 1, 0, 0, 0, 'America/Guayaquil'),
                make_timestamptz(2025, m, 1, 0, 0, 0, 'America/Guayaquil') + interval '1 month',
                'CERRADO', now(), $3
         FROM generate_series(1, 12) AS m`,
        [company, ubicacion, usuario],
      );
    }

    await duena.query('ANALYZE inventory_movement');
    await duena.query('ANALYZE period');
  }

  async function ubicaciones(): Promise<readonly string[]> {
    const { rows } = await duena.query<{ id: string }>(
      `SELECT id FROM location WHERE company_id = $1 ORDER BY name`,
      [company],
    );
    return rows.map((fila) => fila.id);
  }

  /** El conteo del mes, confirmado y con sus 500 lineas ya congeladas. */
  async function sembrarConteo(usuario: string): Promise<string> {
    const { rows: periodos } = await duena.query<{ id: string }>(
      `INSERT INTO period (company_id, location_id, year, month, starts_at, ends_at, status)
       VALUES ($1, $2, 2026, 3, $3, $4, 'ABIERTO') RETURNING id`,
      [company, medida, MARZO.inicioEn.toISOString(), MARZO.finEn.toISOString()],
    );
    const periodId = periodos[0]?.id ?? '';

    // BORRADOR primero y CONFIRMADO al final, EN ESE ORDEN. El trigger
    // `physical_count_line_solo_en_borrador` rechaza tocar las lineas de un
    // conteo ya confirmado — tambien al dueno de la tabla —, asi que sembrar al
    // reves falla. Es el mismo orden que el repositorio se ve obligado a seguir,
    // y esta siembra lo comprobo por las malas.
    const { rows: conteos } = await duena.query<{ id: string }>(
      `INSERT INTO physical_count (company_id, period_id, status, cutoff_at, created_by)
       VALUES ($1, $2, 'BORRADOR', $3, $4) RETURNING id`,
      [company, periodId, MARZO.finEn.toISOString(), usuario],
    );
    const id = conteos[0]?.id ?? '';

    await duena.query(
      `INSERT INTO physical_count_line
         (company_id, count_id, item_id, quantity, theoretical_quantity, unit_cost)
       SELECT $1, $2, i.id, 1100, 1200, 0.35 FROM item i WHERE i.company_id = $1`,
      [company, id],
    );

    await duena.query(
      `UPDATE physical_count
          SET status = 'CONFIRMADO', confirmed_period_id = period_id,
              theoretical_value = 0, covered_value = 0, physical_value = 0,
              confirmed_at = now(), confirmed_by = $2
        WHERE id = $1`,
      [id, usuario],
    );
    return id;
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

    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`rendimiento conteo ${sufijo}`],
    );
    company = rows[0]?.id ?? '';

    for (let numero = 0; numero <= UBICACIONES_DE_RUIDO; numero += 1) {
      await duena.query(
        `INSERT INTO location (company_id, name, type, status)
         VALUES ($1, $2, 'BODEGA', 'ACTIVE')`,
        [company, `Bodega ${String(numero).padStart(2, '0')}`],
      );
    }
    medida = (await ubicaciones())[0] ?? '';

    const correo = `medidor.${sufijo}@snacklab.ec`;
    const { rows: usuarios } = await duena.query<{ id: string }>(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [company, correo, await new Argon2Hasher().hash(CLAVE)],
    );
    const usuario = usuarios[0]?.id ?? '';
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       VALUES ($1, $2, 'ADMIN', false)`,
      [company, usuario],
    );

    const login = await request(servidor())
      .post('/auth/login')
      .send({ email: correo, contrasena: CLAVE });
    expect(login.status).toBe(OK);
    cookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';

    await sembrar(usuario);
    countId = await sembrarConteo(usuario);
  }, 300_000);

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  it('la conciliacion de 500 items cumple el presupuesto de 300 ms', async (contexto) => {

    const muestras: number[] = [];

    for (let intento = 0; intento < MEDICIONES; intento += 1) {
      const arranque = performance.now();
      const respuesta = await request(servidor())
        .get(`/conteos/${countId}`)
        .set('Cookie', cookie);
      muestras.push(performance.now() - arranque);
      expect(respuesta.status).toBe(OK);
      expect((respuesta.body as { filas: unknown[] }).filas).toHaveLength(ITEMS);
    }

    const medido = p95(muestras);
    // El numero se publica SIEMPRE, se exija o no: nadie deberia perder de
    // vista el rendimiento por trabajar en Windows. Va en el motivo del salto
    // porque `no-console` esta prohibido, y ahi se lee igual de bien.
    if (!SE_EXIGE_EL_PRESUPUESTO) {
      contexto.skip(
        `conteo p95 = ${medido.toFixed(1)} ms de ${String(PRESUPUESTO_MS)} · ${MOTIVO_TRANSPORTE}`,
      );
    }

    expect(medido, `p95 medido: ${medido.toFixed(1)} ms`).toBeLessThan(PRESUPUESTO_MS);
  }, 120_000);

  /**
   * La guarda del período se paga en CADA escritura del libro, así que lo que
   * se mide es el `POST` completo: sesión, alcance, guarda, trigger e inserción.
   */
  it('registrar un movimiento con 240 periodos cerrados en la tabla sigue en presupuesto', async (contexto) => {

    const { rows } = await duena.query<{ id: string }>(
      `SELECT id FROM item WHERE company_id = $1 LIMIT 1`,
      [company],
    );
    const muestras: number[] = [];

    for (let intento = 0; intento < MEDICIONES; intento += 1) {
      const arranque = performance.now();
      const respuesta = await request(servidor())
        .post('/inventario/movimientos')
        .set('Cookie', cookie)
        .send({
          locationId: medida,
          itemId: rows[0]?.id ?? '',
          tipo: 'COMPRA',
          cantidad: '1',
          costoTotal: '1.00',
          purchaseArticleId: null,
          occurredAt: '2026-06-15T12:00:00.000Z',
          note: null,
        });
      muestras.push(performance.now() - arranque);
      expect(respuesta.status).toBe(CREADO);
    }

    const medido = p95(muestras);
    // El numero se publica SIEMPRE, se exija o no: nadie deberia perder de
    // vista el rendimiento por trabajar en Windows. Va en el motivo del salto
    // porque `no-console` esta prohibido, y ahi se lee igual de bien.
    if (!SE_EXIGE_EL_PRESUPUESTO) {
      contexto.skip(
        `conteo p95 = ${medido.toFixed(1)} ms de ${String(PRESUPUESTO_MS)} · ${MOTIVO_TRANSPORTE}`,
      );
    }

    expect(medido, `p95 medido: ${medido.toFixed(1)} ms`).toBeLessThan(PRESUPUESTO_MS);
  }, 120_000);

  /**
   * EL SALDO HASTA EL CORTE ES LA CONSULTA QUE SÍ NECESITA ÍNDICE, porque el
   * libro crece para siempre. Se exige el plan, no el tiempo: el tiempo depende
   * de la máquina y del día; el plan no.
   */
  it('el saldo hasta el corte usa el indice del libro, no un Seq Scan', async () => {
    const salida = await plan(
      `SELECT item_id, SUM(quantity) FROM inventory_movement
        WHERE company_id = $1 AND location_id = $2 AND occurred_at < $3
        GROUP BY item_id`,
      [company, medida, MARZO.finEn.toISOString()],
    );

    expect(salida).toContain('Index Scan');
    expect(salida).not.toContain('Seq Scan on inventory_movement');
  });

  /**
   * LA GUARDA DEL PERÍODO SE MIDE POR TIEMPO Y **NO** POR PLAN, y la diferencia
   * es deliberada.
   *
   * Con 240 filas PostgreSQL elige el índice —se comprobó, y el `EXPLAIN` está
   * en la evidencia de P7—, pero `period` es una tabla diminuta: doce filas por
   * ubicación y año. En una company de una sola ubicación cabrá en una página y
   * un `Seq Scan` será la elección **correcta**. Exigir `Index Scan` aquí
   * rompería la prueba por un plan que está bien, que es la otra mitad de la
   * lección de INC-007: un check de plan tiene que aceptar el plan bueno.
   *
   * Lo que sí importa —porque se paga en cada escritura del libro— es que sea
   * barata en términos absolutos.
   */
  it('la guarda del periodo se resuelve en menos de un milisegundo', async () => {
    const salida = await plan(
      `SELECT 1 FROM period
        WHERE company_id = $1 AND location_id = $2 AND status = 'CERRADO'
          AND $3::timestamptz >= starts_at AND $3::timestamptz < ends_at`,
      [company, medida, '2025-06-15T12:00:00.000Z'],
    );

    const medido = /Execution Time: ([\d.]+) ms/u.exec(salida)?.[1] ?? '999';
    expect(Number.parseFloat(medido)).toBeLessThan(1);
  });
});
