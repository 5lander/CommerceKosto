/**
 * Precios de referencia — criterios de aceptación de P3.
 *
 *   E8   cambiar el precio hoy NO altera el costo de un mes anterior
 *   E9   ningún precio pasa a vigente sin confirmación (R5)
 *   E20  con `iva_recuperable = false` el costo sube exactamente el % del IVA
 *
 * Y las dos cosas que la base impide aunque el código se equivoque: reescribir
 * el importe de un precio existente, y confirmar dos veces el mismo.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { companyId as aCompanyId } from '../../src/shared/domain/identity/identificadores';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { PrismaConnection } from '../../src/shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../src/shared/infrastructure/persistence/tenant-transaction';

const OK = 200;
const CREADO = 201;
const SIN_CONTENIDO = 204;
const NO_ENCONTRADO = 404;
const PROHIBIDO = 403;
const CONFLICTO = 409;

const CONTRASENA = 'tres cebollas moradas';

const ENERO = '2026-01-01T00:00:00.000Z';
const MARZO = '2026-03-01T00:00:00.000Z';
const FEBRERO = '2026-02-01T00:00:00.000Z';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

describe('precios de referencia', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let admin: string;
  let gerente: string;
  let cookie: string;
  let companyId: string;
  let conexion: PrismaConnection;
  let tenant: TenantTransaction;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CONTRASENA });

    expect(respuesta.status).toBe(OK);
    return (respuesta.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  }

  /** Un ítem comprado con su artículo de 2 kg, medido en gramos. */
  async function itemConArticulo(): Promise<{ itemId: string; articuloId: string }> {
    const item = await request(servidor())
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
      });
    expect(item.status).toBe(CREADO);
    const itemId = (item.body as { id: string }).id;

    const articulo = await request(servidor())
      .post('/catalogo/articulos')
      .set('Cookie', cookie)
      .send({
        itemId,
        nombre: `Saco 2kg ${randomUUID().slice(0, 8)}`,
        marca: null,
        proveedor: null,
        presentacion: '2',
        unidadDePresentacion: 'kg',
        factorExplicito: null,
        ivaTarifa: '0.15',
      });
    expect(articulo.status).toBe(CREADO);

    return { itemId, articuloId: (articulo.body as { id: string }).id };
  }

  function sugerir(cuerpo: Cuerpo, quien = cookie) {
    return request(servidor())
      .post('/precios')
      .set('Cookie', quien)
      .send({ ivaCompra: '0.15', origen: 'MANUAL', nota: null, ...cuerpo });
  }

  function confirmar(precioId: string, decision = 'CONFIRMED') {
    return request(servidor())
      .post(`/precios/${precioId}/decision`)
      .set('Cookie', cookie)
      .send({ decision });
  }

  function costo(itemId: string, fecha?: string) {
    const peticion = request(servidor()).get(`/precios/costo/${itemId}`).set('Cookie', cookie);
    return fecha === undefined ? peticion : peticion.query({ fecha });
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

    conexion = new PrismaConnection(configuracion);
    tenant = new TenantTransaction(conexion);

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`precios ${sufijo}`],
    );
    const company = rows[0]?.id ?? '';
    companyId = company;

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, 'Centro', 'LOCAL', 'ACTIVE') RETURNING id`,
      [company],
    );

    admin = `admin.${sufijo}@snacklab.ec`;
    gerente = `gerente.${sufijo}@snacklab.ec`;

    for (const correo of [admin, gerente]) {
      await duena.query(
        `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`,
        [company, correo, hash],
      );
    }
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, admin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'GERENTE_LOCAL', $2, true FROM app_user WHERE email = $3`,
      [company, locales[0]?.id, gerente],
    );

    cookie = await entrar(admin);
  });

  afterAll(async () => {
    await conexion.onModuleDestroy();
    await app.close();
    await duena.end();
  });

  describe('la company nace con sus parámetros de costeo (D3)', () => {
    it('los valores son los del Excel original, y ninguno está en el código', async () => {
      const respuesta = await request(servidor()).get('/ajustes').set('Cookie', cookie);

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toMatchObject({
        ivaVenta: '0.15',
        ivaCompraRecuperable: true,
        provisionMerma: '0.02',
        foodCostObjetivo: '0.25',
        foodCostUmbralVerde: '0.28',
        foodCostMaximo: '0.32',
        primeCostMaximo: '0.65',
        reglaPopularidad: '0.7',
        diasOperativosMes: 22,
        diasCobertura: 7,
      });
    });

    it('un IVA de 15 en vez de 0.15 se rechaza: multiplicaría el costo por dieciséis', async () => {
      const actuales = (await request(servidor()).get('/ajustes').set('Cookie', cookie)).body as Cuerpo;

      const respuesta = await request(servidor())
        .put('/ajustes')
        .set('Cookie', cookie)
        .send({ ...actuales, ivaVenta: '15' });

      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('los umbrales del semáforo tienen que ir en orden', async () => {
      const actuales = (await request(servidor()).get('/ajustes').set('Cookie', cookie)).body as Cuerpo;

      const respuesta = await request(servidor())
        .put('/ajustes')
        .set('Cookie', cookie)
        .send({ ...actuales, foodCostObjetivo: '0.30', foodCostUmbralVerde: '0.28' });

      expect((respuesta.body as { message: string }).message).toContain('orden');
    });
  });

  describe('EL CRITERIO E9: ningún precio pasa a vigente sin confirmación', () => {
    it('un precio sugerido NO tiene efecto sobre el costo', async () => {
      const { itemId, articuloId } = await itemConArticulo();

      const sugerido = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      expect(sugerido.status).toBe(CREADO);

      // Existe, es visible en el historial, y no cuesta nada todavía.
      const historial = await request(servidor())
        .get('/precios')
        .query({ itemId })
        .set('Cookie', cookie);
      expect((historial.body as unknown[]).length).toBe(1);

      const sinConfirmar = await costo(itemId, MARZO);
      expect(sinConfirmar.status).toBe(NO_ENCONTRADO);
    });

    it('en cuanto se confirma, el costo aparece', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const sugerido = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });

      expect((await confirmar((sugerido.body as { id: string }).id)).status).toBe(SIN_CONTENIDO);

      const resuelto = await costo(itemId, MARZO);
      expect(resuelto.status).toBe(OK);
      // 2.30 / 1.15 = 2 neto; 2 / 2000 g = 0.001 por gramo; rendimiento 1.
      expect((resuelto.body as { costoNetoDeUso: string }).costoNetoDeUso).toMatch(/^0\.001/u);
    });

    it('un precio rechazado tampoco cuenta', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const sugerido = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });

      await confirmar((sugerido.body as { id: string }).id, 'REJECTED');

      expect((await costo(itemId, MARZO)).status).toBe(NO_ENCONTRADO);
    });

    it('GERENTE_LOCAL sugiere pero NO confirma', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const suya = await entrar(gerente);

      const sugerido = await sugerir(
        { itemId, purchaseArticleId: articuloId, precio: '2.50', validFrom: ENERO },
        suya,
      );
      expect(sugerido.status).toBe(CREADO);

      const intento = await request(servidor())
        .post(`/precios/${(sugerido.body as { id: string }).id}/decision`)
        .set('Cookie', suya)
        .send({ decision: 'CONFIRMED' });

      expect(intento.status).toBe(PROHIBIDO);
    });
  });

  describe('EL CRITERIO E8: el precio de hoy no reescribe la historia', () => {
    it('un precio de marzo no altera lo que costaba en febrero', async () => {
      const { itemId, articuloId } = await itemConArticulo();

      const enero = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      await confirmar((enero.body as { id: string }).id);

      const enFebrero = (await costo(itemId, FEBRERO)).body as { costoNetoDeUso: string };

      // Sube el precio a partir de marzo.
      const marzo = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '4.60',
        validFrom: MARZO,
      });
      await confirmar((marzo.body as { id: string }).id);

      const febreroOtraVez = (await costo(itemId, FEBRERO)).body as { costoNetoDeUso: string };
      const enMarzo = (await costo(itemId, MARZO)).body as { costoNetoDeUso: string };

      expect(febreroOtraVez.costoNetoDeUso).toBe(enFebrero.costoNetoDeUso);
      expect(enMarzo.costoNetoDeUso).not.toBe(enFebrero.costoNetoDeUso);
    });
  });

  describe('EL CRITERIO E20: sin IVA recuperable el costo sube el IVA exacto (R13)', () => {
    it('el mismo precio cuesta 1.15 veces más', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const precio = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      await confirmar((precio.body as { id: string }).id);

      const conRecuperacion = (await costo(itemId, MARZO)).body as { costoNetoDeUso: string };

      const actuales = (await request(servidor()).get('/ajustes').set('Cookie', cookie)).body as Cuerpo;
      await request(servidor())
        .put('/ajustes')
        .set('Cookie', cookie)
        .send({ ...actuales, ivaCompraRecuperable: false });

      const sinRecuperacion = (await costo(itemId, MARZO)).body as { costoNetoDeUso: string };

      // 0.001 -> 0.00115, exactamente el 15 %.
      expect(Number(sinRecuperacion.costoNetoDeUso) / Number(conRecuperacion.costoNetoDeUso)).toBeCloseTo(
        1.15,
        10,
      );

      await request(servidor()).put('/ajustes').set('Cookie', cookie).send(actuales);
    });
  });

  describe('lo que la base impide aunque el código se equivoque', () => {
    /**
     * SE ESCRIBE POR LA CAPA DE TENANT DE VERDAD, y esa es la parte que costó
     * dos intentos.
     *
     * El primero lanzaba el `UPDATE` con un cliente crudo y **sin tenant**:
     * RLS filtraba, la sentencia afectaba a cero filas, y `UPDATE 0` es un
     * éxito. El trigger nunca llegaba a dispararse. La prueba decía «la base
     * impide reescribir un precio» y solo comprobaba que RLS impide *ver* la
     * fila — que ya se prueba en otro sitio. Es INC-007 en otra forma: una
     * prueba puede pasar por no estar tocando nada.
     *
     * El segundo fijaba el tenant a mano con `set_config`, y lo paró la regla
     * `sin-set-local-a-mano` de `audit:forbidden` — también con razón. La vía
     * correcta es la que usa la aplicación: `TenantTransaction.run()`, que fija
     * el tenant DENTRO de la transacción. Así la fila es visible, el trigger se
     * dispara, y la prueba recorre exactamente el camino real.
     */
    async function intentarReescribir(precioId: string): Promise<void> {
      await tenant.run(aCompanyId(companyId), async (tx) => {
        await tx.referencePrice.updateMany({ where: { id: precioId }, data: { price: '99' } });
      });
    }

    /**
     * Se comprueba el IMPORTE, no el texto del error.
     *
     * El mensaje del trigger llega envuelto por Prisma —«Invalid
     * `tx.referencePrice.updateMany()`…»— y afirmar sobre esa envoltura ataría
     * la prueba a como el ORM decida formatear sus errores. Lo que importa es
     * que el precio siga siendo el que era.
     */
    async function precioGuardado(precioId: string): Promise<string> {
      const { rows } = await duena.query<{ price: string }>(
        'SELECT price::text FROM reference_price WHERE id = $1',
        [precioId],
      );
      return rows[0]?.price ?? '';
    }

    it('un precio CONFIRMADO no se puede reescribir', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const precio = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      const precioId = (precio.body as { id: string }).id;
      await confirmar(precioId);

      await expect(intentarReescribir(precioId)).rejects.toThrow();
      expect(await precioGuardado(precioId)).toMatch(/^2\.30/u);
    });

    it('de un precio SUGERIDO tampoco cambia el importe, solo el estado', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const precio = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      const precioId = (precio.body as { id: string }).id;

      await expect(intentarReescribir(precioId)).rejects.toThrow();
      expect(await precioGuardado(precioId)).toMatch(/^2\.30/u);
    });

    it('confirmar dos veces el mismo precio da 409, no un 204 silencioso', async () => {
      const { itemId, articuloId } = await itemConArticulo();
      const precio = await sugerir({
        itemId,
        purchaseArticleId: articuloId,
        precio: '2.30',
        validFrom: ENERO,
      });
      const precioId = (precio.body as { id: string }).id;

      expect((await confirmar(precioId)).status).toBe(SIN_CONTENIDO);
      expect((await confirmar(precioId)).status).toBe(CONFLICTO);
    });

    it('un precio de un ítem comprado necesita su artículo', async () => {
      const { itemId } = await itemConArticulo();

      const respuesta = await sugerir({
        itemId,
        purchaseArticleId: null,
        precio: '2.30',
        validFrom: ENERO,
      });

      expect(respuesta.status).toBeGreaterThanOrEqual(400);
    });
  });
});
