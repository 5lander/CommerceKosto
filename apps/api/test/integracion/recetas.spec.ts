/**
 * Recetas, productos y propagación — criterios de aceptación de P4.
 *
 *   E14  una receta que se referencia a sí misma **a dos niveles** se rechaza
 *        al guardar, con error de dominio
 *   E18  un `GERENTE_LOCAL` recibe 403 al propagar
 *   ---  propagar crea versión nueva en cada ubicación y las anteriores siguen
 *        consultables
 *   ---  revertir devuelve cada ubicación a su versión previa
 *   🔴   dos guardados sobre la misma versión: el segundo recibe 409 y la base
 *        tiene solo el primero (P16-B, D-16.101)
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
import { esperarBloqueadas } from '../soporte/bloqueos';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const CREADO = 201;
const SIN_CONTENIDO = 204;
const PETICION_INVALIDA = 400;
const PROHIBIDO = 403;
const CONFLICTO = 409;
/** Cuántos guardados esperan a la vez (menos que el pool de 10 de la aplicación; ver `productos.spec.ts`). */
const EN_ESPERA = 5;

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
    return cookieConCsrf(respuesta);
  }

  /** Un ítem del catálogo, comprado o producido. */
  async function crearItem(tipo: 'COMPRADO' | 'PRODUCIDO'): Promise<string> {
    const respuesta = await request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
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
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({ nombre: `Plato ${randomUUID().slice(0, 8)}`, tipo: 'SIMPLE', categoria: null });

    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  /** La versión del producto que un formulario leería (D-16.100). */
  async function versionDe(productId: string): Promise<number> {
    const ficha = await request(servidor()).get(`/productos/${productId}`).set('Cookie', cookie);
    expect(ficha.status).toBe(OK);
    return (ficha.body as { version: number }).version;
  }

  async function activarEn(productId: string, locationId: string): Promise<void> {
    const respuesta = await request(servidor())
      .put(`/productos/${productId}/ubicaciones`)
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({ locationId, activo: true, pvp: '5.00', rendimientoPorciones: '1', version: await versionDe(productId) });

    expect(respuesta.status).toBe(OK);
  }

  /** La última versión creada de ese destino, la que el editor manda como `basadaEn`. */
  async function ultimaVersion(destino: Cuerpo, locationId: string): Promise<string | null> {
    const clave = destino['clase'] === 'producto' ? { productId: destino['productId'] } : { itemId: destino['itemId'] };
    const respuesta = await request(servidor()).get('/recetas').query({ ...clave, locationId }).set('Cookie', cookie);
    expect(respuesta.status).toBe(OK);
    return (respuesta.body as { ultimaVersionId: string | null }).ultimaVersionId;
  }

  function guardarSobre(basadaEn: string | null, destino: Cuerpo, locationId: string, lineas: Cuerpo[], quien = cookie) {
    return request(servidor())
      .put('/recetas')
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien))
      .send({ basadaEn, destino, locationId, validFrom: AHORA, nota: null, lineas });
  }

  /** Guarda sobre la última versión que haya: lo que hace un editor que no compite con nadie. */
  async function guardarReceta(destino: Cuerpo, locationId: string, lineas: Cuerpo[], quien = cookie) {
    return guardarSobre(await ultimaVersion(destino, locationId), destino, locationId, lineas, quien);
  }

  function linea(itemId: string, cantidad = '100', base = 'EP'): Cuerpo {
    return { itemId, cantidad, base, estado: 'ACTIVA' };
  }

  function leerReceta(productoId: string, locationId: string, quien = cookie) {
    return request(servidor())
      .get('/recetas')
      .query({ productId: productoId, locationId })
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien));
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
      expect((vigente.body as { vigente: { lineas: unknown[] } }).vigente.lineas).toHaveLength(2);
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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(sinRecetas.status).toBe(OK);
      expect(sinRecetas.body).toMatchObject({ personalizadas: 0 });

      // Ahora Norte tiene la suya.
      await guardarReceta({ clase: 'producto', productId: producto }, norte, [
        linea(ingrediente, '999'),
      ]);

      const conReceta = await request(servidor())
        .get('/recetas/propagacion/previsualizacion')
        .query({ productId: producto, origen: centro })
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(conReceta.body).toMatchObject({ personalizadas: 1 });
    });

    it('propagar crea versión nueva y la anterior sigue consultable', async () => {
      const { producto, ingrediente } = await prepararPropagable();
      await guardarReceta({ clase: 'producto', productId: producto }, norte, [
        linea(ingrediente, '999'),
      ]);

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ productId: producto, origen: centro, destinos: [norte] });
      expect(propagacion.status).toBe(CREADO);

      // Norte ahora tiene la receta del centro: 100, no 999.
      const enNorte = await leerReceta(producto, norte);
      expect((enNorte.body as { vigente: { lineas: { cantidad: string }[] } }).vigente.lineas[0]?.cantidad).toMatch(/^100/u);

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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ productId: producto, origen: centro, destinos: [norte] });
      const propagacionId = (propagacion.body as { id: string }).id;

      const reversion = await request(servidor())
        .post(`/recetas/propagacion/${propagacionId}/reversion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({});
      expect(reversion.status).toBe(SIN_CONTENIDO);

      // Norte vuelve a su 999.
      const enNorte = await leerReceta(producto, norte);
      expect((enNorte.body as { vigente: { lineas: { cantidad: string }[] } }).vigente.lineas[0]?.cantidad).toMatch(/^999/u);
    });

    it('revertir sobre una ubicación que NO tenía receta la deja sin receta', async () => {
      const { producto } = await prepararPropagable();

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ productId: producto, origen: centro, destinos: [norte] });

      await request(servidor())
        .post(`/recetas/propagacion/${(propagacion.body as { id: string }).id}/reversion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({});

      // Una versión VOID, no una receta vacía: una receta vacía costaría cero.
      // Y la VOID sí es la última creada: un editor que abra Norte guarda sobre ella.
      const enNorte = await leerReceta(producto, norte);
      expect(enNorte.body).toMatchObject({ vigente: null });
      expect((enNorte.body as { ultimaVersionId: string | null }).ultimaVersionId).not.toBeNull();
    });

    it('revertir dos veces da conflicto, no un 204 silencioso', async () => {
      const { producto } = await prepararPropagable();
      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ productId: producto, origen: centro, destinos: [norte] });
      const id = (propagacion.body as { id: string }).id;

      await request(servidor()).post(`/recetas/propagacion/${id}/reversion`).set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({});
      const segunda = await request(servidor())
        .post(`/recetas/propagacion/${id}/reversion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({});

      expect(segunda.body).toMatchObject({ code: 'CONFLICTO' });
    });
  });

  describe('concurrencia optimista de la receta (P16-B, D-16.101, ADR-023)', () => {
    it('🔴 dos guardados sobre la misma versión: el segundo recibe 409 y la base tiene solo el primero', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      const destino = { clase: 'producto', productId: producto };
      const uno = await crearItem('COMPRADO');
      const dos = await crearItem('COMPRADO');
      const base = await ultimaVersion(destino, centro);

      const primero = await guardarSobre(base, destino, centro, [linea(uno, '111')]);
      const segundo = await guardarSobre(base, destino, centro, [linea(dos, '222')]);

      expect(primero.status).toBe(CREADO);
      expect(segundo.status).toBe(CONFLICTO);
      expect(segundo.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });

      // La base, no la respuesta: una sola versión, y es la del primero.
      const { rows } = await duena.query<{ total: string; cantidad: string }>(
        `SELECT count(DISTINCT r.id)::text AS total, max(l.cantidad)::text AS cantidad
           FROM recipe r JOIN recipe_line l ON l.recipe_id = r.id
          WHERE r.product_id = $1 AND r.location_id = $2`,
        [producto, centro],
      );
      expect(rows[0]).toMatchObject({ total: '1' });
      expect(rows[0]?.cantidad).toMatch(/^111/u);
    });

    /**
     * La de arriba manda las dos peticiones una detrás de otra, y ahí basta con
     * comparar. Esta las pone A LA VEZ, que es donde la comparación sola deja
     * pasar a varias: todas leen la misma última versión antes de que ninguna
     * inserte. Lo que la hace pasar es el candado consultivo (D-16.101).
     *
     * Sin depender del reloj: otra conexión bloquea la fila del producto con
     * `FOR UPDATE`, que choca con el `FOR KEY SHARE` de la clave foránea de
     * `recipe`. Sin candado, los cinco leen la versión y se paran en el `INSERT`:
     * al soltar, cinco 201. Con candado, el primero se para en el `INSERT` y los
     * otros cuatro en el candado, antes de leer: al soltar, un 201 y cuatro 409.
     */
    it('🔴 cinco guardados esperando A LA VEZ sobre la misma versión: uno crea, cuatro reciben 409, y hay una sola versión', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      const destino = { clase: 'producto', productId: producto };
      const item = await crearItem('COMPRADO');
      const base = await ultimaVersion(destino, centro);
      const cerrojo = new Client({ connectionString: URL_MIGRATOR });
      await cerrojo.connect();

      let estados: number[];
      try {
        await cerrojo.query('BEGIN');
        await cerrojo.query('SELECT id FROM product WHERE id = $1 FOR UPDATE', [producto]);
        const enCurso = Promise.all(
          Array.from({ length: EN_ESPERA }, (_, i) =>
            guardarSobre(base, destino, centro, [linea(item, String(i + 1))]).then((r) => r.status),
          ),
        );
        await esperarBloqueadas(cerrojo, EN_ESPERA);
        await cerrojo.query('COMMIT');
        estados = (await enCurso).sort((a, b) => a - b);
      } finally {
        await cerrojo.end();
      }

      expect(estados).toEqual([CREADO, ...Array.from({ length: EN_ESPERA - 1 }, () => CONFLICTO)]);
      const { rows } = await duena.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM recipe WHERE product_id = $1 AND location_id = $2',
        [producto, centro],
      );
      expect(rows[0]?.total).toBe('1');
    });

    it('🔴 la versión nueva es la base del siguiente guardado: encadenar no da conflicto', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      const destino = { clase: 'producto', productId: producto };
      const item = await crearItem('COMPRADO');

      const primero = await guardarSobre(null, destino, centro, [linea(item, '1')]);
      const segundo = await guardarSobre((primero.body as { id: string }).id, destino, centro, [linea(item, '2')]);

      expect(primero.status).toBe(CREADO);
      expect(segundo.status).toBe(CREADO);
    });

    it('🔴 el testigo es por UBICACIÓN: editar Centro no bloquea a quien edita Norte (sin la deuda de D-16.20)', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await activarEn(producto, norte);
      const destino = { clase: 'producto', productId: producto };
      const item = await crearItem('COMPRADO');
      const baseNorte = await ultimaVersion(destino, norte);

      expect((await guardarReceta(destino, centro, [linea(item)])).status).toBe(CREADO);
      expect((await guardarSobre(baseNorte, destino, norte, [linea(item)])).status).toBe(CREADO);
    });

    it('🔴 una propagación sobrescribe, y el formulario abierto en ese local se entera con 409', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await activarEn(producto, norte);
      const destino = { clase: 'producto', productId: producto };
      const item = await crearItem('COMPRADO');
      await guardarReceta(destino, centro, [linea(item)]);
      const abiertoEnNorte = await ultimaVersion(destino, norte);

      const propagacion = await request(servidor())
        .post('/recetas/propagacion')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ productId: producto, origen: centro, destinos: [norte] });
      expect(propagacion.status).toBe(CREADO);

      const tarde = await guardarSobre(abiertoEnNorte, destino, norte, [linea(item, '5')]);
      expect(tarde.status).toBe(CONFLICTO);
      expect(tarde.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });
    });

    it('basadaEn es obligatorio: omitirlo es 400, no un guardado sin comprobar', async () => {
      const producto = await crearProducto();
      const respuesta = await request(servidor())
        .put('/recetas')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ destino: { clase: 'producto', productId: producto }, locationId: centro, validFrom: AHORA, nota: null, lineas: [] });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });
  });

  describe('el historial de una receta (P16-B)', () => {
    it('GET /recetas/versiones trae todas las versiones y la última creada', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      const destino = { clase: 'producto', productId: producto };
      const item = await crearItem('COMPRADO');
      await guardarReceta(destino, centro, [linea(item, '1')]);
      const segunda = await guardarReceta(destino, centro, [linea(item, '2')]);

      const respuesta = await request(servidor())
        .get('/recetas/versiones')
        .query({ productId: producto, locationId: centro })
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(OK);
      const cuerpo = respuesta.body as { versiones: unknown[]; ultimaVersionId: string };
      expect(cuerpo.versiones).toHaveLength(2);
      expect(cuerpo.ultimaVersionId).toBe((segunda.body as { id: string }).id);
    });

    it('GET /recetas/propagacion lista las propagaciones del producto, la más reciente primero', async () => {
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await activarEn(producto, norte);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [linea(await crearItem('COMPRADO'))]);
      const envio = { productId: producto, origen: centro, destinos: [norte] };
      const primera = await request(servidor()).post('/recetas/propagacion').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send(envio);
      const segunda = await request(servidor()).post('/recetas/propagacion').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send(envio);

      const respuesta = await request(servidor()).get('/recetas/propagacion').query({ productId: producto }).set('Cookie', cookie);

      expect(respuesta.status).toBe(OK);
      expect((respuesta.body as { id: string }[]).map((p) => p.id)).toEqual([
        (segunda.body as { id: string }).id,
        (primera.body as { id: string }).id,
      ]);
    });

    it('un GERENTE_LOCAL no lista propagaciones: sin permiso de propagar no hay nada que revertir', async () => {
      const suya = await entrar(gerente);
      const respuesta = await request(servidor()).get('/recetas/propagacion').query({ productId: await crearProducto() }).set('Cookie', suya);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('la previsualización ya pasa por esquema: un parámetro de más es 400 (D-16.111)', async () => {
      const respuesta = await request(servidor())
        .get('/recetas/propagacion/previsualizacion')
        .query({ productId: await crearProducto(), origen: centro, companyId: randomUUID() })
        .set('Cookie', cookie);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
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
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
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
        .set('Cookie', suya).set('X-CSRF-Token', csrfDe(suya))
        .send({ productId: producto, origen: centro, destinos: [norte] });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('CLAUDE.md §4.3 — BODEGA no ve recetas', () => {
    it('tampoco sus versiones', async () => {
      const suya = await entrar(bodeguero);
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [linea(await crearItem('COMPRADO'), '54321')]);

      const respuesta = await request(servidor()).get('/recetas/versiones').query({ productId: producto, locationId: centro }).set('Cookie', suya);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      expect(JSON.stringify(respuesta.body)).not.toContain('54321');
    });

    it('sobre la RESPUESTA CRUDA: ni las líneas ni las cantidades', async () => {
      const suya = await entrar(bodeguero);
      const producto = await crearProducto();
      await activarEn(producto, centro);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        linea(await crearItem('COMPRADO'), '12345'),
      ]);

      const respuesta = await leerReceta(producto, centro, suya);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      // Y la cantidad no aparece por ninguna parte del cuerpo: con la cantidad
      // y el precio se despeja la receta.
      expect(JSON.stringify(respuesta.body)).not.toContain('12345');
    });
  });
});
