/**
 * Deshacer una importación que escribió en el libro — D-16.200, contra
 * PostgreSQL real.
 *
 * **EL CRITERIO DE ACEPTACIÓN ES UNA RESTA: importa, anula, y el saldo del
 * tenant vuelve a ser el de antes.** Todo lo demás de este archivo existe para
 * que esa resta signifique algo:
 *
 *   - las filas contrarias son **filas nuevas**, no un borrado (R3): el libro
 *     acaba con el doble de movimientos y saldo cero
 *   - un mes cerrado **no se deshace** aunque venga de un archivo
 *   - anular dos veces lo dice, en vez de escribir el doble
 *   - la importación de otra company no existe para quien pregunta
 *
 * Los datos son sintéticos y se construyen aquí (CLAUDE.md §7).
 *
 * La importación no tiene endpoint de subida —se opera por línea de comandos—
 * así que se escribe por el mismo caso de uso que usa el CLI. La anulación sí
 * lo tiene, y por eso además se prueba por HTTP, que es donde se ven el permiso
 * y el código de estado.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { IniciarSesion } from '../../src/modules/iam/application/casos-de-uso/iniciar-sesion';
import {
  ValidarSesion,
  type SesionActiva,
} from '../../src/modules/iam/application/casos-de-uso/validar-sesion';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { ImportarArchivo } from '../../src/modules/imports/application/casos-de-uso/importar';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import type { LocationId } from '../../src/shared/domain/identity/identificadores';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const CONTRASENA = 'tres cebollas moradas';

/** Las compras del archivo: dos fechas, un mismo ítem, para que el saldo sea visible. */
const COMPRAS = [
  { fecha: '2026-04-10', cantidad: '10', total: '120.00' },
  { fecha: '2026-04-22', cantidad: '5', total: '61.50' },
];

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

interface Tenant {
  readonly companyId: string;
  readonly locationId: string;
  readonly correo: string;
  readonly bodega: string;
}

