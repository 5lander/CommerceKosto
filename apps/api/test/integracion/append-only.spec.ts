/**
 * `audit_log` es append-only — SEGURIDAD.md §10b, AUDITORIA.md C30.
 *
 * Tres capas, y cada una cubre lo que la anterior no alcanza:
 *
 *   1. PRIVILEGIO   `REVOKE UPDATE, DELETE, TRUNCATE` para `costeo_app`
 *   2. TRIGGER      `BEFORE ... FOR EACH STATEMENT`, que alcanza a la DUEÑA
 *   3. audit:forbidden  avisa en el editor, antes de llegar a la base
 *
 * Se prueban las dos primeras. La tercera la verifica la prueba del guardián.
 *
 * EL DETALLE QUE JUSTIFICA LA PRUEBA DE LA CAPA 2. El trigger es de SENTENCIA y
 * no de fila. Con `FORCE ROW LEVEL SECURITY` activo y sin política de DELETE,
 * un `DELETE FROM audit_log` ejecutado por la dueña afecta a **cero filas**: un
 * trigger de fila nunca llegaría a dispararse y el borrado «tendría éxito» en
 * silencio. Es el tipo de fallo que solo se descubre cuando hace falta la
 * evidencia y ya no está.
 *
 * En P6 esta misma suite cubrirá `inventory_movement` (regla R3).
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL_APP = process.env['DATABASE_URL'];
const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];

if (URL_APP === undefined || URL_MIGRATOR === undefined) {
  throw new Error('Faltan DATABASE_URL y/o MIGRATION_DATABASE_URL. Ver .env.example.');
}

const PRIVILEGIO_DENEGADO = '42501';
const VIOLA_POLITICA_RLS = '42501';

describe('audit_log es append-only', () => {
  let app: Client;
  let duena: Client;

  beforeAll(async () => {
    app = new Client({ connectionString: URL_APP });
    duena = new Client({ connectionString: URL_MIGRATOR });
    await app.connect();
    await duena.connect();
  });

  afterAll(async () => {
    await app.end();
    await duena.end();
  });

  /** @returns el correlation_id del evento insertado */
  async function registrarEventoDeSistema(): Promise<string> {
    const correlacion = randomUUID();
    await app.query(
      `INSERT INTO audit_log (event_type, outcome, actor_type, correlation_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      ['system.config.changed', 'success', 'SYSTEM', correlacion, JSON.stringify({ prueba: true })],
    );
    return correlacion;
  }

  describe('capa 1 — privilegios, para la aplicación', () => {
    it('la aplicación SÍ puede escribir un evento de sistema', async () => {
      await expect(registrarEventoDeSistema()).resolves.toBeTypeOf('string');
    });

    it.each([
      ['UPDATE', `UPDATE audit_log SET outcome = 'failure'`],
      ['DELETE', 'DELETE FROM audit_log'],
      ['TRUNCATE', 'TRUNCATE audit_log'],
    ])('%s es rechazado por privilegio', async (_operacion, sql) => {
      await expect(app.query(sql)).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
    });
  });

  describe('capa 2 — trigger de sentencia, para la dueña de la tabla', () => {
    it('la DUEÑA tampoco puede borrar: la para el trigger, no el privilegio', async () => {
      await expect(duena.query('DELETE FROM audit_log')).rejects.toMatchObject({
        message: expect.stringContaining('append-only'),
      });
    });

    it('la DUEÑA tampoco puede actualizar', async () => {
      await expect(duena.query(`UPDATE audit_log SET outcome = 'failure'`)).rejects.toMatchObject({
        message: expect.stringContaining('append-only'),
      });
    });

    it('la DUEÑA tampoco puede truncar', async () => {
      await expect(duena.query('TRUNCATE audit_log')).rejects.toMatchObject({
        message: expect.stringContaining('append-only'),
      });
    });

    it('el mensaje del error dice qué hacer en su lugar', async () => {
      await expect(duena.query('DELETE FROM audit_log')).rejects.toMatchObject({
        message: expect.stringContaining('se corrige con una fila nueva'),
      });
    });
  });

  describe('RLS sobre audit_log', () => {
    it('la aplicación NO puede leer el log', async () => {
      // SEGURIDAD.md §10: el acceso al log es de solo lectura y está restringido
      // al back office. La app cliente escribe y no lee.
      const { rows } = await app.query<{ total: string }>('SELECT count(*) AS total FROM audit_log');
      expect(rows[0]?.total).toBe('0');
    });

    it('...y ese 0 es la política, no una tabla vacía', async () => {
      // La distinción importa: sin esta comprobación, la prueba anterior pasaría
      // igual con RLS desactivado y la tabla sin filas.
      await registrarEventoDeSistema();

      const superusuario = new Client({
        connectionString: URL_MIGRATOR.replace('costeo_migrator', 'postgres').replace(
          /:[^:@]+@/,
          `:${process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? ''}@`,
        ),
      });
      await superusuario.connect();
      try {
        const { rows } = await superusuario.query<{ total: string }>(
          'SELECT count(*) AS total FROM audit_log',
        );
        expect(Number(rows[0]?.total ?? '0')).toBeGreaterThan(0);
      } finally {
        await superusuario.end();
      }
    });

    it('la aplicación NO puede escribir un evento con company_id', async () => {
      // En P0 la app solo emite eventos de sistema. P1 añade la política de
      // tenant; hasta entonces, un company_id es un error de programación.
      await expect(
        app.query(
          `INSERT INTO audit_log (event_type, outcome, actor_type, correlation_id, company_id)
           VALUES ($1, $2, $3, $4, $5)`,
          ['system.config.changed', 'success', 'SYSTEM', randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: VIOLA_POLITICA_RLS });
    });
  });

  describe('restricciones de integridad', () => {
    it('rechaza un evento con fecha futura', async () => {
      // Evita que alguien con INSERT forje evidencia fuera de orden.
      await expect(
        app.query(
          `INSERT INTO audit_log (event_type, outcome, actor_type, correlation_id, at)
           VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
          ['system.config.changed', 'success', 'SYSTEM', randomUUID()],
        ),
      ).rejects.toMatchObject({ constraint: 'audit_log_at_no_es_futuro' });
    });

    it('rechaza un actor de sistema con actor_id', async () => {
      await expect(
        app.query(
          `INSERT INTO audit_log (event_type, outcome, actor_type, correlation_id, actor_id)
           VALUES ($1, $2, $3, $4, $5)`,
          ['system.config.changed', 'success', 'SYSTEM', randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ constraint: 'audit_log_actor_coherente' });
    });

    it('rechaza un tipo de evento que no está en el catálogo', async () => {
      await expect(
        app.query(
          `INSERT INTO audit_log (event_type, outcome, actor_type, correlation_id)
           VALUES ($1, $2, $3, $4)`,
          ['evento.inventado', 'success', 'SYSTEM', randomUUID()],
        ),
      ).rejects.toMatchObject({ constraint: 'audit_log_event_type_fkey' });
    });
  });
});
