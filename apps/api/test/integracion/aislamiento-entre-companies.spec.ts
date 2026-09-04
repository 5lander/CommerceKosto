/**
 * `security/rls.test` de SEGURIDAD.md §11 y criterio de aceptación de P1.
 *
 * LO QUE SE PRUEBA AQUÍ NO ES QUE EL CÓDIGO FILTRE BIEN: es que **PostgreSQL
 * impide la fuga aunque el código se equivoque**. Por eso todas las
 * comprobaciones van contra la base real, con el rol `costeo_app`, y varias de
 * ellas ejercitan deliberadamente el camino equivocado.
 *
 * Las tres barreras de CLAUDE.md §4.1:
 *   1. RLS deny-by-default + FORCE + rol no superusuario  -> este archivo
 *   2. la capa de transacción-con-tenant                  -> este archivo
 *   3. el tenant sale de la sesión                        -> llega con el login
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyId, type CompanyId } from '../../src/shared/domain/identity/identificadores';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { PrismaConnection } from '../../src/shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../src/shared/infrastructure/persistence/tenant-transaction';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

const VIOLA_POLITICA_RLS = '42501';
const VIOLA_UNICIDAD = '23505';
const VIOLA_CLAVE_FORANEA = '23503';

interface Tenant {
  readonly company: CompanyId;
  readonly locationId: string;
  readonly locationName: string;
}

describe('aislamiento entre companies', () => {
  let duena: Client;
  let connection: PrismaConnection;
  let transaccion: TenantTransaction;

  let a: Tenant;
  let b: Tenant;

  /** El alta de tenant es del back office (P11): la app no tiene INSERT sobre `company`. */
  async function crearTenant(nombre: string): Promise<Tenant> {
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [nombre],
    );
    const empresa = companyId(rows[0]?.id ?? '');

    const locationName = `Local de ${nombre}`;
    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [empresa, locationName],
    );

    return { company: empresa, locationId: locales[0]?.id ?? '', locationName };
  }

  beforeAll(async () => {
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    connection = new PrismaConnection(loadConfiguration(process.env));
    transaccion = new TenantTransaction(connection);

    a = await crearTenant(`A-${randomUUID().slice(0, 8)}`);
    b = await crearTenant(`B-${randomUUID().slice(0, 8)}`);
  });

  afterAll(async () => {
    await connection.onModuleDestroy();
    await duena.end();
  });

  describe('con el tenant fijado, cada company ve lo suyo y nada más', () => {
    it('A ve su ubicación', async () => {
      const nombres = await transaccion.run(a.company, async (tx) =>
        (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
      );

      expect(nombres).toContain(a.locationName);
    });

    it('A NO ve la ubicación de B', async () => {
      const nombres = await transaccion.run(a.company, async (tx) =>
        (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
      );

      expect(nombres).not.toContain(b.locationName);
    });

    it('A no alcanza la ubicación de B NI PASANDO SU ID', async () => {
      // Es el caso que importa: el atacante no consulta a ciegas, consulta con
      // el identificador que ya conoce. RLS filtra igual.
      const encontrada = await transaccion.run(a.company, async (tx) =>
        tx.location.findUnique({ where: { id: b.locationId } }),
      );

      expect(encontrada).toBeNull();
    });

    it('A tampoco ve la company de B', async () => {
      const companies = await transaccion.run(a.company, async (tx) =>
        tx.company.findMany({ select: { id: true } }),
      );

      expect(companies.map((c) => c.id)).toEqual([a.company]);
    });
  });

  describe('sin tenant fijado: CERO filas, nunca las de otro', () => {
    it('un caso de uso que olvida la capa de tenant no ve NADA', async () => {
      // La diferencia entre "cero filas" y "las filas de otro tenant" es la
      // diferencia entre un fallo molesto y una fuga. `current_company()`
      // devuelve NULL, `company_id = NULL` es NULL, y NULL no es TRUE.
      const locales = await transaccion.runWithoutTenant('prueba: el camino equivocado', (tx) =>
        tx.location.findMany({ select: { id: true } }),
      );

      expect(locales).toEqual([]);
    });

    it('...y las ubicaciones SÍ existen: el cero es la política, no una tabla vacía', async () => {
      // Sin esta comprobación la prueba anterior pasaría igual con la tabla
      // vacía, que es una forma de no estar midiendo nada.
      const { rows } = await duena.query<{ total: string }>('SELECT count(*) AS total FROM location');

      expect(Number(rows[0]?.total ?? '0')).toBeGreaterThanOrEqual(2);
    });

    it('tampoco puede ESCRIBIR sin tenant', async () => {
      await expect(
        transaccion.runWithoutTenant('prueba: escritura sin tenant', (tx) =>
          tx.location.create({
            data: { companyId: a.company, name: `Huerfana ${randomUUID()}`, type: 'LOCAL', status: 'ACTIVE' },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('WITH CHECK: no se puede escribir en el tenant de otro', () => {
    it('con el tenant A, insertar una ubicación de B es rechazado', async () => {
      // El `USING` de la política filtra lo que se LEE. Sin `WITH CHECK`, la
      // aplicación podría escribir filas con el company_id de otro tenant: no
      // las volvería a ver, pero ya estarían escritas.
      await expect(
        transaccion.run(a.company, (tx) =>
          tx.location.create({
            data: { companyId: b.company, name: `Colada ${randomUUID()}`, type: 'LOCAL', status: 'ACTIVE' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('con el tenant A, actualizar la ubicación de B no afecta a ninguna fila', async () => {
      const afectadas = await transaccion.run(a.company, async (tx) =>
        tx.location.updateMany({ where: { id: b.locationId }, data: { name: 'Secuestrada' } }),
      );

      expect(afectadas.count).toBe(0);
    });

    it('...y el nombre de la ubicación de B sigue intacto', async () => {
      const { rows } = await duena.query<{ name: string }>('SELECT name FROM location WHERE id = $1', [
        b.locationId,
      ]);

      expect(rows[0]?.name).toBe(b.locationName);
    });
  });

  describe('el alta de tenant no es de la aplicación', () => {
    it('la aplicación NO puede crear una company', async () => {
      // SPEC §1: el alta de tenant es del back office (P11). Sin el privilegio
      // de INSERT, ninguna ruta puede fabricarse un tenant aunque el código se
      // equivoque.
      await expect(
        transaccion.run(a.company, (tx) => tx.company.create({ data: { name: 'Inventada', status: 'ACTIVE' } })),
      ).rejects.toThrow();
    });
  });

  describe('las reglas de rol viven en la base, no en un `if`', () => {
    let usuarioA: string;

    beforeAll(async () => {
      const { rows } = await duena.query<{ id: string }>(
        `INSERT INTO app_user (company_id, email, status)
         VALUES ($1, $2, 'INVITED') RETURNING id`,
        [a.company, `owner-${randomUUID().slice(0, 8)}@ejemplo.test`],
      );
      usuarioA = rows[0]?.id ?? '';
    });

    async function asignar(
      rol: string,
      location: string | null,
      usuario: string = usuarioA,
    ): Promise<void> {
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
         VALUES ($1, $2, $3, $4, $5)`,
        [a.company, usuario, rol, location, location !== null],
      );
    }

    it('GERENTE_LOCAL SIN ubicación es imposible', async () => {
      await expect(asignar('GERENTE_LOCAL', null)).rejects.toMatchObject({ code: VIOLA_CLAVE_FORANEA });
    });

    it('ADMIN CON ubicación es imposible', async () => {
      await expect(asignar('ADMIN', a.locationId)).rejects.toMatchObject({ code: VIOLA_CLAVE_FORANEA });
    });

    it('`has_location` no puede mentir sobre `location_id`', async () => {
      await expect(
        duena.query(
          `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
           VALUES ($1, $2, 'BODEGA', $3, false)`,
          [a.company, usuarioA, a.locationId],
        ),
      ).rejects.toMatchObject({ constraint: 'user_role_has_location_coherente' });
    });

    it('una company tiene un ÚNICO OWNER', async () => {
      const { rows } = await duena.query<{ id: string }>(
        `INSERT INTO app_user (company_id, email, status)
         VALUES ($1, $2, 'INVITED') RETURNING id`,
        [a.company, `segundo-${randomUUID().slice(0, 8)}@ejemplo.test`],
      );

      await asignar('OWNER', null);

      await expect(asignar('OWNER', null, rows[0]?.id ?? '')).rejects.toMatchObject({
        code: VIOLA_UNICIDAD,
      });
    });

    it('...pero DOS ADMIN conviven sin problema', async () => {
      // SPEC §4: ADMIN es "sin límite de cantidad". Es lo contrario del OWNER, y
      // por eso conviene fijarlo con una prueba: son dos reglas opuestas sobre
      // la misma tabla.
      const segundo = await duena.query<{ id: string }>(
        `INSERT INTO app_user (company_id, email, status)
         VALUES ($1, $2, 'INVITED') RETURNING id`,
        [a.company, `admin2-${randomUUID().slice(0, 8)}@ejemplo.test`],
      );

      await asignar('ADMIN', null);

      await expect(asignar('ADMIN', null, segundo.rows[0]?.id ?? '')).resolves.toBeUndefined();
    });
  });

  describe('el correo de usuario', () => {
    it('se rechaza si no está en minúsculas', async () => {
      // Sin esto, "Ana@x.com" y "ana@x.com" serían dos cuentas y el bloqueo por
      // fuerza bruta se esquivaría cambiando una mayúscula.
      await expect(
        duena.query(
          `INSERT INTO app_user (company_id, email, status) VALUES ($1, 'Ana@Ejemplo.test', 'INVITED')`,
          [a.company],
        ),
      ).rejects.toMatchObject({ constraint: 'app_user_email_en_minusculas' });
    });

    it('un usuario ACTIVE sin contraseña es imposible', async () => {
      await expect(
        duena.query(
          `INSERT INTO app_user (company_id, email, status) VALUES ($1, $2, 'ACTIVE')`,
          [a.company, `sinclave-${randomUUID().slice(0, 8)}@ejemplo.test`],
        ),
      ).rejects.toMatchObject({ constraint: 'app_user_credencial_coherente' });
    });
  });

  describe('la política de audit_log gana el tenant sin perder el sistema', () => {
    it('la aplicación escribe un evento CON tenant', async () => {
      await expect(
        transaccion.run(a.company, (tx) =>
          // `createMany` y no `create`: bajo RLS, el `RETURNING` de `create`
          // exige pasar tambien la politica de SELECT, y la de `audit_log` es
          // `USING (false)`. Ver docs/incidencias/INC-010.
          tx.auditLog.createMany({
            data: [
              {
                eventType: 'location.created',
                outcome: 'success',
                actorType: 'SYSTEM',
                companyId: a.company,
                correlationId: randomUUID(),
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('...y no puede escribir uno con el tenant de OTRO', async () => {
      await expect(
        transaccion.run(a.company, (tx) =>
          tx.auditLog.createMany({
            data: [
              {
                eventType: 'location.created',
                outcome: 'success',
                actorType: 'SYSTEM',
                companyId: b.company,
                correlationId: randomUUID(),
              },
            ],
          }),
        ),
      ).rejects.toThrow();
    });

    it('los eventos de sistema siguen entrando sin tenant (P0 no se rompió)', async () => {
      await expect(
        transaccion.runWithoutTenant('prueba: evento de sistema', (tx) =>
          tx.auditLog.createMany({
            data: [
              {
                eventType: 'system.config.changed',
                outcome: 'success',
                actorType: 'SYSTEM',
                correlationId: randomUUID(),
              },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('el rol de la aplicación sigue sin poder saltarse nada', () => {
    it('no puede desactivar RLS sobre una tabla', async () => {
      const app = new Client({ connectionString: loadConfiguration(process.env).databaseUrl });
      await app.connect();
      try {
        await expect(app.query('ALTER TABLE location DISABLE ROW LEVEL SECURITY')).rejects.toMatchObject({
          code: VIOLA_POLITICA_RLS,
        });
      } finally {
        await app.end();
      }
    });
  });
});