describe('anulación de una importación (D-16.200)', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let una: Tenant;
  let otra: Tenant;

  async function sembrarTenant(prefijo: string): Promise<Tenant> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);

    const { rows: companies } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const companyId = companies[0]?.id ?? '';

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [companyId, `${prefijo} centro`],
    );
    const locationId = locales[0]?.id ?? '';

    const correo = `${prefijo}-admin.${sufijo}@ejemplo.ec`;
    const bodega = `${prefijo}-bodega.${sufijo}@ejemplo.ec`;
    await duena.query(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE'), ($1, $4, $3, 'ACTIVE')`,
      [companyId, correo, hash, bodega],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [companyId, correo],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location, location_id)
       SELECT $1, id, 'BODEGA', true, $3 FROM app_user WHERE email = $2`,
      [companyId, bodega, locationId],
    );

    return { companyId, locationId, correo, bodega };
  }

  async function sesionDe(tenant: Tenant): Promise<SesionActiva> {
    const abierta = await app.get(IniciarSesion).ejecutar({
      email: tenant.correo,
      contrasena: CONTRASENA,
      ip: null,
      userAgent: null,
    });
    return app.get(ValidarSesion).ejecutar(abierta.token);
  }

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  /** Entra por HTTP y deja apuntado el token anti-CSRF de esa sesión. */
  async function entrar(correo: string): Promise<string> {
    return cookieConCsrf(
      await request(servidor())
        .post('/auth/login')
        .send({ email: correo, contrasena: CONTRASENA }),
    );
  }

  /** El insumo del archivo. Se crea por importación, como todo lo demás. */
  async function sembrarItem(tenant: Tenant, nombre: string): Promise<void> {
    await importar(tenant, 'ITEMS', `nombre,tipo,unidad de uso,rendimiento\n${nombre},COMPRADO,kg,1`);
  }

  async function importar(
    tenant: Tenant,
    tipo: 'ITEMS' | 'MOVIMIENTOS',
    csv: string,
  ): Promise<string> {
    const resultado = await app.get(ImportarArchivo).ejecutar(await sesionDe(tenant), {
      tipo,
      bytes: Buffer.from(csv, 'utf8'),
      nombreOriginal: `${tipo.toLowerCase()}.csv`,
      claveDeAlmacenamiento: randomUUID(),
      locationId: tenant.locationId as LocationId,
      confirmar: true,
      confirmarPrecios: true,
      vigenciaDesde: new Date('2026-04-01T12:00:00.000Z'),
    });
    return resultado.id;
  }

  /** Un archivo de compras del mismo ítem. La fecha la fija cada fila. */
  async function importarCompras(tenant: Tenant, item: string): Promise<string> {
    const filas = COMPRAS.map((c) => `${c.fecha},${item},COMPRA,${c.cantidad},${c.total},0.15`);
    return importar(tenant, 'MOVIMIENTOS', ['fecha,item,tipo,cantidad,costo total,iva', ...filas].join('\n'));
  }

  async function saldo(companyId: string, item: string): Promise<string> {
    const { rows } = await duena.query<{ saldo: string }>(
      `SELECT coalesce(sum(m.quantity), 0)::text AS saldo
         FROM inventory_movement m
         JOIN item i ON i.id = m.item_id
        WHERE m.company_id = $1 AND i.name = $2`,
      [companyId, item],
    );
    return rows[0]?.saldo ?? '0';
  }

  async function filasDelLibro(companyId: string, item: string): Promise<number> {
    const { rows } = await duena.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM inventory_movement m
         JOIN item i ON i.id = m.item_id
        WHERE m.company_id = $1 AND i.name = $2`,
      [companyId, item],
    );
    return Number(rows[0]?.n ?? '0');
  }

  async function estadoDe(id: string): Promise<string> {
    const { rows } = await duena.query<{ status: string }>(
      'SELECT status FROM import_job WHERE id = $1',
      [id],
    );
    return rows[0]?.status ?? '';
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    una = await sembrarTenant('anu');
    otra = await sembrarTenant('ona');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('el saldo vuelve a ser el de antes', () => {
    it('importa, anula, y la resta da cero — sin borrar ni una fila', async () => {
      const item = `Arroz ${sufijo}`;
      await sembrarItem(una, item);

      const antes = await saldo(una.companyId, item);
      expect(antes).toBe('0');

      const id = await importarCompras(una, item);
      expect(await saldo(una.companyId, item)).toBe('15.000000000000');
      expect(await filasDelLibro(una.companyId, item)).toBe(COMPRAS.length);

      const cookie = await entrar(una.correo);
      const respuesta = await request(servidor())
        .post(`/importaciones/${id}/anulacion`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: 'El archivo traía el mes cambiado' });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body).toMatchObject({ estado: 'ANULADA', filasAnuladas: COMPRAS.length });

      // EL SALDO VUELVE, Y EL LIBRO CRECE: es R3 en una línea.
      expect(await saldo(una.companyId, item)).toBe('0.000000000000');
      expect(await filasDelLibro(una.companyId, item)).toBe(COMPRAS.length * 2);
      expect(await estadoDe(id)).toBe('ANULADA');
    }, 120_000);

    /**
     * **Y EL DINERO TAMBIÉN VUELVE — INC-029.**
     *
     * `total_cost` es una magnitud sin signo (ADR-009 §2), así que la suma a
     * pelo de la columna NO da cero: da el doble. Lo que tiene que dar cero es
     * `compras_del_mes` de SPEC §16, que es lo que entra en el food cost real,
     * y por eso esta prueba lo pregunta **por el mismo camino que el cierre**
     * —con el signo de la cantidad aplicado— y no leyendo la columna.
     */
    it('y las compras del mes vuelven a cero, no al doble', async () => {
      const { rows } = await duena.query<{ neto: string; bruto: string }>(
        `SELECT coalesce(sum(sign(m.quantity) * m.total_cost), 0)::text AS neto,
                coalesce(sum(m.total_cost), 0)::text                   AS bruto
           FROM inventory_movement m
           JOIN item i ON i.id = m.item_id
          WHERE m.company_id = $1 AND i.name = $2 AND m.type = 'COMPRA'`,
        [una.companyId, `Arroz ${sufijo}`],
      );

      expect(Number(rows[0]?.neto ?? '1')).toBe(0);
      // Y la suma sin signo NO es cero: es la trampa de la que nació INC-029.
      expect(Number(rows[0]?.bruto ?? '0')).toBeGreaterThan(0);
    });

    it('anular dos veces es 409 y no escribe nada más', async () => {
      const item = `Azúcar ${sufijo}`;
      await sembrarItem(una, item);
      const id = await importarCompras(una, item);

      const cookie = await entrar(una.correo);
      const anular = async (): Promise<request.Response> =>
        request(servidor())
          .post(`/importaciones/${id}/anulacion`)
          .set('Cookie', cookie)
          .set('X-CSRF-Token', csrfDe(cookie))
          .send({ note: null });

      expect((await anular()).status).toBe(201);
      const filas = await filasDelLibro(una.companyId, item);

      const segunda = await anular();
      expect(segunda.status).toBe(409);
      expect(segunda.body).toMatchObject({ code: 'CONFLICTO' });
      expect(await filasDelLibro(una.companyId, item)).toBe(filas);
    }, 120_000);
  });

  describe('lo que no se puede deshacer', () => {
    it('un mes cerrado no se anula, aunque venga de un archivo', async () => {
      const item = `Sal ${sufijo}`;
      await sembrarItem(una, item);
      const id = await importarCompras(una, item);

      // El mes de las compras, cerrado a mano: cerrarlo por la vía normal exige
      // un conteo físico completo, y lo que se prueba aquí no es el cierre.
      await duena.query(
        `INSERT INTO period (company_id, location_id, year, month, starts_at, ends_at,
                             status, closed_at, closed_by)
         SELECT $1, $2, 2026, 4, '2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z',
                'CERRADO', now(), id
           FROM app_user WHERE email = $3`,
        [una.companyId, una.locationId, una.correo],
      );

      const cookie = await entrar(una.correo);
      const respuesta = await request(servidor())
        .post(`/importaciones/${id}/anulacion`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      expect(respuesta.status).toBe(409);
      expect(await filasDelLibro(una.companyId, item)).toBe(COMPRAS.length);
      expect(await estadoDe(id)).toBe('CONFIRMADA');

      await duena.query('DELETE FROM period WHERE company_id = $1 AND month = 4', [una.companyId]);
    }, 120_000);

    it('la importación de otra company no existe para quien pregunta', async () => {
      const item = `Ajeno ${sufijo}`;
      await sembrarItem(otra, item);
      const id = await importarCompras(otra, item);

      const cookie = await entrar(una.correo);
      const respuesta = await request(servidor())
        .post(`/importaciones/${id}/anulacion`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      expect(respuesta.status).toBe(404);
      // Y sigue entera: el 404 no es «no pude», es «no es tuya».
      expect(await filasDelLibro(otra.companyId, item)).toBe(COMPRAS.length);
      expect(await estadoDe(id)).toBe('CONFIRMADA');
    }, 120_000);

    it('BODEGA no puede anular: no tiene import.write', async () => {
      const item = `Vetado ${sufijo}`;
      await sembrarItem(una, item);
      const id = await importarCompras(una, item);

      const cookie = await entrar(una.bodega);
      const respuesta = await request(servidor())
        .post(`/importaciones/${id}/anulacion`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      expect(respuesta.status).toBe(403);
      // El `code`, y no solo el estado: `CsrfGuard` corre antes que
      // `PermisosGuard`, y un 403 sin comprobarlo deja pasar una prueba de
      // permisos que en realidad nunca ejercito ninguno.
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      expect(await filasDelLibro(una.companyId, item)).toBe(COMPRAS.length);
    }, 120_000);

    it('una importación que no es de movimientos se rechaza con su motivo', async () => {
      const item = `Solo item ${sufijo}`;
      const id = await importar(
        una,
        'ITEMS',
        `nombre,tipo,unidad de uso,rendimiento\n${item},COMPRADO,kg,1`,
      );

      const cookie = await entrar(una.correo);
      const respuesta = await request(servidor())
        .post(`/importaciones/${id}/anulacion`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body).toMatchObject({
        message: expect.stringContaining('no se deshace escribiendo') as unknown,
      });
    }, 120_000);
  });
});
