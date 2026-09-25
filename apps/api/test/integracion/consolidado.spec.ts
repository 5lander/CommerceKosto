/**
 * P9 — el consolidado de company y las comparativas entre ubicaciones.
 *
 * EL CRITERIO DE ACEPTACIÓN ES LITERAL: «el consolidado es exactamente la suma
 * de las ubicaciones, verificado por test». Así que no se comprueba contra
 * números escritos a mano, sino **contra las propias vistas por ubicación**:
 * se piden las dos y se exige que sumen lo que el consolidado dice. Si algún
 * día las dos formas de calcular se separan, esta prueba lo ve — que es
 * justamente lo que un número escrito a mano no haría.
 *
 * Y las dos que protegen lo que importa:
 *
 *   - **`GERENTE_LOCAL` recibe 403.** Ver la cadena entera es la escalada
 *     horizontal de §4.4, y el consolidado es la forma más cómoda de cometerla.
 *   - **Nada cruza companies (R1)**, ni siquiera aquí, que es el único endpoint
 *     del sistema que agrega a propósito por encima de la ubicación.
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
const PROHIBIDO = 403;

const CLAVE = 'siete limones verdes';
const VIGENCIA = '2026-01-01T00:00:00.000Z';
const EN_MARZO = '2026-03-15T12:00:00.000Z';
const ANIO = 2026;
const MARZO = 3;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Record<string, unknown>;

interface ConsolidadoDto {
  readonly ubicaciones: readonly {
    readonly locationId: string;
    readonly nombre: string;
    readonly estadoDelPeriodo: string;
    readonly ventaNeta: string;
    readonly consumoTeorico: string;
  }[];
  readonly sinDatos: readonly { readonly nombre: string }[];
  readonly cerradas: number;
  readonly abiertas: number;
  readonly totales: {
    readonly unidades: string;
    readonly ventaNeta: string;
    readonly mcTotal: string;
    readonly consumoTeorico: string;
    readonly comprasDelMes: string;
  };
  readonly foodCostTeoricoPct: string | null;
  readonly margenPct: string | null;
}

/** Lo que la ubicación publica por su cuenta: es contra esto que se suma. */
interface PorUbicacion {
  readonly ventaNeta: string;
  readonly consumoTeorico: string;
}

interface ComparativaDeProductoDto {
  readonly productId: string;
  readonly activoEn: number;
  readonly pvpMinimo: string | null;
  readonly pvpMaximo: string | null;
  readonly brechaDePvp: string | null;
}

interface ComparativaDeCompraDto {
  readonly itemId: string;
  readonly pagos: readonly { readonly precioUnitario: string | null }[];
  readonly precioMinimo: string | null;
  readonly precioMaximo: string | null;
  readonly brechaPct: string | null;
}

