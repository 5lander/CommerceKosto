/**
 * El IVA de compra en dos niveles, de punta a punta — P16-A1, Fase 1.
 *
 *   D-16.9   la tarifa es del artículo o del grupo, la recuperabilidad de la
 *            company, y NUNCA se asume una: sin tarifa, 400
 *   D-16.10  toda COMPRA nueva persiste los cuatro importes, comprobado con
 *            la dueña sobre la fila, no sobre la respuesta
 *   D-16.41  la corrección copia el desglose entero, y Σ(COMPRA) se cancela
 *   D-16.42  el desglose es la foto del momento: cambiar el ajuste después no
 *            reescribe el libro
 *   D-16.44  el CSV de MOVIMIENTOS: fila > grupo, y sin tarifa —o con un 15
 *            donde va 0.15— la fila se rechaza con su número
 *   D-16.51  una preparación nace con tarifa 0, ignore lo que diga su grupo;
 *            con otra tarifa es 400, en `POST /precios` y en el lote
 *   D-16.45  `PUT /catalogo/articulos/:id` y `PUT /catalogo/grupos/:id`
 *   §4.3     BODEGA sobre la respuesta cruda: ninguno de los importes nuevos
 *   §4.4     un artículo de otra company es «no existe», no «pertenece a otro»
 *
 * Los números son los de CC-IVA-01..04 (`docs/pruebas/casos-conocidos.md`):
 * 115.00 al 15 % netea a 100.00. El criterio E20 sigue en `precios.spec.ts`.
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
import { SugerirPreciosEnLote } from '../../src/modules/pricing/application/casos-de-uso/lotes';
import type { LocationId } from '../../src/shared/domain/identity/identificadores';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const CREADO = 201;
const SIN_CONTENIDO = 204;
const ENTRADA_INVALIDA = 400;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const CONFLICTO = 409;

const CONTRASENA = 'tres cebollas moradas';
const MARZO = '2026-03-15T12:00:00.000Z';
const ENERO = '2026-01-15T00:00:00.000Z';

/** CC-IVA-01: 115.00 al 15 % recuperable netea a 100.00. */
const FACTURA = '115.00';
const QUINCE = '0.15';
const CIEN_ALMACENADO = '100.000000000000';
const CIENTO_QUINCE_ALMACENADO = '115.000000000000';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

interface FilaDelLibro {
  readonly total_cost: string | null;
  readonly total_bruto: string | null;
  readonly iva_tarifa_aplicada: string | null;
  readonly iva_recuperable_aplicado: boolean | null;
  readonly desglose_conocido: boolean;
}

interface Error400 {
  readonly code: string;
  readonly message: string;
}

/** Los importes del desglose que jamás pueden salir hacia BODEGA (§4.3). */
const PROHIBIDOS_PARA_BODEGA = [
  'totalBruto',
  'ivaTarifaAplicada',
  'ivaRecuperableAplicado',
  'desglose',
  'costoTotal',
  'cantidad',
];

