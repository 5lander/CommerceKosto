/**
 * El catálogo, contra la API real y PostgreSQL real — criterio de aceptación de P2.
 *
 *   - tres artículos de distinta marca apuntan al mismo ítem, y en la lista de
 *     ítems aparece **uno**
 *   - una conversión inválida (kg → unidades sin factor) se rechaza
 *   - el catálogo de unidades es de SOLO LECTURA para la aplicación
 *   - un ítem no se puede borrar: se archiva
 *   - `GERENTE_LOCAL` lee el catálogo y no lo escribe
 *   - dos companies no se ven los ítems
 *
 * El aislamiento entre companies ya lo prueba `aislamiento-entre-companies`;
 * aquí se comprueba sobre las tablas NUEVAS, porque una tabla sin política es
 * exactamente el fallo que la comprobación M6 de `audit:migrations` existe para
 * impedir y conviene verlo también desde arriba.
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
const CREADO = 201;
const SIN_CONTENIDO = 204;
const PETICION_INVALIDA = 400;
const PROHIBIDO = 403;
const CONFLICTO = 409;

const CONTRASENA = 'tres cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

describe('catálogo', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let admin: string;
  let gerente: string;
  let otraAdmin: string;
  let cookieAdmin: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function sembrarTenant(prefijo: string): Promise<{ admin: string; gerente: string }> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);

    const { rows: companies } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const company = companies[0]?.id ?? '';

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [company, `${prefijo} centro`],
    );
    const local = locales[0]?.id ?? '';

    const crear = async (nombre: string): Promise<string> => {
      const correo = `${prefijo}-${nombre}.${sufijo}@snacklab.ec`;
      await duena.query(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'ACTIVE')`,
        [company, correo, hash],
      );
      return correo;
    };

    const correoAdmin = await crear('admin');
    const correoGerente = await crear('gerente');

    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, correoAdmin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'GERENTE_LOCAL', $2, true FROM app_user WHERE email = $3`,
      [company, local, correoGerente],
    );

    return { admin: correoAdmin, gerente: correoGerente };
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CONTRASENA });

    expect(respuesta.status).toBe(OK);
    return (respuesta.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  }

  function crearItem(cookie: string, cambios: Cuerpo = {}) {
    return request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie)
      .send({
        nombre: `Harina ${randomUUID().slice(0, 8)}`,
        tipo: 'COMPRADO',
        unidadDeUso: 'g',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: null,
        ...cambios,
      });
  }

  function crearArticulo(cookie: string, cuerpo: Cuerpo) {
    return request(servidor())
      .post('/catalogo/articulos')
      .set('Cookie', cookie)
      .send({
        marca: null,
        proveedor: null,
        factorExplicito: null,
        ivaTarifa: '0.15',
        ...cuerpo,
      });
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

    const una = await sembrarTenant('cat');
    const otra = await sembrarTenant('cot');
    admin = una.admin;
    gerente = una.gerente;
    otraAdmin = otra.admin;

    cookieAdmin = await entrar(admin);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('N artículos → 1 ítem', () => {
    it('tres marcas distintas apuntan al mismo ítem, y el ítem es uno solo', async () => {
      const item = await crearItem(cookieAdmin, { nombre: `Harina de trigo ${sufijo}` });
      expect(item.status).toBe(CREADO);
      const itemId = (item.body as { id: string }).id;

      for (const marca of ['Ya', 'Santa Lucía', 'Superior']) {
        const articulo = await crearArticulo(cookieAdmin, {
          itemId,
          nombre: `Harina ${marca} 2kg ${sufijo}`,
          marca,
          presentacion: '2',
          unidadDePresentacion: 'kg',
        });
        expect(articulo.status).toBe(CREADO);
      }

      const articulos = await request(servidor())
        .get('/catalogo/articulos')
        .query({ itemId })
        .set('Cookie', cookieAdmin);
      expect((articulos.body as unknown[]).length).toBe(3);

      // Lo que ve quien arma una receta: el ítem, una vez. Las marcas no.
      const items = await request(servidor()).get('/catalogo/items').set('Cookie', cookieAdmin);
      const coincidencias = (items.body as { nombre: string }[]).filter(
        (i) => i.nombre === `Harina de trigo ${sufijo}`,
      );
      expect(coincidencias).toHaveLength(1);
    });
  });

  describe('conversión de unidades', () => {
    it('2 kg de un ítem medido en gramos dan factor 2000, sin capturarlo', async () => {
      const item = await crearItem(cookieAdmin, { unidadDeUso: 'g' });
      const itemId = (item.body as { id: string }).id;

      await crearArticulo(cookieAdmin, {
        itemId,
        nombre: `Saco 2kg ${randomUUID().slice(0, 8)}`,
        presentacion: '2',
        unidadDePresentacion: 'kg',
      });

      const articulos = await request(servidor())
        .get('/catalogo/articulos')
        .query({ itemId })
        .set('Cookie', cookieAdmin);

      const [articulo] = articulos.body as { factorDeConversion: string }[];
      expect(articulo?.factorDeConversion).toMatch(/^2000(\.0+)?$/u);
    });

    it('EL CRITERIO DE P2: kg → unidades sin factor se rechaza', async () => {
      const item = await crearItem(cookieAdmin, { unidadDeUso: 'unid' });
      const itemId = (item.body as { id: string }).id;

      const respuesta = await crearArticulo(cookieAdmin, {
        itemId,
        nombre: `Bollos ${randomUUID().slice(0, 8)}`,
        presentacion: '2',
        unidadDePresentacion: 'kg',
      });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('kg → unidades CON factor sí se acepta', async () => {
      const item = await crearItem(cookieAdmin, { unidadDeUso: 'unid' });
      const itemId = (item.body as { id: string }).id;

      const respuesta = await crearArticulo(cookieAdmin, {
        itemId,
        nombre: `Bollos con factor ${randomUUID().slice(0, 8)}`,
        presentacion: '2',
        unidadDePresentacion: 'kg',
        factorExplicito: '8',
      });

      expect(respuesta.status).toBe(CREADO);
    });

    it('un factor que se puede calcular NO se captura', async () => {
      const item = await crearItem(cookieAdmin, { unidadDeUso: 'g' });
      const itemId = (item.body as { id: string }).id;

      const respuesta = await crearArticulo(cookieAdmin, {
        itemId,
        nombre: `Con factor de más ${randomUUID().slice(0, 8)}`,
        presentacion: '2',
        unidadDePresentacion: 'kg',
        factorExplicito: '1500',
      });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
    });
  });

  describe('reglas del ítem, antes de tocar la base', () => {
    it('un rendimiento mayor que 1 se rechaza con una frase, no con un 23514', async () => {
      const respuesta = await crearItem(cookieAdmin, { rendimiento: '1.2' });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('0 y 1');
    });

    it('una preparación tiene que decir si lleva stock', async () => {
      const respuesta = await crearItem(cookieAdmin, { tipo: 'PRODUCIDO', llevaStock: null });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
    });

    it('un comprado no puede decidirlo', async () => {
      const respuesta = await crearItem(cookieAdmin, { tipo: 'COMPRADO', llevaStock: true });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
    });

    it('el rendimiento entra como CADENA: un `number` se rechaza', async () => {
      // ADR-003: todo decimal entra por cadena. `0.85` como número de JSON ya
      // habría pasado por un `double` antes de que nadie lo mirara.
      const respuesta = await request(servidor())
        .post('/catalogo/items')
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `Numérico ${sufijo}`,
          tipo: 'COMPRADO',
          unidadDeUso: 'g',
          rendimiento: 0.85,
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          llevaStock: null,
        });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
    });

    it('un nombre repetido es 409, no 400: la petición está bien formada', async () => {
      const nombre = `Repetido ${randomUUID().slice(0, 8)}`;

      expect((await crearItem(cookieAdmin, { nombre })).status).toBe(CREADO);
      expect((await crearItem(cookieAdmin, { nombre })).status).toBe(CONFLICTO);
    });
  });

  describe('autorización', () => {
    it('GERENTE_LOCAL LEE el catálogo: lo necesita para contar inventario', async () => {
      const cookie = await entrar(gerente);

      expect((await request(servidor()).get('/catalogo/items').set('Cookie', cookie)).status).toBe(OK);
    });

    it('GERENTE_LOCAL no lo ESCRIBE', async () => {
      const cookie = await entrar(gerente);

      const respuesta = await crearItem(cookie);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('aislamiento sobre las tablas nuevas', () => {
    it('el ADMIN de otra company no ve los ítems de esta', async () => {
      const nombre = `Solo de cat ${randomUUID().slice(0, 8)}`;
      await crearItem(cookieAdmin, { nombre });

      const ajena = await entrar(otraAdmin);
      const items = await request(servidor()).get('/catalogo/items').set('Cookie', ajena);

      expect((items.body as { nombre: string }[]).map((i) => i.nombre)).not.toContain(nombre);
    });
  });

  describe('lo que la aplicación NO puede hacer con la base', () => {
    it('el catálogo de unidades es de solo lectura: un kilo no pesa 900 gramos', async () => {
      const app_ = new Client({ connectionString: loadConfiguration(process.env).databaseUrl });
      await app_.connect();

      await expect(
        app_.query(`UPDATE unit SET factor_to_base = 900 WHERE code = 'kg'`),
      ).rejects.toThrow();

      await app_.end();
    });

    it('no puede BORRAR un ítem: se archiva', async () => {
      const app_ = new Client({ connectionString: loadConfiguration(process.env).databaseUrl });
      await app_.connect();

      await expect(app_.query('DELETE FROM item')).rejects.toThrow();

      await app_.end();
    });
  });

  describe('archivar', () => {
    it('un ítem archivado desaparece del listado por defecto y vuelve con el filtro', async () => {
      const nombre = `Archivable ${randomUUID().slice(0, 8)}`;
      const creado = await crearItem(cookieAdmin, { nombre });
      const itemId = (creado.body as { id: string }).id;

      const cambio = await request(servidor())
        .put(`/catalogo/items/${itemId}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre,
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          estado: 'INACTIVE',
          // El interruptor de stock lo añade P6, y es OBLIGATORIO: este `PUT`
          // reemplaza el ítem entero, no lo parchea. `null` es el valor de un
          // COMPRADO, que es lo que este es.
          llevaStock: null,
        });
      expect(cambio.status).toBe(SIN_CONTENIDO);

      const activos = await request(servidor()).get('/catalogo/items').set('Cookie', cookieAdmin);
      expect((activos.body as { nombre: string }[]).map((i) => i.nombre)).not.toContain(nombre);

      const todos = await request(servidor())
        .get('/catalogo/items')
        .query({ incluirInactivos: 'true' })
        .set('Cookie', cookieAdmin);
      expect((todos.body as { nombre: string }[]).map((i) => i.nombre)).toContain(nombre);
    });
  });
});
