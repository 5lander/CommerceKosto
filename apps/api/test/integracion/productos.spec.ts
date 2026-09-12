/**
 * El agregado producto — P16-B.
 *
 *   🔴  concurrencia optimista (D-16.100, ADR-023): dos escrituras con la misma
 *       versión, en la configuración por ubicación, en el empaque y en los
 *       componentes; la segunda recibe 409 y la BASE tiene lo de la primera. Y
 *       la versión es del agregado: escribir el empaque deja obsoleto un
 *       formulario de ubicación abierto antes
 *   🔴  INC-012, cuarta recurrencia (D-16.110): PVP y rendimiento por lote en
 *       cero salían como 500 contra un CHECK; ahora son 400
 *   🔴  el lote sube la versión (D-16.102)
 *   ---  la ficha, sus ubicaciones filtradas por alcance (D-16.113) y la carta
 *       de una ubicación con nombres
 *   ---  los componentes de un combo (D-16.114): lectura, reemplazo y las cinco
 *       formas de pedir una lista inválida
 *   §4.3 BODEGA no ve PVP ni carta, sobre la respuesta cruda
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import {
  REPOSITORIO_DE_RECETAS,
  type RepositorioDeRecetas,
} from '../../src/modules/recipes/application/ports/repositorio-de-recetas.port';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import {
  companyId as aCompanyId,
  locationId as aLocationId,
  productId as aProductId,
  userId as aUserId,
} from '../../src/shared/domain/identity/identificadores';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { esperarBloqueadas } from '../soporte/bloqueos';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const CREADO = 201;
const PETICION_INVALIDA = 400;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const CONFLICTO = 409;
/**
 * Cuántas escrituras esperan a la vez la fila bloqueada. Menos que el pool de la
 * aplicación (10 conexiones por defecto de `pg`): cada una retiene la suya
 * mientras espera, y las lecturas previas de las demás necesitan dónde correr.
 */
const EN_ESPERA = 5;

const CONTRASENA = 'tres cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

