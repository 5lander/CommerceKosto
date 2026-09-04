/**
 * Barrera 1 de CLAUDE.md §4.1 — la única defensa que NO depende de que nadie
 * se equivoque.
 *
 * Cierra el criterio de aceptación de P0: *"la aplicación se conecta con un rol
 * que no es superusuario, verificado por test"*.
 *
 * POR QUÉ IMPORTA TANTO. Un superusuario de PostgreSQL **ignora RLS por
 * diseño**. Si la aplicación se conectara como tal, todas las políticas que se
 * escriban a partir de P1 serían decorativas: estarían ahí, se leerían bien en
 * el diff, y no harían nada. No habría ningún síntoma hasta la primera fuga
 * entre companies.
 *
 * Se usa el cliente `pg` crudo y no Prisma a propósito: lo que se prueba es la
 * base de datos, no el ORM.
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL_APP = process.env['DATABASE_URL'];
const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];

if (URL_APP === undefined || URL_MIGRATOR === undefined) {
  throw new Error(
    'Faltan DATABASE_URL y/o MIGRATION_DATABASE_URL.\n' +
      '  cp .env.example .env  y  npm run db:up',
  );
}

/** Código SQLSTATE de "privilegio insuficiente". */
const PRIVILEGIO_DENEGADO = '42501';

describe('Barrera 1 — el rol de la aplicación', () => {
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

  it('la aplicación se conecta como costeo_app', async () => {
    const { rows } = await app.query<{ current_user: string; session_user: string }>(
      'SELECT current_user, session_user',
    );
    expect(rows[0]).toEqual({ current_user: 'costeo_app', session_user: 'costeo_app' });
  });

  it('NO es superusuario ni tiene ningún atributo peligroso', async () => {
    const { rows } = await app.query(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolinherit
      FROM pg_roles WHERE rolname = current_user`);

    // rolbypassrls es el decisivo: con él, RLS no aplicaría a este rol.
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      rolreplication: false,
      rolinherit: false,
    });
  });

  it('NO es miembro de ningún rol privilegiado', async () => {
    // Sin esto, podría heredar por la puerta de atrás lo que se le niega de frente.
    const { rows } = await app.query(`
      SELECT pg_has_role(current_user, 'costeo_migrator',   'USAGE') AS migrator,
             pg_has_role(current_user, 'pg_read_all_data',  'USAGE') AS lee_todo,
             pg_has_role(current_user, 'pg_write_all_data', 'USAGE') AS escribe_todo`);

    expect(rows[0]).toEqual({ migrator: false, lee_todo: false, escribe_todo: false });
  });

  it('NO es dueña de ninguna tabla; la dueña es costeo_migrator', async () => {
    const { rows } = await app.query<{ tablename: string; tableowner: string }>(
      `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public'`,
    );

    // Que no pase por vacío: si no hubiera tablas, la comprobación sería trivial.
    expect(rows.length).toBeGreaterThan(0);
    for (const tabla of rows) expect(tabla.tableowner).toBe('costeo_migrator');
  });

  it('NO puede crear ni destruir objetos', async () => {
    const { rows } = await app.query(`
      SELECT has_schema_privilege  (current_user, 'public', 'CREATE')           AS crear_en_esquema,
             has_database_privilege(current_user, current_database(), 'CREATE') AS crear_en_base,
             has_database_privilege(current_user, current_database(), 'TEMP')   AS tablas_temporales`);

    // TEMP importa: una tabla temporal materializa datos fuera del alcance de RLS.
    expect(rows[0]).toEqual({ crear_en_esquema: false, crear_en_base: false, tablas_temporales: false });

    await expect(app.query('CREATE TABLE sonda (x int)')).rejects.toMatchObject({
      code: PRIVILEGIO_DENEGADO,
    });
    await expect(app.query('DROP TABLE audit_log')).rejects.toMatchObject({
      code: PRIVILEGIO_DENEGADO,
    });
  });

  it('NO puede leer los hashes de contraseña del clúster', async () => {
    await expect(app.query('SELECT rolpassword FROM pg_authid')).rejects.toMatchObject({
      code: PRIVILEGIO_DENEGADO,
    });
  });

  it('NO puede tocar el historial de migraciones', async () => {
    await expect(app.query('SELECT migration_name FROM "_prisma_migrations"')).rejects.toMatchObject({
      code: PRIVILEGIO_DENEGADO,
    });
  });

  it('los DEFAULT PRIVILEGES conceden SELECT e INSERT, nunca UPDATE ni DELETE', async () => {
    // Es la decisión de docker/postgres/initdb/sql/grants.sql: si alguien olvida
    // un GRANT UPDATE, la funcionalidad falla en seguida y se ve. Con el orden
    // inverso, olvidar un REVOKE convertiría una tabla append-only en mutable
    // sin que nada se rompiera.
    const { rows } = await duena.query<{ acl: string }>(`
      SELECT defaclacl::text AS acl
      FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole
      WHERE r.rolname = 'costeo_migrator' AND d.defaclobjtype = 'r'`);

    const acl = rows[0]?.acl ?? '';
    expect(acl).toContain('costeo_app=ar/'); // a = INSERT, r = SELECT
    expect(acl).not.toMatch(/costeo_app=[^/]*[wd]/); // ni w = UPDATE ni d = DELETE
  });

  it('toda tabla tiene RLS habilitado Y forzado', async () => {
    // FORCE es lo que hace que la política alcance también a la dueña de la
    // tabla. Sin él, `costeo_migrator` vería y modificaría todo.
    const { rows } = await duena.query<{ relname: string }>(`
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname <> '_prisma_migrations'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);

    expect(rows.map((fila) => fila.relname)).toEqual([]);
  });
});