describe('IVA de compra en dos niveles', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let companyId: string;
  let bodega: string;
  let cookie: string;
  let cookieBodega: string;
  let correoAdmin: string;
  let cookieOtra: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function sembrarTenant(prefijo: string): Promise<{
    company: string;
    local: string;
    admin: string;
    bodeguero: string;
  }> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);

    const { rows: companies } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const company = companies[0]?.id ?? '';

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'BODEGA', 'ACTIVE') RETURNING id`,
      [company, `${prefijo} bodega`],
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

    const admin = await crear('admin');
    const bodeguero = await crear('bodega');

    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, admin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, local, bodeguero],
    );

    return { company, local, admin, bodeguero };
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CONTRASENA });

    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  async function crear(ruta: string, cuerpo: Cuerpo, quien = cookie): Promise<string> {
    const respuesta = await request(servidor()).post(ruta).set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien)).send(cuerpo);
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  async function crearItem(grupoId: string | null, tipo = 'COMPRADO'): Promise<string> {
    return crear('/catalogo/items', {
      nombre: `Insumo ${randomUUID().slice(0, 8)}`,
      tipo,
      unidadDeUso: 'unid',
      rendimiento: '1',
      grupoId,
      confianzaDePrecio: 'FACTURA',
      llevaStock: tipo === 'PRODUCIDO' ? true : null,
    });
  }

  function cuerpoDeArticulo(itemId: string, ivaTarifa: string | undefined): Cuerpo {
    return {
      itemId,
      nombre: `Presentacion ${randomUUID().slice(0, 8)}`,
      marca: null,
      proveedor: null,
      presentacion: '1',
      unidadDePresentacion: 'unid',
      factorExplicito: null,
      ...(ivaTarifa === undefined ? {} : { ivaTarifa }),
    };
  }

  async function crearArticulo(itemId: string, ivaTarifa = QUINCE): Promise<string> {
    return crear('/catalogo/articulos', cuerpoDeArticulo(itemId, ivaTarifa));
  }

  function comprar(cuerpo: Cuerpo, quien = cookie) {
    return request(servidor())
      .post('/inventario/movimientos')
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien))
      .send({
        locationId: bodega,
        tipo: 'COMPRA',
        cantidad: '10',
        costoTotal: FACTURA,
        purchaseArticleId: null,
        occurredAt: MARZO,
        note: null,
        ...cuerpo,
      });
  }

  async function filaDelLibro(movementId: string): Promise<FilaDelLibro> {
    const { rows } = await duena.query<FilaDelLibro>(
      `SELECT total_cost::text, total_bruto::text, iva_tarifa_aplicada::text,
              iva_recuperable_aplicado, desglose_conocido
       FROM inventory_movement WHERE id = $1`,
      [movementId],
    );
    const fila = rows[0];
    if (fila === undefined) throw new Error('la compra no quedó en el libro');
    return fila;
  }

  async function ajustarRecuperable(recuperable: boolean): Promise<void> {
    const actuales = (await request(servidor()).get('/ajustes').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))).body as Cuerpo;
    const respuesta = await request(servidor())
      .put('/ajustes')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({ ...actuales, ivaCompraRecuperable: recuperable });
    expect(respuesta.status).toBe(SIN_CONTENIDO);
  }

  async function sesionDelAdmin(): Promise<SesionActiva> {
    const abierta = await app.get(IniciarSesion).ejecutar({
      email: correoAdmin,
      contrasena: CONTRASENA,
      ip: null,
      userAgent: null,
    });
    return app.get(ValidarSesion).ejecutar(abierta.token);
  }

  async function importarMovimientos(csv: string): Promise<number | null> {
    const resultado = await app.get(ImportarArchivo).ejecutar(await sesionDelAdmin(), {
      tipo: 'MOVIMIENTOS',
      bytes: Buffer.from(csv, 'utf8'),
      nombreOriginal: 'movimientos.csv',
      claveDeAlmacenamiento: randomUUID(),
      locationId: bodega as LocationId,
      confirmar: true,
      confirmarPrecios: false,
      vigenciaDesde: new Date(ENERO),
    });
    return resultado.filasEscritas;
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

    const propio = await sembrarTenant('iva');
    companyId = propio.company;
    bodega = propio.local;
    correoAdmin = propio.admin;
    cookie = await entrar(propio.admin);
    cookieBodega = await entrar(propio.bodeguero);

    const ajeno = await sembrarTenant('ajena');
    cookieOtra = await entrar(ajeno.admin);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('D-16.10 — la compra persiste los cuatro importes', () => {
    it('CC-IVA-01: 115.00 al 15 % del artículo, recuperable, queda como 100.00 neto', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);

      const respuesta = await comprar({ itemId: item, purchaseArticleId: articulo });
      expect(respuesta.status).toBe(CREADO);

      const fila = await filaDelLibro((respuesta.body as { id: string }).id);
      expect(fila).toEqual({
        total_cost: CIEN_ALMACENADO,
        total_bruto: CIENTO_QUINCE_ALMACENADO,
        iva_tarifa_aplicada: '0.150000000000',
        iva_recuperable_aplicado: true,
        desglose_conocido: true,
      });
    });

    it('CC-IVA-04: la tarifa del cuerpo (0.08) manda sobre la del artículo (0.15)', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);

      const respuesta = await comprar({
        itemId: item,
        purchaseArticleId: articulo,
        costoTotal: '108.00',
        ivaTarifa: '0.08',
      });
      expect(respuesta.status).toBe(CREADO);

      const fila = await filaDelLibro((respuesta.body as { id: string }).id);
      expect(fila.iva_tarifa_aplicada).toBe('0.080000000000');
      expect(fila.total_cost).toBe(CIEN_ALMACENADO);
    });

    it('sin artículo, manda la del grupo del ítem', async () => {
      const grupo = await crear('/catalogo/grupos', { nombre: `Aseo ${sufijo}`, ivaTarifa: QUINCE });
      const item = await crearItem(grupo);

      const respuesta = await comprar({ itemId: item });
      expect(respuesta.status).toBe(CREADO);

      const fila = await filaDelLibro((respuesta.body as { id: string }).id);
      expect(fila.iva_tarifa_aplicada).toBe('0.150000000000');
      expect(fila.total_cost).toBe(CIEN_ALMACENADO);
    });

    it('CC-IVA-02: sin IVA recuperable el bruto entra íntegro, y es la FOTO del momento (D-16.42)', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);

      await ajustarRecuperable(false);
      const respuesta = await comprar({ itemId: item, purchaseArticleId: articulo });
      await ajustarRecuperable(true);
      expect(respuesta.status).toBe(CREADO);

      const fila = await filaDelLibro((respuesta.body as { id: string }).id);
      expect(fila.total_cost).toBe(CIENTO_QUINCE_ALMACENADO);
      expect(fila.iva_recuperable_aplicado).toBe(false);
    });

    it('una MERMA no lleva desglose, y el libro lo dice con `false`', async () => {
      const item = await crearItem(null);
      const respuesta = await comprar({ itemId: item, tipo: 'MERMA', costoTotal: null });
      expect(respuesta.status).toBe(CREADO);

      const fila = await filaDelLibro((respuesta.body as { id: string }).id);
      expect(fila.desglose_conocido).toBe(false);
      expect(fila.total_bruto).toBeNull();
    });
  });

  describe('D-16.9 — nunca se asume una tarifa', () => {
    it('sin cuerpo, sin artículo y sin grupo: 400 con el código y el sitio donde ponerla', async () => {
      const item = await crearItem(null);
      const respuesta = await comprar({ itemId: item });

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      const error = respuesta.body as Error400;
      expect(error.code).toBe('ENTRADA_INVALIDA');
      expect(error.message).toContain('ivaTarifa');
      expect(error.message).toContain('PUT /catalogo/grupos/:id');
    });

    it('un grupo sin tarifa no la define: sigue siendo 400', async () => {
      const grupo = await crear('/catalogo/grupos', { nombre: `Sin tarifa ${sufijo}` });
      const item = await crearItem(grupo);

      const respuesta = await comprar({ itemId: item });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as Error400).code).toBe('ENTRADA_INVALIDA');
    });

    it('una tarifa de 15 donde va 0.15 se rechaza en el campo, aunque otro campo también falle', async () => {
      const item = await crearItem(null);
      const respuesta = await comprar({ itemId: item, ivaTarifa: '15', cantidad: 'diez' });

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      const error = respuesta.body as Error400;
      expect(error.code).toBe('ENTRADA_INVALIDA');
      expect(error.message).toContain('ivaTarifa');
      expect(error.message).toContain('cantidad');
    });

    it('la tarifa en una MERMA no tiene sentido: 400', async () => {
      const item = await crearItem(null);
      const respuesta = await comprar({
        itemId: item,
        tipo: 'MERMA',
        costoTotal: null,
        ivaTarifa: QUINCE,
      });

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as Error400).code).toBe('ENTRADA_INVALIDA');
    });

    it('un artículo de OTRO ítem se rechaza con 400, no con un 500 de la clave foránea', async () => {
      const item = await crearItem(null);
      const otroItem = await crearItem(null);
      const articuloAjeno = await crearArticulo(otroItem);

      const respuesta = await comprar({ itemId: item, purchaseArticleId: articuloAjeno });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as Error400).code).toBe('ENTRADA_INVALIDA');
    });

    it('§4.4 — un artículo de OTRA company es «no existe»', async () => {
      const itemAjeno = await crear(
        '/catalogo/items',
        {
          nombre: `Ajeno ${sufijo}`,
          tipo: 'COMPRADO',
          unidadDeUso: 'unid',
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          llevaStock: null,
        },
        cookieOtra,
      );
      const articuloAjeno = await crear(
        '/catalogo/articulos',
        cuerpoDeArticulo(itemAjeno, QUINCE),
        cookieOtra,
      );
      const item = await crearItem(null);

      const respuesta = await comprar({ itemId: item, purchaseArticleId: articuloAjeno });
      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect((respuesta.body as Error400).code).toBe('RECURSO_NO_ENCONTRADO');
    });
  });

  describe('D-16.41 — la corrección copia el desglose entero', () => {
    it('la fila que anula lleva los cuatro importes, y Σ(COMPRA) del ítem da cero en bruto y en neto', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);
      const compra = (await comprar({ itemId: item, purchaseArticleId: articulo })).body as {
        id: string;
      };

      const correccion = await request(servidor())
        .post(`/inventario/movimientos/${compra.id}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: 'factura duplicada' });
      expect(correccion.status).toBe(CREADO);

      const fila = await filaDelLibro((correccion.body as { id: string }).id);
      expect(fila).toEqual({
        total_cost: CIEN_ALMACENADO,
        total_bruto: CIENTO_QUINCE_ALMACENADO,
        iva_tarifa_aplicada: '0.150000000000',
        iva_recuperable_aplicado: true,
        desglose_conocido: true,
      });

      // El importe es magnitud; el signo lo lleva la cantidad. Sumar
      // `total_cost * sign(quantity)` es lo que hace `compras_del_mes`.
      const { rows } = await duena.query<{ neto: string; bruto: string }>(
        `SELECT sum(total_cost * sign(quantity))::text AS neto,
                sum(total_bruto * sign(quantity))::text AS bruto
         FROM inventory_movement WHERE company_id = $1 AND item_id = $2 AND type = 'COMPRA'`,
        [companyId, item],
      );
      expect(rows[0]?.neto).toBe('0.000000000000');
      expect(rows[0]?.bruto).toBe('0.000000000000');
    });
  });

  describe('el libro cuenta si la fila tiene desglose', () => {
    it('una COMPRA nueva sale CONOCIDO con los importes; una anterior a P16-A1 sale SIN_DESGLOSE y sin ellos', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);
      const nueva = (await comprar({ itemId: item, purchaseArticleId: articulo })).body as {
        id: string;
      };

      // Una fila «de antes»: la escribe la dueña como la escribía P6, sin
      // desglose. D-16.18: no se rellena.
      const { rows } = await duena.query<{ id: string }>(
        `INSERT INTO inventory_movement
           (company_id, location_id, item_id, type, direction, quantity, total_cost,
            occurred_at, created_by)
         SELECT $1, $2, $3, 'COMPRA', 'ENTRADA', 1, 9.99, $4, id
         FROM app_user WHERE email = $5
         RETURNING id`,
        [companyId, bodega, item, MARZO, correoAdmin],
      );
      const vieja = rows[0]?.id ?? '';

      const libro = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodega, itemId: item })
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      expect(libro.status).toBe(OK);

      const movimientos = (libro.body as { movimientos: readonly Record<string, unknown>[] })
        .movimientos;
      const conDesglose = movimientos.find((m) => m['id'] === nueva.id);
      const sinDesglose = movimientos.find((m) => m['id'] === vieja);

      expect(conDesglose).toMatchObject({
        desglose: 'CONOCIDO',
        costoTotal: CIEN_ALMACENADO,
        totalBruto: CIENTO_QUINCE_ALMACENADO,
        ivaTarifaAplicada: '0.150000000000',
        ivaRecuperableAplicado: true,
      });
      expect(sinDesglose).toMatchObject({ desglose: 'SIN_DESGLOSE', costoTotal: '9.990000000000' });
      expect(sinDesglose).not.toHaveProperty('totalBruto');
      expect(sinDesglose).not.toHaveProperty('ivaTarifaAplicada');
    });
  });

  describe('§4.3 — BODEGA sobre la respuesta cruda', () => {
    it('registra la compra y recibe solo el id: ningún importe del desglose', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);

      const respuesta = await comprar({ itemId: item, purchaseArticleId: articulo }, cookieBodega);
      expect(respuesta.status).toBe(CREADO);

      const crudo = JSON.stringify(respuesta.body);
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido);
      }
      expect(Object.keys(respuesta.body as object)).toEqual(['id']);
    });

    it('y el libro con los importes nuevos le sigue vedado', async () => {
      const respuesta = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodega })
        .set('Cookie', cookieBodega).set('X-CSRF-Token', csrfDe(cookieBodega));
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('D-16.45 — la tarifa se corrige por PUT', () => {
    it('POST /catalogo/articulos exige la tarifa', async () => {
      const item = await crearItem(null);
      const respuesta = await request(servidor())
        .post('/catalogo/articulos')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send(cuerpoDeArticulo(item, undefined));

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as Error400).code).toBe('ENTRADA_INVALIDA');
    });

    it('PUT /catalogo/articulos/:id cambia la tarifa y la lista la devuelve', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);
      const nombre = `Saco corregido ${sufijo}`;

      const cambio = await request(servidor())
        .put(`/catalogo/articulos/${articulo}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre, marca: 'Ya', proveedor: null, ivaTarifa: '0', estado: 'ACTIVE' });
      expect(cambio.status).toBe(SIN_CONTENIDO);

      const lista = await request(servidor())
        .get('/catalogo/articulos')
        .query({ itemId: item })
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      expect(lista.body).toEqual([
        expect.objectContaining({ id: articulo, nombre, marca: 'Ya', ivaTarifa: '0' }),
      ]);

      // Y la siguiente compra ya netea con la tarifa corregida: bruto = neto.
      const compra = await comprar({ itemId: item, purchaseArticleId: articulo });
      const fila = await filaDelLibro((compra.body as { id: string }).id);
      expect(fila.total_cost).toBe(CIENTO_QUINCE_ALMACENADO);
      expect(fila.iva_tarifa_aplicada).toBe('0.000000000000');
    });

    it('PUT de un artículo: 15 es 400, un id ajeno es 404, un nombre repetido es 409', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item);
      const otro = await crearArticulo(item);
      const nombreDelOtro = (
        (await request(servidor()).get('/catalogo/articulos').query({ itemId: item }).set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)))
          .body as readonly { id: string; nombre: string }[]
      ).find((a) => a.id === otro)?.nombre;
      const base = { marca: null, proveedor: null, ivaTarifa: QUINCE, estado: 'ACTIVE' };

      const invalido = await request(servidor())
        .put(`/catalogo/articulos/${articulo}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ ...base, nombre: 'x', ivaTarifa: '15' });
      expect(invalido.status).toBe(ENTRADA_INVALIDA);
      expect((invalido.body as Error400).code).toBe('ENTRADA_INVALIDA');

      const ajeno = await request(servidor())
        .put(`/catalogo/articulos/${articulo}`)
        .set('Cookie', cookieOtra).set('X-CSRF-Token', csrfDe(cookieOtra))
        .send({ ...base, nombre: 'x' });
      expect(ajeno.status).toBe(NO_ENCONTRADO);
      expect((ajeno.body as Error400).code).toBe('RECURSO_NO_ENCONTRADO');

      const repetido = await request(servidor())
        .put(`/catalogo/articulos/${articulo}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ ...base, nombre: nombreDelOtro });
      expect(repetido.status).toBe(CONFLICTO);
      expect((repetido.body as Error400).code).toBe('CONFLICTO');
    });

    it('PUT /catalogo/grupos/:id pone y quita la tarifa, y GET la devuelve', async () => {
      const grupo = await crear('/catalogo/grupos', { nombre: `Lácteos ${sufijo}` });
      const nombre = `Lácteos y huevos ${sufijo}`;

      const puesta = await request(servidor())
        .put(`/catalogo/grupos/${grupo}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre, ivaTarifa: QUINCE });
      expect(puesta.status).toBe(SIN_CONTENIDO);

      const lista = (await request(servidor()).get('/catalogo/grupos').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)))
        .body as readonly { id: string; nombre: string; ivaTarifa: string | null }[];
      expect(lista.find((g) => g.id === grupo)).toEqual({ id: grupo, nombre, ivaTarifa: '0.15' });

      const quitada = await request(servidor())
        .put(`/catalogo/grupos/${grupo}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre, ivaTarifa: null });
      expect(quitada.status).toBe(SIN_CONTENIDO);

      const ajeno = await request(servidor())
        .put(`/catalogo/grupos/${grupo}`)
        .set('Cookie', cookieOtra).set('X-CSRF-Token', csrfDe(cookieOtra))
        .send({ nombre, ivaTarifa: null });
      expect(ajeno.status).toBe(NO_ENCONTRADO);
    });
  });

  describe('D-16.43 — SugerirPrecio con la misma precedencia y sin default de company', () => {
    function precioDePreparacion(itemId: string, ivaCompra: string | null): Cuerpo {
      return {
        itemId,
        purchaseArticleId: null,
        precio: '2.00',
        ivaCompra,
        origen: 'MANUAL',
        validFrom: ENERO,
        nota: null,
      };
    }

    async function ivaDelHistorial(itemId: string): Promise<string | undefined> {
      const historial = (
        await request(servidor()).get('/precios').query({ itemId }).set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      ).body as readonly { ivaCompra: string }[];
      return historial[0]?.ivaCompra;
    }

    /**
     * D-16.51. El costo estándar de una preparación ya es neto (R10): si el
     * grupo «Salsas» dice 0.15, netearlo otra vez dejaría el plato un 13 % más
     * barato de lo que cuesta. Por eso la preparación no hereda del grupo.
     */
    it('una preparación nace con tarifa 0 aunque su grupo diga 0.15 (R10, D-16.51)', async () => {
      const salsas = await crear('/catalogo/grupos', { nombre: `Salsas ${sufijo}`, ivaTarifa: QUINCE });
      const preparacion = await crearItem(salsas, 'PRODUCIDO');
      await crear('/precios', precioDePreparacion(preparacion, null));

      expect(await ivaDelHistorial(preparacion)).toBe('0');
    });

    it('una preparación con tarifa distinta de cero en el cuerpo: 400 con el motivo', async () => {
      const preparacion = await crearItem(null, 'PRODUCIDO');
      const respuesta = await request(servidor())
        .post('/precios')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send(precioDePreparacion(preparacion, QUINCE));

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as Error400).code).toBe('ENTRADA_INVALIDA');
      expect((respuesta.body as Error400).message).toContain('R10');
    });

    it('en el lote de precios la preparación nace con 0, y con 0.15 la fila se rechaza con su número', async () => {
      const nombre = `Mayonesa ${sufijo}`;
      const preparacion = await crear('/catalogo/items', {
        nombre,
        tipo: 'PRODUCIDO',
        unidadDeUso: 'kg',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: true,
      });
      const fila = (ivaCompra: string | null) => ({
        item: nombre,
        articulo: null,
        precio: '3.00',
        ivaCompra,
        origen: 'MANUAL' as const,
        nota: null,
      });
      const lote = app.get(SugerirPreciosEnLote);
      const sesion = await sesionDelAdmin();

      await expect(
        lote.ejecutar(sesion, { precios: [fila(QUINCE)], validFrom: new Date(ENERO), confirmar: false }),
      ).rejects.toMatchObject({
        codigo: 'ENTRADA_INVALIDA',
        message: expect.stringContaining('fila 1') as string,
      });

      const escritas = await lote.ejecutar(sesion, {
        precios: [fila(null)],
        validFrom: new Date(ENERO),
        confirmar: false,
      });
      expect(escritas).toBe(1);
      expect(await ivaDelHistorial(preparacion)).toBe('0');
    });

    it('con artículo y sin tarifa en el cuerpo, el precio nace con la del artículo', async () => {
      const item = await crearItem(null);
      const articulo = await crearArticulo(item, '0.08');
      await crear('/precios', {
        itemId: item,
        purchaseArticleId: articulo,
        precio: '2.00',
        ivaCompra: null,
        origen: 'MANUAL',
        validFrom: ENERO,
        nota: null,
      });

      const historial = (
        await request(servidor()).get('/precios').query({ itemId: item }).set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      ).body as readonly { ivaCompra: string }[];
      expect(historial[0]?.ivaCompra).toBe('0.08');
    });
  });

  describe('D-16.44 — el CSV de MOVIMIENTOS: fila > grupo, y sin tarifa la fila se rechaza', () => {
    it('la columna «iva» de la fila manda; sin ella, la del grupo; sin ninguna, la fila y su número', async () => {
      const grupo = await crear('/catalogo/grupos', { nombre: `Granos ${sufijo}`, ivaTarifa: QUINCE });
      const conGrupo = `Arroz ${sufijo}`;
      const sinGrupo = `Sal ${sufijo}`;
      await crear('/catalogo/items', {
        nombre: conGrupo,
        tipo: 'COMPRADO',
        unidadDeUso: 'kg',
        rendimiento: '1',
        grupoId: grupo,
        confianzaDePrecio: 'FACTURA',
        llevaStock: null,
      });
      await crear('/catalogo/items', {
        nombre: sinGrupo,
        tipo: 'COMPRADO',
        unidadDeUso: 'kg',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: null,
      });

      const cabecera = 'item,tipo,cantidad,fecha,importe,iva';
      const buenas = `${cabecera}\n${conGrupo},COMPRA,10,2026-03-15,115.00,\n${sinGrupo},COMPRA,1,2026-03-15,108.00,0.08`;
      expect(await importarMovimientos(buenas)).toBe(2);

      const { rows } = await duena.query<{ nombre: string; tarifa: string; neto: string }>(
        `SELECT i.name AS nombre, m.iva_tarifa_aplicada::text AS tarifa, m.total_cost::text AS neto
         FROM inventory_movement m JOIN item i ON i.id = m.item_id
         WHERE m.company_id = $1 AND i.name IN ($2, $3) ORDER BY i.name`,
        [companyId, conGrupo, sinGrupo],
      );
      expect(rows).toEqual([
        { nombre: conGrupo, tarifa: '0.150000000000', neto: CIEN_ALMACENADO },
        { nombre: sinGrupo, tarifa: '0.080000000000', neto: CIEN_ALMACENADO },
      ]);

      const sinTarifa = `${cabecera}\n${conGrupo},COMPRA,1,2026-03-15,10.00,\n${sinGrupo},COMPRA,1,2026-03-15,10.00,`;
      await expect(importarMovimientos(sinTarifa)).rejects.toMatchObject({
        codigo: 'ENTRADA_INVALIDA',
        message: expect.stringContaining('fila 2') as string,
      });
    });

    it('un 15 donde va 0.15 se rechaza en el análisis con su fila, no como un 400 sin número', async () => {
      const item = `Azúcar ${sufijo}`;
      await crear('/catalogo/items', {
        nombre: item,
        tipo: 'COMPRADO',
        unidadDeUso: 'kg',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: null,
      });

      const conQuince = `item,tipo,cantidad,fecha,importe,iva\n${item},COMPRA,1,2026-03-15,10.00,0.15\n${item},COMPRA,1,2026-03-15,10.00,15`;
      await expect(importarMovimientos(conQuince)).rejects.toMatchObject({
        codigo: 'ENTRADA_INVALIDA',
        message: expect.stringMatching(/fila 2.*0\.15, no 15/su) as string,
      });
    });
  });
});