describe('el agregado producto', () => {
  let app: INestApplication;
  let duena: Client;
  let company: string;
  let adminId: string;
  let admin: string;
  let gerente: string;
  let bodega: string;
  let centro: string;
  let norte: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor()).post('/auth/login').send({ email, contrasena: CONTRASENA });
    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  function escribir(metodo: 'post' | 'put', ruta: string, cuerpo: Cuerpo, quien = admin) {
    return request(servidor())[metodo](ruta).set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien)).send(cuerpo);
  }

  function leer(ruta: string, quien = admin, consulta: Record<string, string> = {}) {
    return request(servidor()).get(ruta).query(consulta).set('Cookie', quien);
  }

  async function crearProducto(tipo: 'SIMPLE' | 'COMBO' = 'SIMPLE'): Promise<string> {
    const respuesta = await escribir('post', '/productos', { nombre: `Plato ${randomUUID().slice(0, 8)}`, tipo, categoria: null });
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  async function versionDe(productId: string): Promise<number> {
    const ficha = await leer(`/productos/${productId}`);
    expect(ficha.status).toBe(OK);
    return (ficha.body as { version: number }).version;
  }

  function configurar(productId: string, cambios: Cuerpo) {
    return escribir('put', `/productos/${productId}/ubicaciones`, {
      locationId: centro,
      activo: true,
      pvp: '5.00',
      rendimientoPorciones: '1',
      ...cambios,
    });
  }

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({ ...configuracion, rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 } });
    await app.init();

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(`INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`, [`productos ${sufijo}`]);
    company = rows[0]?.id ?? '';

    const ubicacion = async (nombre: string): Promise<string> => {
      const { rows: filas } = await duena.query<{ id: string }>(
        `INSERT INTO location (company_id, name, type, status) VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
        [company, nombre],
      );
      return filas[0]?.id ?? '';
    };
    centro = await ubicacion('Centro');
    norte = await ubicacion('Norte');

    const correos = { admin: `admin.${sufijo}@snacklab.ec`, gerente: `gerente.${sufijo}@snacklab.ec`, bodega: `bodega.${sufijo}@snacklab.ec` };
    for (const correo of Object.values(correos)) {
      await duena.query(`INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`, [company, correo, hash]);
    }
    await duena.query(`INSERT INTO user_role (company_id, user_id, role_code, has_location) SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`, [company, correos.admin]);
    await duena.query(`INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location) SELECT $1, id, 'GERENTE_LOCAL', $2, true FROM app_user WHERE email = $3`, [company, centro, correos.gerente]);
    await duena.query(`INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location) SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`, [company, centro, correos.bodega]);
    const { rows: usuarios } = await duena.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [correos.admin]);
    adminId = usuarios[0]?.id ?? '';

    admin = await entrar(correos.admin);
    gerente = await entrar(correos.gerente);
    bodega = await entrar(correos.bodega);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('la ficha', () => {
    it('nace con versión 1 y la publica', async () => {
      const producto = await crearProducto();
      const ficha = await leer(`/productos/${producto}`);

      expect(ficha.status).toBe(OK);
      expect(ficha.body).toMatchObject({ id: producto, tipo: 'SIMPLE', version: 1, empaqueItemId: null });
    });

    it('un producto de OTRA company es 404, con el mismo texto que uno inventado (IDOR)', async () => {
      const { rows } = await duena.query<{ id: string }>(`INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`, [`ajena ${randomUUID().slice(0, 8)}`]);
      const { rows: ajenos } = await duena.query<{ id: string }>(
        `INSERT INTO product (company_id, name, type, status) VALUES ($1, 'Ajeno', 'SIMPLE', 'ACTIVE') RETURNING id`,
        [rows[0]?.id],
      );

      const ajeno = await leer(`/productos/${ajenos[0]?.id ?? ''}`);
      const inventado = await leer(`/productos/${randomUUID()}`);

      expect(ajeno.status).toBe(NO_ENCONTRADO);
      expect((ajeno.body as { message: string }).message).toBe((inventado.body as { message: string }).message);
    });

    it('BODEGA no la lee', async () => {
      const respuesta = await leer(`/productos/${await crearProducto()}`, bodega);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('🔴 concurrencia optimista del agregado (D-16.100, ADR-023)', () => {
    it('configuración por ubicación: dos escrituras con la misma versión, la segunda 409 y la base con la primera', async () => {
      const producto = await crearProducto();
      const version = await versionDe(producto);

      const primera = await configurar(producto, { pvp: '5.00', version });
      const segunda = await configurar(producto, { pvp: '9.00', version });

      expect(primera.status).toBe(OK);
      expect(primera.body).toEqual({ version: version + 1 });
      expect(segunda.status).toBe(CONFLICTO);
      expect(segunda.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });

      const { rows } = await duena.query<{ pvp: string; version: number }>(
        `SELECT pl.pvp::text AS pvp, p.version FROM product_location pl JOIN product p ON p.id = pl.product_id
          WHERE pl.product_id = $1 AND pl.location_id = $2`,
        [producto, centro],
      );
      expect(rows[0]?.pvp).toMatch(/^5\.00/u);
      expect(rows[0]?.version).toBe(version + 1);
    });

    /**
     * LA CONDICIÓN VA EN EL `WHERE` (`escritura-versionada.ts`), y esta es la
     * prueba que lo distingue de un `if` previo. Mandar diez peticiones «a la
     * vez» no basta: la transacción del producto es tan corta que en local no se
     * solapan, y un leer-comparar-escribir pasaba igual — el guardián lo enseñó.
     *
     * Así la carrera no depende del reloj: otra conexión bloquea la fila, las
     * cinco escrituras leen la versión (un `SELECT` no espera a un `FOR UPDATE`)
     * y se quedan paradas en el `UPDATE`; solo cuando las cinco esperan se suelta.
     * Con la versión en el `WHERE`, la primera escribe y las otras cuatro vuelven
     * a evaluar la condición contra la fila ya escrita: cero filas, 409. Con un
     * `if` previo, las cinco ya compararon contra la versión vieja: cinco 200.
     */
    it('cinco escrituras paradas sobre la fila bloqueada, con la misma versión: una 200 y cuatro 409', async () => {
      const producto = await crearProducto();
      const version = await versionDe(producto);
      const cerrojo = new Client({ connectionString: URL_MIGRATOR });
      await cerrojo.connect();

      try {
        await cerrojo.query('BEGIN');
        await cerrojo.query('SELECT id FROM product WHERE id = $1 FOR UPDATE', [producto]);
        const enCurso = Promise.all(
          Array.from({ length: EN_ESPERA }, (_, i) => configurar(producto, { pvp: `${String(i + 1)}.00`, version }).then((r) => r.status)),
        );
        await esperarBloqueadas(cerrojo, EN_ESPERA);
        await cerrojo.query('COMMIT');

        const estados = (await enCurso).sort((a, b) => a - b);
        expect(estados).toEqual([OK, ...Array.from({ length: EN_ESPERA - 1 }, () => CONFLICTO)]);
        expect(await versionDe(producto)).toBe(version + 1);
      } finally {
        await cerrojo.end();
      }
    });

    it('empaque: la misma carrera, el mismo desenlace', async () => {
      const producto = await crearProducto();
      const version = await versionDe(producto);
      const empaque = await crearItem();

      const primera = await escribir('put', `/productos/${producto}/empaque`, { empaqueItemId: empaque, version });
      const segunda = await escribir('put', `/productos/${producto}/empaque`, { empaqueItemId: null, version });

      expect(primera.status).toBe(OK);
      expect(segunda.status).toBe(CONFLICTO);
      expect(segunda.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });
      const { rows } = await duena.query<{ packaging_item_id: string | null }>('SELECT packaging_item_id FROM product WHERE id = $1', [producto]);
      expect(rows[0]?.packaging_item_id).toBe(empaque);
    });

    it('la versión es del AGREGADO: cambiar el empaque deja obsoleto un formulario de ubicación abierto antes', async () => {
      const producto = await crearProducto();
      const leidaPorElFormulario = await versionDe(producto);

      expect((await escribir('put', `/productos/${producto}/empaque`, { empaqueItemId: null, version: leidaPorElFormulario })).status).toBe(OK);
      const tarde = await configurar(producto, { version: leidaPorElFormulario });

      expect(tarde.status).toBe(CONFLICTO);
      expect(tarde.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });
    });

    it('un producto inexistente con cualquier versión es 404, no 409', async () => {
      const respuesta = await configurar(randomUUID(), { version: 1 });
      expect(respuesta.status).toBe(NO_ENCONTRADO);
    });

    it('🔴 el lote sube la versión del combo que compone (D-16.102)', async () => {
      const combo = await crearProducto('COMBO');
      const simple = await crearProducto();
      const antes = await versionDe(combo);

      const repositorio = app.get<RepositorioDeRecetas>(REPOSITORIO_DE_RECETAS);
      await repositorio.guardarRecetasEnLote({
        companyId: aCompanyId(company),
        locationId: aLocationId(centro),
        recetas: [],
        combos: [{ comboProductId: aProductId(combo), componentProductId: aProductId(simple), cantidad: '1' }],
        validFrom: new Date(),
        createdBy: aUserId(adminId),
      });

      expect(await versionDe(combo)).toBe(antes + 1);
    });
  });

  describe('🔴 INC-012, cuarta recurrencia: los ceros que salían como 500 (D-16.110)', () => {
    it('PVP "0" es 400 ENTRADA_INVALIDA', async () => {
      const producto = await crearProducto();
      const respuesta = await configurar(producto, { pvp: '0', version: await versionDe(producto) });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('rendimiento por lote "0" es 400 ENTRADA_INVALIDA', async () => {
      const producto = await crearProducto();
      const respuesta = await configurar(producto, { rendimientoPorciones: '0.00', version: await versionDe(producto) });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });
  });

  describe('el empaque (D-16.112)', () => {
    it('un ítem de empaque que no existe es 400 sobre el empaque, no 404 sobre el producto', async () => {
      const producto = await crearProducto();
      const respuesta = await escribir('put', `/productos/${producto}/empaque`, { empaqueItemId: randomUUID(), version: await versionDe(producto) });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      expect((respuesta.body as { message: string }).message).toContain('empaque');
    });
  });

  describe('las ubicaciones de un producto (D-16.113)', () => {
    it('ADMIN ve las dos; GERENTE_LOCAL solo la suya', async () => {
      const producto = await crearProducto();
      expect((await configurar(producto, { version: 1 })).status).toBe(OK);
      expect((await configurar(producto, { locationId: norte, pvp: '7.00', version: 2 })).status).toBe(OK);

      const deAdmin = await leer(`/productos/${producto}/ubicaciones`);
      const deGerente = await leer(`/productos/${producto}/ubicaciones`, gerente);

      expect((deAdmin.body as { locationId: string }[]).map((u) => u.locationId).sort()).toEqual([centro, norte].sort());
      expect((deGerente.body as { locationId: string }[]).map((u) => u.locationId)).toEqual([centro]);
      // El PVP del local de al lado no viaja: sobre el cuerpo crudo.
      expect(JSON.stringify(deGerente.body)).not.toContain('7.00');
    });
  });

  describe('la carta de una ubicación', () => {
    it('trae los productos configurados en ella, con su nombre', async () => {
      const producto = await crearProducto();
      await configurar(producto, { version: 1 });

      const respuesta = await leer('/productos/ubicaciones', admin, { locationId: centro });

      expect(respuesta.status).toBe(OK);
      const suyo = (respuesta.body as { productId: string; nombre: string }[]).find((p) => p.productId === producto);
      expect(suyo?.nombre).toMatch(/^Plato /u);
    });

    it('GERENTE_LOCAL no pide la carta de otra ubicación', async () => {
      const respuesta = await leer('/productos/ubicaciones', gerente, { locationId: norte });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('§4.3 — BODEGA no la recibe, y en la respuesta cruda no hay ni un PVP', async () => {
      const respuesta = await leer('/productos/ubicaciones', bodega, { locationId: centro });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      expect(JSON.stringify(respuesta.body)).not.toContain('pvp');
    });
  });

  describe('los componentes de un combo (D-16.114)', () => {
    function componer(combo: string, componentes: Cuerpo[], version: number, quien = admin) {
      return escribir('put', `/productos/${combo}/componentes`, { componentes, version }, quien);
    }

    it('se leen vacíos, se reemplazan con la versión y vuelven con sus nombres', async () => {
      const combo = await crearProducto('COMBO');
      const papas = await crearProducto();
      const bebida = await crearProducto();

      const vacio = await leer(`/productos/${combo}/componentes`);
      expect(vacio.body).toEqual({ version: 1, componentes: [] });

      const guardado = await componer(combo, [{ productId: papas, cantidad: '1' }, { productId: bebida, cantidad: '0.5' }], 1);
      expect(guardado.status).toBe(OK);
      expect(guardado.body).toEqual({ version: 2 });

      const leido = await leer(`/productos/${combo}/componentes`);
      const cuerpo = leido.body as { version: number; componentes: { productId: string; nombre: string }[] };
      expect(cuerpo.version).toBe(2);
      expect(cuerpo.componentes.map((c) => c.productId).sort()).toEqual([papas, bebida].sort());
      expect(cuerpo.componentes.every((c) => c.nombre.startsWith('Plato '))).toBe(true);
    });

    it('🔴 reemplazar sobre una versión vieja es 409 y la lista no cambia', async () => {
      const combo = await crearProducto('COMBO');
      const papas = await crearProducto();
      await componer(combo, [{ productId: papas, cantidad: '1' }], 1);

      const tarde = await componer(combo, [], 1);

      expect(tarde.status).toBe(CONFLICTO);
      expect(tarde.body).toMatchObject({ code: 'CONFLICTO_DE_VERSION' });
      const { rows } = await duena.query<{ total: string }>('SELECT count(*)::text AS total FROM combo_component WHERE combo_product_id = $1', [combo]);
      expect(rows[0]?.total).toBe('1');
    });

    it.each([
      ['un combo dentro de otro', 'otro combo'],
      ['el propio combo', 'a sí mismo'],
      ['un producto repetido', 'dos veces'],
      ['un producto de otra company', 'no existe'],
    ])('%s es 400 con su motivo, no un 500 de la base', async (caso, motivo) => {
      const combo = await crearProducto('COMBO');
      const simple = await crearProducto();
      const componentes: Record<string, Cuerpo[]> = {
        'un combo dentro de otro': [{ productId: await crearProducto('COMBO'), cantidad: '1' }],
        'el propio combo': [{ productId: combo, cantidad: '1' }],
        'un producto repetido': [{ productId: simple, cantidad: '1' }, { productId: simple, cantidad: '2' }],
        'un producto de otra company': [{ productId: randomUUID(), cantidad: '1' }],
      };

      const respuesta = await componer(combo, componentes[caso] ?? [], 1);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      expect((respuesta.body as { message: string }).message).toContain(motivo);
    });

    it('un producto SIMPLE no lleva componentes', async () => {
      const simple = await crearProducto();
      const respuesta = await componer(simple, [{ productId: await crearProducto(), cantidad: '1' }], 1);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('COMBO');
    });

    it('cantidad "0" es 400 en el esquema (combo_component_cantidad_positiva)', async () => {
      const combo = await crearProducto('COMBO');
      const respuesta = await componer(combo, [{ productId: await crearProducto(), cantidad: '0' }], 1);

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('GERENTE_LOCAL los lee y no los escribe: el combo es de la company', async () => {
      const combo = await crearProducto('COMBO');

      expect((await leer(`/productos/${combo}/componentes`, gerente)).status).toBe(OK);
      const respuesta = await componer(combo, [], 1, gerente);
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  async function crearItem(): Promise<string> {
    const respuesta = await escribir('post', '/catalogo/items', {
      nombre: `Bolsa ${randomUUID().slice(0, 8)}`,
      tipo: 'COMPRADO',
      unidadDeUso: 'unid',
      rendimiento: '1',
      grupoId: null,
      confianzaDePrecio: 'FACTURA',
      llevaStock: null,
    });
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }
});
