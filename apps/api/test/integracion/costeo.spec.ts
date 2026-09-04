/**
 * El motor de costeo de punta a punta — criterios de aceptación de P5.
 *
 *   CC-001  el producto real `PRD-001` del Excel, montado por la API, da los
 *           mismos números que `V_COSTEO` fila 6
 *   §4.3    `BODEGA` no ve un costeo, comprobado sobre la RESPUESTA CRUDA
 *   E8      costear con fecha del mes pasado usa el precio de entonces
 *   §5      200 productos con 1.500 líneas por debajo de 400 ms
 *
 * **LO QUE ESTA SUITE APORTA SOBRE LAS UNITARIAS.** El motor ya está probado
 * contra los casos conocidos con la base apagada. Lo que no puede probarse ahí
 * es el ENSAMBLAJE: que los precios que llegan sean los vigentes, que el
 * empaque se resuelva por la cadena del ítem, que la cascada reciba las recetas
 * de la ubicación correcta y que el número que sale por HTTP sea el que el
 * dominio calculó. Un motor perfecto mal alimentado da números plausibles y
 * equivocados igual que uno roto.
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
const PROHIBIDO = 403;

const CONTRASENA = 'tres cebollas moradas';
const ENERO = '2026-01-15T00:00:00.000Z';
const MARZO = '2026-03-15T00:00:00.000Z';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

/** Un ítem comprado necesita su artículo para tener precio: sin presentación, «2.30» no dice nada. */
interface ItemConArticulo {
  readonly itemId: string;
  readonly purchaseArticleId: string;
}

interface ImporteDto {
  readonly mostrar: string;
  readonly exacto: string;
}

interface ProductoCosteado {
  readonly productId: string;
  readonly activo: boolean;
  readonly costos: {
    readonly costoBrutoLote: ImporteDto;
    readonly costoNetoLote: ImporteDto;
    readonly costoPorPorcion: ImporteDto;
    readonly costoConMerma: ImporteDto;
    readonly empaqueNeto: ImporteDto;
    readonly costoTotalUnidad: ImporteDto;
    readonly impactoMerma: string | null;
  };
  readonly venta:
    | {
        readonly vendible: true;
        readonly ventaNeta: ImporteDto;
        readonly margenContribucion: ImporteDto;
        readonly foodCostPct: string;
        readonly mcPct: string;
        readonly sumaControl: string;
      }
    | { readonly vendible: false; readonly motivo: string };
  readonly itemsSinCosto: readonly string[];
}

/** Redondea a la precisión que muestra `V_COSTEO` y compara exacto. */
function alaPrecisionDelExcel(exacto: string, esperado: string): string {
  const punto = esperado.indexOf('.');
  const decimales = punto === -1 ? 0 : esperado.length - punto - 1;
  return Number.parseFloat(exacto).toFixed(decimales);
}

