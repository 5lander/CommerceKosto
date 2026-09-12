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
 * Desde P16-A2 cubre además las tres lecturas que faltaban —el catálogo de
 * unidades y las dos fichas—, el alta que ahora comprueba que la unidad EXISTA
 * (INC-012) y los choques de nombre que salían como 500.
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
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const CREADO = 201;
const SIN_CONTENIDO = 204;
const PETICION_INVALIDA = 400;
const NO_AUTORIZADO = 401;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const CONFLICTO = 409;

/**
 * Lo que una ficha del catálogo NO puede traer, ni a `BODEGA` ni a nadie:
 * son los derivados de la receta de CLAUDE.md §4.3. Se comprueba sobre el
 * CUERPO CRUDO, no sobre lo que la pantalla pinte.
 *
 * **ES UNA ALARMA, NO LA MEDIDA** (INC-007). Buscar estas seis cadenas en el
 * JSON no puede fallar hoy: ningún campo de estas fichas puede llamarse así, y
 * si mañana la lista de §4.3 creciera —`stockTeorico`, `puntoDeReorden`— esta
 * comprobación seguiría en verde sin enterarse. Lo que de verdad mide es lo de
 * abajo: las claves EXACTAS que cada ficha publica, y que el cuerpo de
 * `BODEGA` sea idéntico al de `ADMIN` (que atrapa el fallo contrario, una
 * proyección mutilada).
 */
const PROHIBIDOS_PARA_BODEGA = ['receta', 'lineas', 'consumo', 'costo', 'margen', 'foodCost'];

/**
 * LAS CLAVES QUE SE PUBLICAN, una por una y ordenadas.
 *
 * Un campo nuevo en cualquiera de estas proyecciones —se llame como se llame—
 * rompe la prueba, que es justo lo que una comprobación de §4.3 tiene que
 * hacer: obligar a que alguien decida si ese campo puede salir. Salen de
 * `ItemLeido`, `GrupoLeido` y `ArticuloLeido` del puerto del catálogo.
 */
const CLAVES_DE_ITEM = [
  'confianzaDePrecio',
  'estado',
  'grupoId',
  'id',
  'llevaStock',
  'nombre',
  'rendimiento',
  'tipo',
  'unidadDeUso',
];
const CLAVES_DE_GRUPO = ['id', 'ivaTarifa', 'nombre'];
const CLAVES_DE_ARTICULO = [
  'estado',
  'factorDeConversion',
  'id',
  'itemId',
  'ivaTarifa',
  'marca',
  'nombre',
  'presentacion',
  'proveedor',
  'unidadDePresentacion',
];

/** La ficha del ítem es la fila de la lista MÁS su grupo y sus artículos. */
const CLAVES_DE_FICHA_DE_ITEM = [...CLAVES_DE_ITEM, 'grupo', 'articulos'].sort();
/** Y la del artículo, la fila de la lista MÁS su ítem. */
const CLAVES_DE_FICHA_DE_ARTICULO = [...CLAVES_DE_ARTICULO, 'item'].sort();

