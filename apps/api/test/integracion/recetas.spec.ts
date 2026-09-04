/**
 * Recetas, productos y propagación — criterios de aceptación de P4.
 *
 *   E14  una receta que se referencia a sí misma **a dos niveles** se rechaza
 *        al guardar, con error de dominio
 *   E18  un `GERENTE_LOCAL` recibe 403 al propagar
 *   ---  propagar crea versión nueva en cada ubicación y las anteriores siguen
 *        consultables
 *   ---  revertir devuelve cada ubicación a su versión previa
 *
 * Y la regla más dura de CLAUDE.md §4.3: `BODEGA` no ve recetas, comprobado
 * sobre la respuesta cruda.
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

const CONTRASENA = 'tres cebollas moradas';
const AHORA = new Date().toISOString();

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

describe('recetas, productos y propagación', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let admin: string;
  let gerente: string;
  let bodeguero: string;
  let cookie: string;
  let centro: string;
  let norte: string;

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

  /** Un ítem del catálogo, comprado o producido. */
  async function crearItem(tipo: 'COMPRADO' | 'PRODUCIDO'): Promise<string> {
    const respuesta = await request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie)
      .send({
        nombre: `${tipo} ${randomUUID().slice(0, 8)}`,
        tipo,
        unidadDeUso: 'g',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: tipo === 'PRODUCIDO' ? true : null,
      });

    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  async function crearProducto(): Promise<string> {
    const respuesta = await request(servidor())
      .post('/productos')
      .set('Cookie', cookie)
      .send({ nombre: `Plato ${randomUUID().slice(0, 8)}`, tipo: 'SIMPLE', categoria: null });

    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  async function activarEn(productId: string, locationId: string): Promise<void> {
    const respuesta = await request(servidor())
      .put(`/productos/${productId}/ubicaciones`)
      .set('Cookie', cookie)
      .send({ locationId, activo: true, pvp: '5.00', rendimientoPorciones: '1' });

    expect(respuesta.status).toBe(SIN_CONTENIDO);
  }

  function guardarReceta(destino: Cuerpo, locationId: string, lineas: Cuerpo[], quien = cookie) {
    return request(servidor())
      .put('/recetas')
      .set('Cookie', quien)
      .send({ destino, locationId, validFrom: AHORA, nota: null, lineas });
  }

  function linea(itemId: string, cantidad = '100', base = 'EP'): Cuerpo {
    return { itemId, cantidad, base, estado: 'ACTIVA' };
  }

  function leerReceta(productoId: string, locationId: string, quien = cookie) {
    return request(servidor())
      .get('/recetas')
      .query({ productId: productoId, locationId })
      .set('Cookie', quien);
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

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`recetas ${sufijo}`],
    );
    const company = rows[0]?.id ?? '';

    const ubicacion = async (nombre: string): Promise<string> => {
      const { rows: creadas } = await duena.query<{ id: string }>(
        `INSERT INTO location (company_id, name, type, status)
         VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
        [company, nombre],
      );
      return creadas[0]?.id ?? '';
    };
    centro = await ubicacion('Centro');
    norte = await ubicacion('Norte');

    admin = `admin.${sufijo}@snacklab.ec`;
    gerente = `gerente.${sufijo}@snacklab.ec`;
    bodeguero = `bodega.${sufijo}@snacklab.ec`;

    for (const correo of [admin, gerente, bodeguero]) {
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
      [company, centro, gerente],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, centro, bodeguero],
    );

    cookie = await entrar(admin);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('EL CRITERIO E14: los ciclos se rechazan AL GUARDAR', () => {
    it('directo — una preparación que se lleva a sí misma', async () => {
      const mayonesa = await crearItem('PRODUCIDO');
      const huevo = await crearItem('COMPRADO');

      const respuesta = await guardarReceta({ clase: 'item', itemId: mayonesa }, centro, [
        linea(huevo),
        linea(mayonesa),
      ]);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('sí misma');
    });

    it('A DOS NIVELES, que es el caso que el criterio nombra', async () => {
      const mayonesa = await crearItem('PRODUCIDO');
      const salsa = await crearItem('PRODUCIDO');
      const huevo = await crearItem('COMPRADO');

      // Mayonesa lleva huevo. Salsa lleva mayonesa. Las dos legítimas.
      expect(
        (await guardarReceta({ clase: 'item', itemId: mayonesa }, centro, [linea(huevo)])).status,
      ).toBe(CREADO);
      expect(
        (await guardarReceta({ clase: 'item', itemId: salsa }, centro, [linea(mayonesa)])).status,
      ).toBe(CREADO);

      // Ahora se intenta que la mayonesa lleve salsa: mayonesa → salsa → mayonesa.
      const respuesta = await guardarReceta({ clase: 'item', itemId: mayonesa }, centro, [
        linea(salsa),
      ]);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      // El camino sale en el mensaje: buscarlo a mano entre docenas de
      // subpreparaciones no es una opción razonable.
      expect((respuesta.body as { message: string }).message).toContain('→');
    });

    it('el ciclo se corta en la ubicación donde se guarda, no en todas', async () => {
      // El grafo es por ubicación: Norte puede tener una receta que en Centro
      // sería un ciclo, porque allí la cadena no existe.
      const mayonesa = await crearItem('PRODUCIDO');
      const salsa = await crearItem('PRODUCIDO');

      await guardarReceta({ clase: 'item', itemId: salsa }, centro, [linea(mayonesa)]);

      // En Norte no hay ninguna receta todavía: mayonesa puede llevar salsa.
      const enNorte = await guardarReceta({ clase: 'item', itemId: mayonesa }, norte, [linea(salsa)]);

      expect(enNorte.status).toBe(CREADO);
    });

    it('un ítem COMPRADO no puede tener receta propia', async () => {
      const comprado = await crearItem('COMPRADO');
      const otro = await crearItem('COMPRADO');

      const respuesta = await guardarReceta({ clase: 'item', itemId: comprado }, centro, [linea(otro)]);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
    });
  });

  describe('versionado', () => {
    it('guardar dos veces crea dos versiones, y la vigente es la última', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      const uno = await crearItem('COMPRADO');
      const dos = await crearItem('COMPRADO');

      await guardarReceta({ clase: 'producto', productId: producto }, centro, [linea(uno)]);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        linea(uno),
        linea(dos),
      ]);

      const vigente = await leerReceta(producto, centro);

      expect(vigente.status).toBe(OK);
      expect((vigente.body as { lineas: unknown[] }).lineas).toHaveLength(2);
    });

    it('una receta no se puede editar: la base lo impide', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        linea(await crearItem('COMPRADO')),
      ]);

      // Con el rol dueño, que sí ve la fila: lo que la protege es el trigger.
      await expect(
        duena.query(`UPDATE recipe SET note = 'editada' WHERE product_id = $1`, [producto]),
      ).rejects.toThrow(/no se edita/u);
    });
  });

  describe('propagación entre ubicaciones (R11)', () => {
    async function prepararPropagable(): Promise<{ producto: string; ingrediente: string }> {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await activarEn(producto, norte);
      const ingrediente = await crearItem('COMPRADO');

      await guardarReceta({ clase: 'producto', productId: producto }, centro, [linea(ingrediente)]);
      return { producto, ingrediente };
    }

    it('la previsualización dice cuántas ubicaciones perderían su receta', async () => {
      const { producto, ingrediente } = await prepararPropagable();

      // Norte todavía no tiene receta: no hay nada personalizado que perder.
      const sinRecetas = await request(servidor())
        .get('/recetas/propagacion/previsualizacion')
        .query({ productId: producto, origen: centro })
        .set('Cookie', cookie);

      expect(sinRecetas.status).toBe(OK);
      expect(sinRecetas.body).toMatchObject({ personalizadas: 0 });

      // Ahora Norte tiene la suya.
      await guardarReceta({ clase: 'producto', productId: producto }, norte, [
        linea(ingrediente, '999'),
      ]);

      const conReceta = await request(servidor())
        .get('/recetas/propagacion/previsualizacion')
        .query({ productId: producto, origen: centro })
        .set('Cookie', cookie);

      expect(conReceta.body).toMatchObject({ personalizadas: 1 });
    });

    it('propagar crea versión nueva y la anterior sigue consultable', async () => {
      const { producto, ingrediente } = await prepararPropagable();
      await guardarReceta({ clase: 'producto', productId: producto }, norte, [
        linea(ingrediente, '999'),
      ]);

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie)
        .send({ productId: producto, origen: centro, destinos: [norte] });
      expect(propagacion.status).toBe(CREADO);

      // Norte ahora tiene la receta del centro: 100, no 999.
      const enNorte = await leerReceta(producto, norte);
      expect((enNorte.body as { lineas: { cantidad: string }[] }).lineas[0]?.cantidad).toMatch(/^100/u);

      // Y la versión anterior sigue ahí: son dos filas, no una editada.
      const { rows } = await duena.query<{ total: string }>(
        `SELECT count(*) AS total FROM recipe WHERE product_id = $1 AND location_id = $2`,
        [producto, norte],
      );
      expect(Number(rows[0]?.total)).toBe(2);
    });

    it('revertir devuelve cada ubicación a su versión previa', async () => {
      const { producto, ingrediente } = await prepararPropagable();
      await guardarReceta({ clase: 'producto', productId: producto }, norte, [
        linea(ingrediente, '999'),
      ]);

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie)
        .send({ productId: producto, origen: centro, destinos: [norte] });
      const propagacionId = (propagacion.body as { id: string }).id;

      const reversion = await request(servidor())
        .post(`/recetas/propagacion/${propagacionId}/reversion`)
        .set('Cookie', cookie)
        .send({});
      expect(reversion.status).toBe(SIN_CONTENIDO);

      // Norte vuelve a su 999.
      const enNorte = await leerReceta(producto, norte);
      expect((enNorte.body as { lineas: { cantidad: string }[] }).lineas[0]?.cantidad).toMatch(/^999/u);
    });

    it('revertir sobre una ubicación que NO tenía receta la deja sin receta', async () => {
      const { producto } = await prepararPropagable();

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie)
        .send({ productId: producto, origen: centro, destinos: [norte] });

      await request(servidor())
        .post(`/recetas/propagacion/${(propagacion.body as { id: string }).id}/reversion`)
        .set('Cookie', cookie)
        .send({});

      // Una versión VOID, no una receta vacía: una receta vacía costaría cero.
      const enNorte = await leerReceta(producto, norte);
      expect(enNorte.body).toEqual({});
    });

    it('revertir dos veces da conflicto, no un 204 silencioso', async () => {
      const { producto } = await prepararPropagable();
      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie)
        .send({ productId: producto, origen: centro, destinos: [norte] });
      const id = (propagacion.body as { id: string }).id;

      await request(servidor()).post(`/recetas/propagacion/${id}/reversion`).set('Cookie', cookie).send({});
      const segunda = await request(servidor())
        .post(`/recetas/propagacion/${id}/reversion`)
        .set('Cookie', cookie)
        .send({});

      expect(segunda.body).toMatchObject({ code: 'CONFLICTO' });
    });
  });

  describe('EL CRITERIO E18: un GERENTE_LOCAL no propaga', () => {
    it('gestiona la receta de SU ubicación', async () => {
      const suya = await entrar(gerente);
      const producto = await crearProducto();
      await activarEn(producto, centro);

      const respuesta = await guardarReceta(
        { clase: 'producto', productId: producto },
        centro,
        [linea(await crearItem('COMPRADO'))],
        suya,
      );

      expect(respuesta.status).toBe(CREADO);
    });

    it('NO la de otra ubicación: es la escalada horizontal', async () => {
      const suya = await entrar(gerente);
      const producto = await crearProducto();
      await activarEn(producto, norte);

      const respuesta = await guardarReceta(
        { clase: 'producto', productId: producto },
        norte,
        [linea(await crearItem('COMPRADO'))],
        suya,
      );

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('y NO propaga: un gerente no decide cómo cocina el local de al lado', async () => {
      const suya = await entrar(gerente);
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await activarEn(producto, norte);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        linea(await crearItem('COMPRADO')),
      ]);

      const respuesta = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', suya)
        .send({ productId: producto, origen: centro, destinos: [norte] });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('CLAUDE.md §4.3 — BODEGA no ve recetas', () => {
    it('sobre la RESPUESTA CRUDA: ni las líneas ni las cantidades', async () => {
      const suya = await entrar(bodeguero);
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        linea(await crearItem('COMPRADO'), '12345'),
      ]);

      const respuesta = await leerReceta(producto, centro, suya);

      expect(respuesta.status).toBe(PROHIBIDO);
      // Y la cantidad no aparece por ninguna parte del cuerpo: con la cantidad
      // y el precio se despeja la receta.
      expect(JSON.stringify(respuesta.body)).not.toContain('12345');
    });
  });
});