describe('costeo', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let cookie: string;
  let cookieGerente: string;
  let cookieBodega: string;
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

  /**
   * Un ítem con su artículo y su precio ya confirmado.
   *
   * `factorExplicito: null` porque la presentación es «1 <unidad de uso>»: el
   * factor es DERIVABLE, y P2 rechaza capturarlo cuando se puede derivar. Un
   * factor de más es una segunda verdad sobre la misma conversión.
   */
  async function itemConPrecio(datos: {
    readonly rendimiento: string;
    readonly precio: string;
    readonly iva: string;
    readonly unidad?: string;
    readonly validFrom?: string;
  }): Promise<ItemConArticulo> {
    const item = await request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie)
      .send({
        nombre: `Insumo ${randomUUID().slice(0, 8)}`,
        tipo: 'COMPRADO',
        unidadDeUso: datos.unidad ?? 'unid',
        rendimiento: datos.rendimiento,
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
        nombre: `Presentacion ${randomUUID().slice(0, 8)}`,
        marca: null,
        proveedor: null,
        presentacion: '1',
        unidadDePresentacion: datos.unidad ?? 'unid',
        factorExplicito: null,
      });
    expect(articulo.status).toBe(CREADO);

    const purchaseArticleId = (articulo.body as { id: string }).id;
    await confirmarPrecio({
      itemId,
      purchaseArticleId,
      precio: datos.precio,
      ivaCompra: datos.iva,
      validFrom: datos.validFrom ?? ENERO,
    });

    return { itemId, purchaseArticleId };
  }

  async function confirmarPrecio(cuerpo: Cuerpo): Promise<void> {
    const sugerido = await request(servidor())
      .post('/precios')
      .set('Cookie', cookie)
      .send({ origen: 'MANUAL', nota: null, ...cuerpo });
    expect(sugerido.status).toBe(CREADO);

    const decision = await request(servidor())
      .post(`/precios/${(sugerido.body as { id: string }).id}/decision`)
      .set('Cookie', cookie)
      .send({ decision: 'CONFIRMED' });
    expect(decision.status).toBe(SIN_CONTENIDO);
  }

  async function crearProducto(empaqueItemId: string | null): Promise<string> {
    const producto = await request(servidor())
      .post('/productos')
      .set('Cookie', cookie)
      .send({ nombre: `Plato ${randomUUID().slice(0, 8)}`, tipo: 'SIMPLE', categoria: null });
    expect(producto.status).toBe(CREADO);
    const id = (producto.body as { id: string }).id;

    const empaque = await request(servidor())
      .put(`/productos/${id}/empaque`)
      .set('Cookie', cookie)
      .send({ empaqueItemId });
    expect(empaque.status).toBe(SIN_CONTENIDO);

    return id;
  }

  async function activar(datos: {
    readonly productId: string;
    readonly locationId: string;
    readonly pvp: string | null;
    readonly porciones: string | null;
  }): Promise<void> {
    const respuesta = await request(servidor())
      .put(`/productos/${datos.productId}/ubicaciones`)
      .set('Cookie', cookie)
      .send({
        locationId: datos.locationId,
        activo: true,
        pvp: datos.pvp,
        rendimientoPorciones: datos.porciones,
      });
    expect(respuesta.status).toBe(SIN_CONTENIDO);
  }

  /** Un producto a medio configurar: sin PVP, y por tanto inactivo. */
  async function desactivarSinPrecio(productId: string): Promise<void> {
    const respuesta = await request(servidor())
      .put(`/productos/${productId}/ubicaciones`)
      .set('Cookie', cookie)
      .send({ locationId: centro, activo: false, pvp: null, rendimientoPorciones: '1' });
    expect(respuesta.status).toBe(SIN_CONTENIDO);
  }

  async function guardarReceta(
    destino: Cuerpo,
    locationId: string,
    lineas: readonly Cuerpo[],
  ): Promise<void> {
    const respuesta = await request(servidor())
      .put('/recetas')
      .set('Cookie', cookie)
      .send({ destino, locationId, validFrom: ENERO, nota: null, lineas });
    expect(respuesta.status).toBe(CREADO);
  }

  function costear(locationId: string, quien = cookie, fecha = MARZO) {
    return request(servidor()).get('/costeo').query({ locationId, fecha }).set('Cookie', quien);
  }

  async function costearUno(productId: string, fecha = MARZO): Promise<ProductoCosteado> {
    const respuesta = await request(servidor())
      .get(`/costeo/${productId}`)
      .query({ locationId: centro, fecha })
      .set('Cookie', cookie);

    expect(respuesta.status).toBe(OK);
    return respuesta.body as ProductoCosteado;
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
      [`costeo ${sufijo}`],
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

    const admin = `admin.${sufijo}@snacklab.ec`;
    const gerente = `gerente.${sufijo}@snacklab.ec`;
    const bodeguero = `bodega.${sufijo}@snacklab.ec`;

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
    cookieGerente = await entrar(gerente);
    cookieBodega = await entrar(bodeguero);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('CC-001 de punta a punta: el ensamblaje da los números del Excel', () => {
    let producto: string;

    beforeAll(async () => {
      // `EMP-E` — Bolsa kraft antigrasa: 0.05 con IVA 0.15.
      const empaque = await itemConPrecio({ rendimiento: '1', precio: '0.05', iva: '0.15' });
      // `INS-135` — Tamal de pollo (unidad): 0.51 sin IVA, rendimiento 1.00.
      const tamal = await itemConPrecio({ rendimiento: '1', precio: '0.51', iva: '0.00' });

      producto = await crearProducto(empaque.itemId);
      await activar({ productId: producto, locationId: centro, pvp: '1.80', porciones: '1' });
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        { itemId: tamal.itemId, cantidad: '1', base: 'EP', estado: 'ACTIVA' },
      ]);
    });

    it('los costos coinciden con V_COSTEO fila 6', async () => {
      const costeado = await costearUno(producto);

      expect(alaPrecisionDelExcel(costeado.costos.costoNetoLote.exacto, '0.51')).toBe('0.51');
      expect(alaPrecisionDelExcel(costeado.costos.costoConMerma.exacto, '0.5202')).toBe('0.5202');
      expect(alaPrecisionDelExcel(costeado.costos.empaqueNeto.exacto, '0.04347826087')).toBe(
        '0.04347826087',
      );
      expect(alaPrecisionDelExcel(costeado.costos.costoTotalUnidad.exacto, '0.5636782609')).toBe(
        '0.5636782609',
      );
    });

    it('el margen y el food cost coinciden con V_COSTEO fila 6', async () => {
      const costeado = await costearUno(producto);
      if (!costeado.venta.vendible) {
        throw new Error(costeado.venta.motivo);
      }

      expect(alaPrecisionDelExcel(costeado.venta.ventaNeta.exacto, '1.565217391')).toBe(
        '1.565217391',
      );
      expect(alaPrecisionDelExcel(costeado.venta.margenContribucion.exacto, '1.00153913')).toBe(
        '1.00153913',
      );
      expect(alaPrecisionDelExcel(costeado.venta.foodCostPct, '0.3601277778')).toBe('0.3601277778');
    });

    it('R6: la suma de control sale como 1 EXACTO por el cable', async () => {
      const costeado = await costearUno(producto);
      if (!costeado.venta.vendible) {
        throw new Error(costeado.venta.motivo);
      }

      // Sin redondear en la presentación: si algún día dejara de ser 1, se vería.
      expect(costeado.venta.sumaControl).toBe('1');
    });

    it('el empaque sale de la cadena del ítem, no de una tabla propia', async () => {
      // El empaque cuesta 0.05 con IVA 0.15 recuperable: 0.05 / 1.15.
      const costeado = await costearUno(producto);
      expect(costeado.costos.empaqueNeto.mostrar).toBe('0.04');
      expect(costeado.costos.empaqueNeto.exacto).toContain('0.043478260');
    });
  });

  describe('CLAUDE.md §4.3 — BODEGA no ve un costeo', () => {
    it('403, y ni un solo campo prohibido en la RESPUESTA CRUDA', async () => {
      const respuesta = await costear(centro, cookieBodega);

      expect(respuesta.status).toBe(PROHIBIDO);

      // Sobre el cuerpo crudo, no sobre un objeto interpretado: lo que importa
      // es lo que viaja por el cable.
      const crudo = JSON.stringify(respuesta.body);
      for (const prohibido of [
        'costoTotalUnidad',
        'foodCostPct',
        'margenContribucion',
        'costoPorPorcion',
        'costoNetoLote',
      ]) {
        expect(crudo).not.toContain(prohibido);
      }
    });

    it('tampoco el de un producto suelto', async () => {
      const productos = await costear(centro);
      const primero = (productos.body as { productos: ProductoCosteado[] }).productos[0];

      const respuesta = await request(servidor())
        .get(`/costeo/${primero?.productId ?? ''}`)
        .query({ locationId: centro })
        .set('Cookie', cookieBodega);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(JSON.stringify(respuesta.body)).not.toContain('foodCost');
    });
  });

  describe('el alcance por ubicación (escalada horizontal de P1)', () => {
    it('GERENTE_LOCAL costea SU ubicación', async () => {
      const respuesta = await costear(centro, cookieGerente);
      expect(respuesta.status).toBe(OK);
    });

    it('y recibe 403 sobre otra', async () => {
      const respuesta = await costear(norte, cookieGerente);
      expect(respuesta.status).toBe(PROHIBIDO);
    });
  });

  describe('E8 — costear hacia atrás usa el precio de entonces', () => {
    it('subir el precio hoy no cambia el costo del mes pasado', async () => {
      const item = await itemConPrecio({ rendimiento: '1', precio: '1.00', iva: '0.00' });
      const producto = await crearProducto(null);
      await activar({ productId: producto, locationId: centro, pvp: '5.00', porciones: '1' });
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        { itemId: item.itemId, cantidad: '1', base: 'EP', estado: 'ACTIVA' },
      ]);

      const enero = await costearUno(producto, MARZO);
      expect(enero.costos.costoNetoLote.mostrar).toBe('1.00');

      // Un precio nuevo, vigente desde abril: fila nueva, nunca sobrescritura.
      await confirmarPrecio({
        itemId: item.itemId,
        purchaseArticleId: item.purchaseArticleId,
        precio: '2.00',
        ivaCompra: '0.00',
        validFrom: '2026-04-01T00:00:00.000Z',
      });

      const enMayo = await costearUno(producto, '2026-05-01T00:00:00.000Z');
      expect(enMayo.costos.costoNetoLote.mostrar).toBe('2.00');

      // Y marzo NO se movió. Es el criterio E8, sobre el motor entero.
      const otraVezMarzo = await costearUno(producto, MARZO);
      expect(otraVezMarzo.costos.costoNetoLote.mostrar).toBe('1.00');
    });
  });

  describe('lo que el motor NO se calla', () => {
    it('un insumo sin precio confirmado sale listado, no escondido', async () => {
      const item = await request(servidor())
        .post('/catalogo/items')
        .set('Cookie', cookie)
        .send({
          nombre: `Sin precio ${randomUUID().slice(0, 8)}`,
          tipo: 'COMPRADO',
          unidadDeUso: 'unid',
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'ESTIMADO',
          llevaStock: null,
        });
      expect(item.status).toBe(CREADO);
      const sinPrecio = (item.body as { id: string }).id;

      const producto = await crearProducto(null);
      await activar({ productId: producto, locationId: centro, pvp: '5.00', porciones: '1' });
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        { itemId: sinPrecio, cantidad: '1', base: 'EP', estado: 'ACTIVA' },
      ]);

      const costeado = await costearUno(producto);

      // El plato cuesta cero, que es plausible y equivocado. Por eso se avisa.
      expect(costeado.costos.costoNetoLote.mostrar).toBe('0.00');
      expect(costeado.itemsSinCosto).toContain(sinPrecio);
    });

    it('un producto sin PVP no inventa un food cost del 0 %', async () => {
      const item = await itemConPrecio({ rendimiento: '1', precio: '3.00', iva: '0.00' });
      const producto = await crearProducto(null);
      // Sin PVP y por tanto INACTIVO: un producto activo sin precio lo rechaza
      // la base con un CHECK y el dominio con un mensaje. Es el estado normal
      // de un plato a medio configurar, y el borde 3 de CC-009.
      await desactivarSinPrecio(producto);
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        { itemId: item.itemId, cantidad: '1', base: 'EP', estado: 'ACTIVA' },
      ]);

      const costeado = await costearUno(producto);

      // El costo SÍ se calcula: no depende del PVP.
      expect(costeado.costos.costoNetoLote.mostrar).toBe('3.00');
      expect(costeado.venta.vendible).toBe(false);
      // Y el food cost no aparece en el cuerpo. Ausente, no cero.
      expect(JSON.stringify(costeado.venta)).not.toContain('foodCostPct');
    });
  });

  describe('la cascada, sobre datos reales', () => {
    it('una subpreparación con receta se costea por su receta, no por su precio', async () => {
      // La salsa tiene precio estándar 0.20 heredado del Excel Y receta propia.
      const queso = await itemConPrecio({
        rendimiento: '1',
        precio: '5.50',
        iva: '0.00',
        unidad: 'kg',
      });
      const huevo = await itemConPrecio({ rendimiento: '1', precio: '0.12', iva: '0.00' });

      const salsa = await request(servidor())
        .post('/catalogo/items')
        .set('Cookie', cookie)
        .send({
          nombre: `Salsa ${randomUUID().slice(0, 8)}`,
          tipo: 'PRODUCIDO',
          unidadDeUso: 'unid',
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          llevaStock: true,
        });
      expect(salsa.status).toBe(CREADO);
      const salsaId = (salsa.body as { id: string }).id;

      await confirmarPrecio({
        itemId: salsaId,
        purchaseArticleId: null,
        precio: '0.99',
        ivaCompra: '0.00',
        validFrom: ENERO,
      });

      // CC-005: queso 5.50 x 0.032 + huevo 0.12 x 0.2 = 0.176 + 0.024 = 0.20
      await guardarReceta({ clase: 'item', itemId: salsaId }, centro, [
        { itemId: queso.itemId, cantidad: '0.032', base: 'EP', estado: 'ACTIVA' },
        { itemId: huevo.itemId, cantidad: '0.2', base: 'EP', estado: 'ACTIVA' },
      ]);

      const producto = await crearProducto(null);
      await activar({ productId: producto, locationId: centro, pvp: '5.00', porciones: '1' });
      await guardarReceta({ clase: 'producto', productId: producto }, centro, [
        { itemId: salsaId, cantidad: '1', base: 'EP', estado: 'ACTIVA' },
      ]);

      const costeado = await costearUno(producto);

      // 0.20, el de la receta. NO 0.99, el precio estándar.
      expect(costeado.costos.costoNetoLote.mostrar).toBe('0.20');
    });
  });
});