/** Las claves de un objeto de la respuesta, ordenadas para poder compararlas. */
function claves(valor: unknown): readonly string[] {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto y llegó: ${String(valor)}`);
  }
  return Object.keys(valor).sort();
}

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
  let bodega: string;
  let otraAdmin: string;
  let cookieAdmin: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function sembrarTenant(
    prefijo: string,
  ): Promise<{ admin: string; gerente: string; bodega: string }> {
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
    const correoBodega = await crear('bodega');

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
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, local, correoBodega],
    );

    return { admin: correoAdmin, gerente: correoGerente, bodega: correoBodega };
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CONTRASENA });

    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  function crearItem(cookie: string, cambios: Cuerpo = {}) {
    return request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
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
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
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
    bodega = una.bodega;
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
        .set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin));
      expect((articulos.body as unknown[]).length).toBe(3);

      // Lo que ve quien arma una receta: el ítem, una vez. Las marcas no.
      const items = await request(servidor()).get('/catalogo/items').set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin));
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
        .set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin));

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
        .set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin))
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

      expect((await request(servidor()).get('/catalogo/items').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))).status).toBe(OK);
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
      const items = await request(servidor()).get('/catalogo/items').set('Cookie', ajena).set('X-CSRF-Token', csrfDe(ajena));

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
        .set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin))
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

      const activos = await request(servidor()).get('/catalogo/items').set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin));
      expect((activos.body as { nombre: string }[]).map((i) => i.nombre)).not.toContain(nombre);

      const todos = await request(servidor())
        .get('/catalogo/items')
        .query({ incluirInactivos: 'true' })
        .set('Cookie', cookieAdmin).set('X-CSRF-Token', csrfDe(cookieAdmin));
      expect((todos.body as { nombre: string }[]).map((i) => i.nombre)).toContain(nombre);
    });
  });

  describe('GET /catalogo/unidades — P16-A2', () => {
    interface Unidad {
      readonly codigo: string;
      readonly nombre: string;
      readonly dimension: string;
    }

    function unidades(cookie: string) {
      return request(servidor())
        .get('/catalogo/unidades')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie));
    }

    it('devuelve las diez del catálogo, con nombre y dimensión', async () => {
      const respuesta = await unidades(cookieAdmin);

      expect(respuesta.status).toBe(OK);
      const lista = respuesta.body as Unidad[];
      expect(lista.map((u) => u.codigo).sort()).toEqual([
        'doc',
        'g',
        'gal',
        'kg',
        'lb',
        'lt',
        'mg',
        'ml',
        'oz',
        'unid',
      ]);
      expect(lista.find((u) => u.codigo === 'kg')).toEqual({
        codigo: 'kg',
        nombre: 'kilogramo',
        dimension: 'MASA',
      });
    });

    /**
     * El factor a base es un `Ratio` y no significa nada en una pantalla;
     * serializarlo expondría el interior del tipo decimal (ADR-003). Esta
     * prueba está para que nadie lo «añada porque ya estaba leído».
     */
    it('NO publica el factor a base: es para multiplicar, no para enseñar', async () => {
      const lista = (await unidades(cookieAdmin)).body as Record<string, unknown>[];

      for (const unidad of lista) {
        expect(Object.keys(unidad).sort()).toEqual(['codigo', 'dimension', 'nombre']);
      }
    });

    it('ordena por dimensión y dentro por tamaño: se lee como una escala', async () => {
      const masa = ((await unidades(cookieAdmin)).body as Unidad[])
        .filter((u) => u.dimension === 'MASA')
        .map((u) => u.codigo);

      expect(masa).toEqual(['mg', 'g', 'oz', 'lb', 'kg']);
    });

    it('BODEGA también la lee: la necesita para entender un conteo', async () => {
      const cookie = await entrar(bodega);

      expect((await unidades(cookie)).status).toBe(OK);
    });

    it('sin sesión no hay catálogo, aunque la tabla sea global', async () => {
      expect((await request(servidor()).get('/catalogo/unidades')).status).toBe(NO_AUTORIZADO);
    });
  });

  describe('GET /catalogo/items/:id — la ficha, P16-A2', () => {
    interface Grupo {
      readonly id: string;
      readonly nombre: string;
      readonly ivaTarifa: string | null;
    }

    interface Ficha {
      readonly id: string;
      readonly unidadDeUso: string;
      readonly rendimiento: string;
      readonly grupoId: string | null;
      readonly grupo: Grupo | null;
      readonly articulos: readonly { readonly id: string; readonly ivaTarifa: string }[];
    }

    function ficha(cookie: string, id: string) {
      return request(servidor())
        .get(`/catalogo/items/${id}`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie));
    }

    let itemConTodo = '';

    beforeAll(async () => {
      const grupo = await request(servidor())
        .post('/catalogo/grupos')
        .set('Cookie', cookieAdmin)
        .set('X-CSRF-Token', csrfDe(cookieAdmin))
        .send({ nombre: `Lácteos ${randomUUID().slice(0, 8)}`, ivaTarifa: '0' });
      expect(grupo.status).toBe(CREADO);

      const item = await crearItem(cookieAdmin, {
        nombre: `Leche ${randomUUID().slice(0, 8)}`,
        unidadDeUso: 'ml',
        rendimiento: '0.95',
        grupoId: (grupo.body as { id: string }).id,
      });
      expect(item.status).toBe(CREADO);
      itemConTodo = (item.body as { id: string }).id;

      const articulo = await crearArticulo(cookieAdmin, {
        itemId: itemConTodo,
        nombre: `Leche entera 1lt ${randomUUID().slice(0, 8)}`,
        presentacion: '1',
        unidadDePresentacion: 'lt',
        ivaTarifa: '0',
      });
      expect(articulo.status).toBe(CREADO);
    });

    it('trae el ítem, su grupo con la tarifa, y sus artículos', async () => {
      const respuesta = await ficha(cookieAdmin, itemConTodo);

      expect(respuesta.status).toBe(OK);
      const cuerpo = respuesta.body as Ficha;
      expect(cuerpo.id).toBe(itemConTodo);
      expect(cuerpo.unidadDeUso).toBe('ml');
      expect(cuerpo.rendimiento).toMatch(/^0\.95/u);
      expect(cuerpo.grupo?.ivaTarifa).toMatch(/^0(\.0+)?$/u);
      expect(cuerpo.grupo?.id).toBe(cuerpo.grupoId);
      expect(cuerpo.articulos).toHaveLength(1);
      expect(cuerpo.articulos[0]?.ivaTarifa).toMatch(/^0(\.0+)?$/u);
    });

    it('un ítem sin grupo trae `grupo: null` y sin artículos, la lista vacía', async () => {
      const suelto = await crearItem(cookieAdmin);
      const cuerpo = (await ficha(cookieAdmin, (suelto.body as { id: string }).id)).body as Ficha;

      expect(cuerpo.grupo).toBeNull();
      expect(cuerpo.articulos).toEqual([]);
    });

    /**
     * IDOR: el id existe, pero es de otra company. Tiene que ser
     * indistinguible de uno inventado — si no, el endpoint dice qué ítems
     * tiene el vecino.
     */
    it('el ítem de OTRA company es 404, palabra por palabra igual que uno inventado', async () => {
      const ajena = await entrar(otraAdmin);

      const ajeno = await ficha(ajena, itemConTodo);
      expect(ajeno.status).toBe(NO_ENCONTRADO);
      expect(ajeno.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });

      const inventado = await ficha(cookieAdmin, randomUUID());
      expect(inventado.status).toBe(NO_ENCONTRADO);
      expect((ajeno.body as { message: string }).message).toBe(
        (inventado.body as { message: string }).message,
      );
    });

    it('un id que no es UUID es 400, no 500', async () => {
      const respuesta = await ficha(cookieAdmin, 'no-soy-uuid');

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    /**
     * §4.3 SOBRE EL CUERPO CRUDO, Y MIDIENDO (INC-007). Lo que fija la prueba
     * son las claves EXACTAS de los tres niveles de la ficha —el ítem, su
     * grupo y cada artículo—, de modo que un campo nuevo la rompe aunque su
     * nombre no se parezca a ninguno de los prohibidos; y que el cuerpo de
     * `BODEGA` sea IDÉNTICO al de `ADMIN`, porque «la proyección se rompió y
     * devuelve de menos» también es un fallo y una lista de ausencias no lo ve.
     */
    it('§4.3 — BODEGA recibe exactamente las claves publicadas, y las mismas que ADMIN', async () => {
      const cookie = await entrar(bodega);

      const respuesta = await ficha(cookie, itemConTodo);
      expect(respuesta.status).toBe(OK);

      const cuerpo = respuesta.body as Ficha;
      expect(claves(cuerpo)).toEqual(CLAVES_DE_FICHA_DE_ITEM);
      expect(claves(cuerpo.grupo)).toEqual(CLAVES_DE_GRUPO);
      expect(cuerpo.articulos.map(claves)).toEqual([CLAVES_DE_ARTICULO]);

      const deAdmin = await ficha(cookieAdmin, itemConTodo);
      expect(respuesta.body).toEqual(deAdmin.body);

      const crudo = JSON.stringify(respuesta.body);
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido);
      }
    });
  });

  describe('GET /catalogo/articulos/:id — la ficha, P16-A2', () => {
    interface FichaDeArticulo {
      readonly id: string;
      readonly ivaTarifa: string;
      readonly item: { readonly id: string; readonly nombre: string; readonly unidadDeUso: string };
    }

    function ficha(cookie: string, id: string) {
      return request(servidor())
        .get(`/catalogo/articulos/${id}`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfDe(cookie));
    }

    let articulo = '';
    let item = '';

    beforeAll(async () => {
      const creado = await crearItem(cookieAdmin, { unidadDeUso: 'g' });
      item = (creado.body as { id: string }).id;

      const alta = await crearArticulo(cookieAdmin, {
        itemId: item,
        nombre: `Harina Ya 2kg ${randomUUID().slice(0, 8)}`,
        presentacion: '2',
        unidadDePresentacion: 'kg',
        ivaTarifa: '0.15',
      });
      expect(alta.status).toBe(CREADO);
      articulo = (alta.body as { id: string }).id;
    });

    it('trae el artículo con su tarifa y su ítem dentro', async () => {
      const respuesta = await ficha(cookieAdmin, articulo);

      expect(respuesta.status).toBe(OK);
      const cuerpo = respuesta.body as FichaDeArticulo;
      expect(cuerpo.id).toBe(articulo);
      expect(cuerpo.ivaTarifa).toMatch(/^0\.15/u);
      expect(cuerpo.item.id).toBe(item);
      expect(cuerpo.item.unidadDeUso).toBe('g');
    });

    it('el artículo de OTRA company es 404, no 403', async () => {
      const ajena = await entrar(otraAdmin);

      const respuesta = await ficha(ajena, articulo);
      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect(respuesta.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
    });

    /** Misma medida que en la ficha del ítem: claves exactas y cuerpo igual al de ADMIN. */
    it('§4.3 — BODEGA recibe exactamente las claves publicadas, y las mismas que ADMIN', async () => {
      const cookie = await entrar(bodega);

      const respuesta = await ficha(cookie, articulo);
      expect(respuesta.status).toBe(OK);

      const cuerpo = respuesta.body as FichaDeArticulo;
      expect(claves(cuerpo)).toEqual(CLAVES_DE_FICHA_DE_ARTICULO);
      expect(claves(cuerpo.item)).toEqual(CLAVES_DE_ITEM);

      const deAdmin = await ficha(cookieAdmin, articulo);
      expect(respuesta.body).toEqual(deAdmin.body);

      const crudo = JSON.stringify(respuesta.body);
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido);
      }
    });
  });

  describe('la unidad tiene que EXISTIR, no solo estar bien escrita — INC-012', () => {
    it('«l» está bien formado y no existe: 400 con la lista de válidas', async () => {
      const respuesta = await crearItem(cookieAdmin, { unidadDeUso: 'l' });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      expect((respuesta.body as { message: string }).message).toContain(
        'Las válidas son: doc, g, gal, kg, lb, lt, mg, ml, oz, unid.',
      );
    });

    it('«KG» ni siquiera pasa la FORMA, y también es 400', async () => {
      const respuesta = await crearItem(cookieAdmin, { unidadDeUso: 'KG' });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('y la que existe sigue pasando: la guarda no cierra la puerta buena', async () => {
      expect((await crearItem(cookieAdmin, { unidadDeUso: 'lt' })).status).toBe(CREADO);
    });
  });

  describe('P2002 → 409, no 500 — P16-A2', () => {
    it('renombrar un ítem a un nombre ya usado es 409, no un 500 del índice único', async () => {
      const ocupado = `Ocupado ${randomUUID().slice(0, 8)}`;
      expect((await crearItem(cookieAdmin, { nombre: ocupado })).status).toBe(CREADO);

      const otro = await crearItem(cookieAdmin);

      const respuesta = await request(servidor())
        .put(`/catalogo/items/${(otro.body as { id: string }).id}`)
        .set('Cookie', cookieAdmin)
        .set('X-CSRF-Token', csrfDe(cookieAdmin))
        .send({
          nombre: ocupado,
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          estado: 'ACTIVE',
          llevaStock: null,
        });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(respuesta.body).toMatchObject({ code: 'CONFLICTO' });
      expect((respuesta.body as { message: string }).message).toContain('Ya existe un ítem');
    });

    /**
     * Y el nombre de OTRA company no estorba: el índice único es
     * `(company_id, name)`, no `(name)`. Sin esta prueba, «renombrar da 409»
     * pasaría también con un aislamiento roto.
     */
    it('un nombre que solo usa otra company NO da 409', async () => {
      const nombre = `Compartido ${randomUUID().slice(0, 8)}`;
      const ajena = await entrar(otraAdmin);
      expect((await crearItem(ajena, { nombre })).status).toBe(CREADO);

      expect((await crearItem(cookieAdmin, { nombre })).status).toBe(CREADO);
    });

    it('renombrar un artículo a uno ya usado sigue siendo 409 (P16-A1)', async () => {
      const dueño = (await crearItem(cookieAdmin)).body as { id: string };
      const ocupado = `Articulo ocupado ${randomUUID().slice(0, 8)}`;

      const primero = await crearArticulo(cookieAdmin, {
        itemId: dueño.id,
        nombre: ocupado,
        presentacion: '1',
        unidadDePresentacion: 'g',
      });
      expect(primero.status).toBe(CREADO);

      const otro = await crearArticulo(cookieAdmin, {
        itemId: dueño.id,
        nombre: `Articulo libre ${randomUUID().slice(0, 8)}`,
        presentacion: '1',
        unidadDePresentacion: 'g',
      });

      const respuesta = await request(servidor())
        .put(`/catalogo/articulos/${(otro.body as { id: string }).id}`)
        .set('Cookie', cookieAdmin)
        .set('X-CSRF-Token', csrfDe(cookieAdmin))
        .send({
          nombre: ocupado,
          marca: null,
          proveedor: null,
          ivaTarifa: '0.15',
          estado: 'ACTIVE',
        });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(respuesta.body).toMatchObject({ code: 'CONFLICTO' });
    });
  });
});