describe('consolidado de company', () => {
  let app: INestApplication;
  let duena: Client;
  let admin: string;
  let gerente: string;
  let duenaDelNegocio: string;
  let centro: string;
  let norte: string;
  let vacio: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CLAVE });
    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  async function crear(ruta: string, cuerpo: Cuerpo): Promise<string> {
    const respuesta = await request(servidor()).post(ruta).set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin)).send(cuerpo);
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  /** Un ítem comprado con artículo y precio confirmado. */
  async function insumo(precio: string): Promise<{ itemId: string; articuloId: string }> {
    const itemId = await crear('/catalogo/items', {
      nombre: `Insumo ${randomUUID().slice(0, 8)}`,
      tipo: 'COMPRADO',
      unidadDeUso: 'kg',
      rendimiento: '1',
      grupoId: null,
      confianzaDePrecio: 'FACTURA',
      llevaStock: null,
    });

    const articuloId = await crear('/catalogo/articulos', {
      itemId,
      nombre: `Presentacion ${randomUUID().slice(0, 8)}`,
      marca: null,
      proveedor: null,
      presentacion: '1',
      unidadDePresentacion: 'kg',
      factorExplicito: null,
      ivaTarifa: '0',
    });

    const precioId = await crear('/precios', {
      itemId,
      purchaseArticleId: articuloId,
      precio,
      ivaCompra: '0',
      validFrom: VIGENCIA,
      origen: 'MANUAL',
      nota: null,
    });
    const decision = await request(servidor())
      .post(`/precios/${precioId}/decision`)
      .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
      .send({ decision: 'CONFIRMED' });
    expect(decision.status).toBe(SIN_CONTENIDO);

    return { itemId, articuloId };
  }

  /** El mismo producto activado en una ubicación, con su PVP y su receta. */
  async function activar(datos: {
    readonly productId: string;
    readonly itemId: string;
    readonly donde: string;
    readonly pvp: string;
  }): Promise<void> {
    // La versión se LEE: el mismo producto se activa en dos ubicaciones, y la
    // segunda escritura va sobre la versión que dejó la primera (D-16.100).
    const ficha = await request(servidor()).get(`/productos/${datos.productId}`).set('Cookie', admin);
    const version = (ficha.body as { version: number }).version;

    const ubicacion = await request(servidor())
      .put(`/productos/${datos.productId}/ubicaciones`)
      .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
      .send({
        locationId: datos.donde,
        activo: true,
        pvp: datos.pvp,
        rendimientoPorciones: '1',
        version,
      });
    expect(ubicacion.status).toBe(OK);

    const receta = await request(servidor())
      .put('/recetas')
      .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
      .send({
        // La receta es por ubicación: en cada una es la primera (D-16.101).
        basadaEn: null,
        destino: { clase: 'producto', productId: datos.productId },
        locationId: datos.donde,
        validFrom: VIGENCIA,
        nota: null,
        lineas: [{ itemId: datos.itemId, cantidad: '1', base: 'AP', estado: 'ACTIVA' }],
      });
    expect(receta.status).toBe(CREADO);
  }

  async function cargarVentas(donde: string, ventas: readonly Cuerpo[]): Promise<void> {
    // La carga va sobre la versión leída (D-16.121).
    const leida = await request(servidor())
      .get('/analitica/ventas')
      .query({ locationId: donde, anio: ANIO, mes: MARZO })
      .set('Cookie', admin);
    const version = (leida.body as { version: number }).version;

    const respuesta = await request(servidor())
      .post('/analitica/ventas')
      .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
      .send({ locationId: donde, anio: ANIO, mes: MARZO, version, ventas });
    expect(respuesta.status).toBe(OK);
  }

  async function comprar(datos: {
    readonly donde: string;
    readonly itemId: string;
    readonly articuloId: string;
    readonly cantidad: string;
    readonly importe: string;
  }): Promise<void> {
    const respuesta = await request(servidor())
      .post('/inventario/movimientos')
      .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
      .send({
        locationId: datos.donde,
        itemId: datos.itemId,
        tipo: 'COMPRA',
        cantidad: datos.cantidad,
        costoTotal: datos.importe,
        purchaseArticleId: datos.articuloId,
        occurredAt: EN_MARZO,
        note: null,
      });
    expect(respuesta.status).toBe(CREADO);
  }

  function consolidado(quien = admin, ruta = '') {
    return request(servidor())
      .get(`/consolidado${ruta}`)
      .query({ anio: ANIO, mes: MARZO })
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien));
  }

  /**
   * Las dos cifras que el consolidado suma, pedidas a las vistas de P8.
   *
   * Vienen de DOS endpoints porque cada uno publica la suya: la venta neta del
   * mes vive en el punto de equilibrio y el consumo teórico en el food cost
   * real. Se piden donde están en vez de añadirlas a un DTO para comodidad de
   * una prueba — que sería cambiar el sistema para que el test sea más corto.
   */
  async function porUbicacion(donde: string): Promise<PorUbicacion> {
    const consulta = { locationId: donde, anio: ANIO, mes: MARZO };
    const [equilibrio, foodCost] = await Promise.all([
      request(servidor())
        .get('/analitica/punto-de-equilibrio')
        .query(consulta)
        .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin)),
      request(servidor()).get('/analitica/food-cost-real').query(consulta).set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin)),
    ]);
    expect(equilibrio.status).toBe(OK);
    expect(foodCost.status).toBe(OK);

    return {
      ventaNeta: (equilibrio.body as { ventaNeta: string }).ventaNeta,
      consumoTeorico: (foodCost.body as { consumoTeorico: string }).consumoTeorico,
    };
  }

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();
    // Escuchando ANTES de cualquier lote en paralelo: supertest abre el puerto
    // perezosamente y varios `Test` creados en el mismo tick lo intentan a la
    // vez, lo que produce un `read ECONNRESET` intermitente. Ver INC-034.
    await app.listen(0);

    const hash = await new Argon2Hasher().hash(CLAVE);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`cadena ${sufijo}`],
    );
    const company = rows[0]?.id ?? '';

    const ubicacion = async (nombre: string): Promise<string> => {
      const { rows: creadas } = await duena.query<{ id: string }>(
        `INSERT INTO location (company_id, name, type, status)
         VALUES ($1, $2, 'AMBOS', 'ACTIVE') RETURNING id`,
        [company, nombre],
      );
      return creadas[0]?.id ?? '';
    };
    centro = await ubicacion(`Centro ${sufijo}`);
    norte = await ubicacion(`Norte ${sufijo}`);
    // La tercera existe y no tiene NADA de marzo: es la que prueba que una
    // ubicación sin datos se aparta en vez de sumar cero.
    vacio = await ubicacion(`Sur recién abierto ${sufijo}`);

    const correos = {
      admin: `admin.${sufijo}@snacklab.ec`,
      gerente: `gerente.${sufijo}@snacklab.ec`,
      // Solo el OWNER reabre un mes (D6): lo necesita la prueba de P16-C.
      owner: `owner.${sufijo}@snacklab.ec`,
    };
    for (const correo of Object.values(correos)) {
      await duena.query(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'ACTIVE')`,
        [company, correo, hash],
      );
    }
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, correos.admin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'GERENTE_LOCAL', $2, true FROM app_user WHERE email = $3`,
      [company, centro, correos.gerente],
    );

    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'OWNER', false FROM app_user WHERE email = $2`,
      [company, correos.owner],
    );

    admin = await entrar(correos.admin);
    gerente = await entrar(correos.gerente);
    duenaDelNegocio = await entrar(correos.owner);

    // EL MISMO producto en las dos ubicaciones, con PVP distinto a propósito:
    // es lo que la comparativa existe para enseñar.
    const { itemId, articuloId } = await insumo('2.00');
    const productId = await crear('/productos', {
      nombre: `Ceviche ${sufijo}`,
      tipo: 'SIMPLE',
      categoria: null,
    });
    await activar({ productId, itemId, donde: centro, pvp: '10.00' });
    await activar({ productId, itemId, donde: norte, pvp: '13.80' });

    await cargarVentas(centro, [{ productId, unidades: '100' }]);
    await cargarVentas(norte, [{ productId, unidades: '40' }]);

    // Las dos compran el mismo insumo al mismo proveedor y a precio distinto:
    // 1,20/kg el Centro y 1,68/kg el Norte.
    await comprar({ donde: centro, itemId, articuloId, cantidad: '100', importe: '120.00' });
    await comprar({ donde: norte, itemId, articuloId, cantidad: '100', importe: '168.00' });
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('EL CRITERIO: el consolidado es exactamente la suma de las ubicaciones', () => {
    it('la venta neta y el consumo teórico cuadran con las vistas por ubicación', async () => {
      const respuesta = await consolidado();
      expect(respuesta.status).toBe(OK);
      const total = respuesta.body as ConsolidadoDto;

      const [enCentro, enNorte] = await Promise.all([porUbicacion(centro), porUbicacion(norte)]);

      const suma = (a: string, b: string): string =>
        (Number.parseFloat(a) + Number.parseFloat(b)).toFixed(6);

      expect(Number.parseFloat(total.totales.ventaNeta).toFixed(6)).toBe(
        suma(enCentro.ventaNeta, enNorte.ventaNeta),
      );
      expect(Number.parseFloat(total.totales.consumoTeorico).toFixed(6)).toBe(
        suma(enCentro.consumoTeorico, enNorte.consumoTeorico),
      );
    });

    it('las unidades y las compras suman lo sembrado, sin inventar nada', async () => {
      const total = (await consolidado()).body as ConsolidadoDto;

      expect(total.totales.unidades).toBe('140');
      expect(total.totales.comprasDelMes).toBe('288');
    });

    it('el food cost consolidado sale de los totales, no del promedio de locales', async () => {
      const total = (await consolidado()).body as ConsolidadoDto;
      const [enCentro, enNorte] = await Promise.all([porUbicacion(centro), porUbicacion(norte)]);

      const esperado =
        (Number.parseFloat(enCentro.consumoTeorico) + Number.parseFloat(enNorte.consumoTeorico)) /
        (Number.parseFloat(enCentro.ventaNeta) + Number.parseFloat(enNorte.ventaNeta));

      expect(Number.parseFloat(total.foodCostTeoricoPct ?? '0')).toBeCloseTo(esperado, 8);
    });

    it('una ubicación sin datos del mes se aparta y se nombra: NO suma cero', async () => {
      const total = (await consolidado()).body as ConsolidadoDto;

      expect(total.ubicaciones).toHaveLength(2);
      expect(total.sinDatos.some((u) => u.nombre.startsWith('Sur recién abierto'))).toBe(true);
      expect(total.ubicaciones.some((u) => u.locationId === vacio)).toBe(false);
    });

    it('dice el estado del período de cada ubicación (ADR-010 §1)', async () => {
      const total = (await consolidado()).body as ConsolidadoDto;

      expect(total.abiertas + total.cerradas).toBe(total.ubicaciones.length);
      for (const ubicacion of total.ubicaciones) {
        expect(['ABIERTO', 'CERRADO']).toContain(ubicacion.estadoDelPeriodo);
      }
    });
  });

  describe('LA ESCALADA HORIZONTAL: un GERENTE_LOCAL no ve la cadena', () => {
    it('el consolidado le devuelve 403', async () => {
      const respuesta = await consolidado(gerente);

      expect(respuesta.status).toBe(PROHIBIDO);
      // EL CODIGO, NO SOLO EL ESTADO: desde P16-A2 hay dos 403 distintos, y sin
      // esta linea un fallo de CSRF pasaria por una prueba de permisos.
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('la comparativa de productos también', async () => {
      const respuesta = await consolidado(gerente, '/productos');

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('y la de compras, que es la que enseña lo que paga cada local', async () => {
      const respuesta = await consolidado(gerente, '/compras');

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('pero SÍ sigue viendo la vista de SU ubicación', async () => {
      const respuesta = await request(servidor())
        .get('/analitica/food-cost-real')
        .query({ locationId: centro, anio: ANIO, mes: MARZO })
        .set('Cookie', gerente).set('X-CSRF-Token', csrfDe(gerente));

      expect(respuesta.status).toBe(OK);
    });
  });

  describe('comparativa del mismo producto entre ubicaciones', () => {
    it('enseña la brecha de PVP entre los dos locales', async () => {
      const respuesta = await consolidado(admin, '/productos');
      expect(respuesta.status).toBe(OK);

      const filas = respuesta.body as readonly ComparativaDeProductoDto[];
      const fila = filas.find((f) => f.activoEn === 2);

      expect(fila).toBeDefined();
      expect(fila?.pvpMinimo).toBe('10');
      expect(fila?.pvpMaximo).toBe('13.8');
      expect(fila?.brechaDePvp).toBe('3.8');
    });
  });

  describe('comparativa de precios de compra — sale del LIBRO, no de reference_price', () => {
    it('el precio unitario es lo pagado dividido por lo recibido, por ubicación', async () => {
      const respuesta = await consolidado(admin, '/compras');
      expect(respuesta.status).toBe(OK);

      const filas = respuesta.body as readonly ComparativaDeCompraDto[];
      const fila = filas.find((f) => f.pagos.length === 2);

      expect(fila).toBeDefined();
      expect(fila?.precioMinimo).toBe('1.2');
      expect(fila?.precioMaximo).toBe('1.68');
      // 0,48 / 1,20 = 40 %: lo que el Norte se ahorraría comprando como el Centro.
      expect(fila?.brechaPct).toBe('0.4');
    });

    it('el precio de REFERENCIA es 2,00 y no aparece: lo comparado es la factura', async () => {
      const filas = (await consolidado(admin, '/compras'))
        .body as readonly ComparativaDeCompraDto[];
      const precios = filas.flatMap((f) => f.pagos.map((p) => p.precioUnitario));

      expect(precios).not.toContain('2');
    });
  });

  describe('R1 — ninguna agregación cruza companies', () => {
    it('el consolidado de una company no contiene ni una ubicación de otra', async () => {
      const { rows } = await duena.query<{ nombre: string }>(
        `SELECT l.name AS nombre FROM location l
          JOIN company c ON c.id = l.company_id
         WHERE c.id <> (SELECT company_id FROM location WHERE id = $1)
         LIMIT 20`,
        [centro],
      );

      const total = (await consolidado()).body as ConsolidadoDto;
      const mias = new Set([centro, norte, vacio]);

      for (const ubicacion of total.ubicaciones) {
        expect(mias.has(ubicacion.locationId)).toBe(true);
      }
      // Y por nombre, que es lo que un humano vería filtrado mal.
      const ajenas = new Set(rows.map((f) => f.nombre));
      for (const ubicacion of total.ubicaciones) {
        expect(ajenas.has(ubicacion.nombre)).toBe(false);
      }
    });
  });

  /**
   * VA LA ÚLTIMA A PROPÓSITO: confirmar un conteo en el Centro cambia su consumo
   * real y su inventario final, que las pruebas de arriba comparan con lo sembrado.
   */
  describe('🔴 el estado de cada ubicación sale del período, no del conteo (P16-C, D-16.124)', () => {
    function mutar(ruta: string, quien: string, cuerpo: Cuerpo = {}) {
      return request(servidor()).post(ruta).set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien)).send(cuerpo);
    }

    function estadoDe(total: ConsolidadoDto, locationId: string): string | undefined {
      return total.ubicaciones.find((u) => u.locationId === locationId)?.estadoDelPeriodo;
    }

    it('cerrado con su conteo es CERRADO; reabierto CONSERVA el conteo y vuelve a ser ABIERTO', async () => {
      const countId = await crear('/conteos', { locationId: centro, anio: ANIO, mes: MARZO, note: null });
      expect((await mutar(`/conteos/${countId}/confirmacion`, admin)).status).toBe(SIN_CONTENIDO);
      expect((await mutar(`/conteos/${countId}/cierre-de-periodo`, admin)).status).toBe(SIN_CONTENIDO);

      const cerrado = (await consolidado()).body as ConsolidadoDto;
      expect(estadoDe(cerrado, centro)).toBe('CERRADO');
      expect(estadoDe(cerrado, norte)).toBe('ABIERTO');
      expect([cerrado.cerradas, cerrado.abiertas]).toEqual([1, 1]);

      const periodos = await request(servidor()).get('/periodos').query({ locationId: centro }).set('Cookie', admin);
      const marzo = (periodos.body as { id: string; anio: number; mes: number }[]).find((p) => p.anio === ANIO && p.mes === MARZO);
      const reabierto = await mutar(`/periodos/${marzo?.id ?? ''}/reapertura`, duenaDelNegocio, { motivo: 'Faltó una factura de marzo' });
      expect(reabierto.status).toBe(SIN_CONTENIDO);

      // El conteo sigue confirmado: es exactamente el caso que la regla vieja leía al revés.
      const { rows } = await duena.query<{ status: string }>('SELECT status FROM physical_count WHERE id = $1', [countId]);
      expect(rows[0]?.status).toBe('CONFIRMADO');

      const abierto = (await consolidado()).body as ConsolidadoDto;
      expect(estadoDe(abierto, centro)).toBe('ABIERTO');
      expect([abierto.cerradas, abierto.abiertas]).toEqual([0, 2]);
    });
  });
});
