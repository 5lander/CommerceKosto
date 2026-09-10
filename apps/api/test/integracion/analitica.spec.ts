/**
 * Las seis vistas de punta a punta — criterios de aceptación de P8.
 *
 *   R7     **la conciliación da exactamente 0 con un dataset completo**, y es
 *          una prueba que corre en cada build (CLAUDE.md §6)
 *   §15    un producto con índice de popularidad **exactamente 1** cae en el
 *          cuadrante correcto de forma determinista
 *   §17    la mano de obra se identifica por CLASIFICACIÓN, no por el texto
 *   §18    el stock teórico da **lo mismo** esté o no registrado el consumo
 *          por venta en el libro
 *   §4.3   `BODEGA` recibe 403 en las cinco vistas y solo ve el semáforo
 *
 * **LO QUE ESTA SUITE APORTA SOBRE LAS UNITARIAS.** El dominio ya prueba cada
 * fórmula con la base apagada y con números a mano. Lo que no se puede probar
 * ahí es que los datos que llegan a esas fórmulas sean los correctos: que el
 * consumo teórico salga de la misma receta que el libro descuenta, que las
 * ventas del mes sean las de ese mes, y que R7 —que es una identidad entre dos
 * caminos— siga cerrando cuando los dos caminos pasan por el sistema entero.
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
const CONFLICTO = 409;

const CLAVE = 'once naranjas dulces';
const VIGENCIA = '2026-01-01T00:00:00.000Z';
const EN_MARZO = '2026-03-15T12:00:00.000Z';
const ANIO = 2026;
const MARZO = 3;

/** Lo que jamás puede aparecer en una respuesta a `BODEGA` — §4.3. */
const PROHIBIDOS_PARA_BODEGA = ['teorico', 'consumo', 'costo', 'valor', 'diferencia', 'cobertura'];

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

interface FoodCostDto {
  readonly consumoTeorico: string;
  readonly costoVentasTeorico: string;
  readonly costoVentasSegunCosteo: string;
  readonly diferenciaConciliacion: string;
  readonly foodCostRealPct: string | null;
}

interface MenuDto {
  readonly productos: readonly {
    readonly productId: string;
    readonly indicePopularidad: string | null;
    readonly cuadrante: string;
  }[];
  readonly mcPromedio: string | null;
}

interface InventarioDto {
  readonly items: readonly {
    readonly itemId: string;
    readonly stockTeorico: string;
    readonly consumoTeorico: string;
    readonly estado: string;
  }[];
}

describe('vistas analiticas', () => {
  let app: INestApplication;
  let duena: Client;
  let admin: string;
  let bodeguero: string;
  let local: string;
  /**
   * Una ubicacion propia para menu engineering.
   *
   * `n_productos_activos` cuenta TODA la carta de la ubicacion, asi que los
   * productos que otras pruebas dejan activos moverian el indice. No es un
   * defecto del calculo: es que la popularidad se mide contra la carta que hay.
   */
  let soloMenu: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena: CLAVE });
    expect(respuesta.status).toBe(OK);
    return (respuesta.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  }

  async function crear(ruta: string, cuerpo: Cuerpo, quien = admin): Promise<string> {
    const respuesta = await request(servidor()).post(ruta).set('Cookie', quien).send(cuerpo);
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  /** Un ítem comprado con artículo y precio confirmado. Rendimiento 1. */
  async function insumo(precio: string): Promise<string> {
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
      .set('Cookie', admin)
      .send({ decision: 'CONFIRMED' });
    expect(decision.status).toBe(SIN_CONTENIDO);

    return itemId;
  }

  /** Un producto simple con su receta, su PVP y su rendimiento por lote. */
  async function producto(datos: {
    readonly itemId: string;
    readonly cantidad: string;
    readonly pvp: string;
    readonly rendimiento: string;
    readonly donde?: string;
  }): Promise<string> {
    const ubicacionId = datos.donde ?? local;
    const productId = await crear('/productos', {
      nombre: `Plato ${randomUUID().slice(0, 8)}`,
      tipo: 'SIMPLE',
      categoria: null,
    });

    const ubicacion = await request(servidor())
      .put(`/productos/${productId}/ubicaciones`)
      .set('Cookie', admin)
      .send({
        locationId: ubicacionId,
        activo: true,
        pvp: datos.pvp,
        rendimientoPorciones: datos.rendimiento,
      });
    expect(ubicacion.status).toBe(SIN_CONTENIDO);

    // `PUT` y no `POST`: guardar una receta CREA UNA VERSION nueva con su
    // vigencia, no edita la anterior (P4). El verbo lo dice.
    const receta = await request(servidor())
      .put('/recetas')
      .set('Cookie', admin)
      .send({
        destino: { clase: 'producto', productId },
        locationId: ubicacionId,
        validFrom: VIGENCIA,
        nota: null,
        lineas: [{ itemId: datos.itemId, cantidad: datos.cantidad, base: 'AP', estado: 'ACTIVA' }],
      });
    expect(receta.status).toBe(CREADO);

    return productId;
  }

  function cargarVentas(ventas: readonly Cuerpo[], quien = admin, donde = local) {
    return request(servidor())
      .post('/analitica/ventas')
      .set('Cookie', quien)
      .send({ locationId: donde, anio: ANIO, mes: MARZO, ventas });
  }

  function cargarCostos(costos: readonly Cuerpo[]) {
    return request(servidor())
      .post('/analitica/costos-fijos')
      .set('Cookie', admin)
      .send({ locationId: local, anio: ANIO, mes: MARZO, costos });
  }

  function vista(nombre: string, quien = admin, donde = local) {
    return request(servidor())
      .get(`/analitica/${nombre}`)
      .query({ locationId: donde, anio: ANIO, mes: MARZO })
      .set('Cookie', quien);
  }

  async function foodCost(): Promise<FoodCostDto> {
    const respuesta = await vista('food-cost-real');
    expect(respuesta.status).toBe(OK);
    return respuesta.body as FoodCostDto;
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

    const hash = await new Argon2Hasher().hash(CLAVE);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`analitica ${sufijo}`],
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
    local = await ubicacion('Local Centro');
    soloMenu = await ubicacion('Local del menu');

    const correos = {
      admin: `admin.${sufijo}@snacklab.ec`,
      bodega: `bodega.${sufijo}@snacklab.ec`,
    };
    for (const correo of Object.values(correos)) {
      await duena.query(
        `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`,
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
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, local, correos.bodega],
    );

    admin = await entrar(correos.admin);
    bodeguero = await entrar(correos.bodega);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  /**
   * R7 — EL CRITERIO DE ACEPTACIÓN DEL PAQUETE.
   *
   * Los números están elegidos para poder seguirlos a mano:
   *
   *   insumo a 2,00/kg, receta de 1 kg, rendimiento 1 porción
   *   costo_neto_lote   = 2,00      costo_por_porcion = 2,00
   *   costo_con_merma   = 2,04      (provisión de merma 2 %, D3)
   *   pvp 10,00 con IVA 15 %  ->  venta_neta = 8,695652173913
   *   mc                = 6,655652173913
   *
   *   Con 100 unidades:
   *     costo_ventas_v_costeo = 869,565... − 665,565... = 204
   *     costo_ventas_teorico  = 200 (consumo) + 0 (empaque) + 4 (provisión) = 204
   */
  describe('la conciliación R7 (SPEC §16)', () => {
    it('da EXACTAMENTE cero con un dataset completo', async () => {
      const item = await insumo('2.00');
      const plato = await producto({
        itemId: item,
        cantidad: '1',
        pvp: '10.00',
        rendimiento: '1',
      });
      expect((await cargarVentas([{ productId: plato, unidades: '100' }])).status).toBe(
        SIN_CONTENIDO,
      );

      const real = await foodCost();

      expect(real.consumoTeorico).toBe('200');
      expect(real.costoVentasTeorico).toBe('204');
      expect(real.costoVentasSegunCosteo).toBe('204');
      expect(real.diferenciaConciliacion).toBe('0.00');
    });

    /**
     * **EL CASO QUE DESTAPÓ UN FALLO DE P6.**
     *
     * La receta es del LOTE y la venta es de PORCIONES: vender 100 unidades de
     * un producto que rinde 2 consume **50** lotes, no 100. Antes de la
     * corrección, `explotarConsumo` multiplicaba por las unidades sin dividir, y
     * R7 daba 98,00 en vez de 0 — un consumo teórico del doble de lo real.
     *
     * Ninguna prueba de P6 lo vio porque todas usan rendimiento 1, que es el
     * único valor con el que la multiplicación y la división coinciden.
     */
    it('sigue dando cero con rendimiento por lote MAYOR QUE UNO', async () => {
      const item = await insumo('2.00');
      const plato = await producto({
        itemId: item,
        cantidad: '1',
        pvp: '10.00',
        rendimiento: '2',
      });
      await cargarVentas([{ productId: plato, unidades: '100' }]);

      const real = await foodCost();

      // 100 unidades / 2 porciones por lote = 50 lotes × 1 kg × 2,00 = 100.
      expect(real.consumoTeorico).toBe('100');
      // costo_por_porcion = 1,00; con merma 1,02; × 100 unidades = 102.
      expect(real.costoVentasSegunCosteo).toBe('102');
      expect(real.diferenciaConciliacion).toBe('0.00');
    });
  });

  describe('menu engineering (SPEC §15)', () => {
    /**
     * El criterio de aceptación: con tres productos activos y la regla en 0.70,
     * 210 unidades de 900 dan un índice de **1 exacto**.
     */
    it('un indice exactamente 1 cae en el cuadrante correcto', async () => {
      const item = await insumo('1.00');
      const comun = { pvp: '10.00', rendimiento: '1', donde: soloMenu };
      const caro = await producto({ itemId: item, cantidad: '1', ...comun });
      const uno = await producto({ itemId: item, cantidad: '5', ...comun });
      const dos = await producto({ itemId: item, cantidad: '5', ...comun });

      await cargarVentas(
        [
          { productId: caro, unidades: '210' },
          { productId: uno, unidades: '345' },
          { productId: dos, unidades: '345' },
        ],
        admin,
        soloMenu,
      );

      const respuesta = await vista('menu-engineering', admin, soloMenu);
      expect(respuesta.status).toBe(OK);

      const menu = respuesta.body as MenuDto;
      const suyo = menu.productos.find((p) => p.productId === caro);
      expect(suyo?.indicePopularidad).toBe('1');
      // Índice 1 (popular) y margen por encima del promedio -> ESTRELLA.
      expect(suyo?.cuadrante).toBe('ESTRELLA');
    });
  });

  describe('punto de equilibrio (SPEC §17)', () => {
    it('la mano de obra se identifica por CLASIFICACION, no por el texto', async () => {
      expect(
        (
          await cargarCostos([
            { concepto: 'Nomina del personal', clasificacion: 'MANO_DE_OBRA', importe: '3000.00' },
            { concepto: 'Arriendo', clasificacion: 'OTRO_FIJO', importe: '1200.00' },
            { concepto: 'Comision tarjeta', clasificacion: 'VARIABLE', importe: '0.03' },
          ])
        ).status,
      ).toBe(SIN_CONTENIDO);

      const respuesta = await vista('punto-de-equilibrio');
      expect(respuesta.status).toBe(OK);

      const equilibrio = respuesta.body as { manoDeObra: string; costosFijos: string };
      // «Nomina» no empieza por «Sueldos», y cuenta igual: el prefijo del Excel
      // habría dejado 3000 dólares fuera del prime cost sin avisar.
      expect(equilibrio.manoDeObra).toBe('3000');
      expect(equilibrio.costosFijos).toBe('4200');
    });

    it('un concepto repetido se rechaza con 400, no con un 500 del indice unico', async () => {
      const respuesta = await cargarCostos([
        { concepto: 'Arriendo', clasificacion: 'OTRO_FIJO', importe: '1200.00' },
        { concepto: ' arriendo ', clasificacion: 'OTRO_FIJO', importe: '900.00' },
      ]);

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as { message: string }).message).toContain('dos veces');
    });
  });

  /**
   * **EL INVARIANTE QUE HACE ROBUSTO EL STOCK TEÓRICO.**
   *
   * El Excel no tiene movimientos de consumo: lo calcula desde la receta. Este
   * sistema **sí puede tenerlos** (P6). Si los agregados del libro los sumaran
   * *y además* se restara el consumo teórico, el stock saldría corto por el
   * valor entero del consumo del mes.
   */
  describe('inventario valorizado (SPEC §18)', () => {
    it('el stock teorico NO cambia por registrar el consumo por venta en el libro', async () => {
      const item = await insumo('2.00');
      const plato = await producto({
        itemId: item,
        cantidad: '1',
        pvp: '10.00',
        rendimiento: '1',
      });
      await cargarVentas([{ productId: plato, unidades: '30' }]);

      const compra = await request(servidor())
        .post('/inventario/movimientos')
        .set('Cookie', admin)
        .send({
          locationId: local,
          itemId: item,
          tipo: 'COMPRA',
          cantidad: '100',
          costoTotal: '200.00',
          purchaseArticleId: null,
          ivaTarifa: '0',
          occurredAt: EN_MARZO,
          note: null,
        });
      expect(compra.status).toBe(CREADO);

      const antes = await filaDe(item);
      expect(antes?.stockTeorico).toBe('70');
      expect(antes?.consumoTeorico).toBe('30');

      // Ahora se registra el consumo en el libro, que es lo que P6 permite.
      const consumo = await request(servidor())
        .post('/inventario/consumos')
        .set('Cookie', admin)
        .send({
          locationId: local,
          ventas: [{ productId: plato, unidades: '30' }],
          occurredAt: EN_MARZO,
          note: null,
        });
      expect(consumo.status).toBe(CREADO);

      const despues = await filaDe(item);
      expect(despues?.stockTeorico).toBe('70');
    });

    async function filaDe(itemId: string): Promise<InventarioDto['items'][number] | undefined> {
      const respuesta = await vista('inventario');
      expect(respuesta.status).toBe(OK);
      return (respuesta.body as InventarioDto).items.find((fila) => fila.itemId === itemId);
    }
  });

  describe('confidencialidad frente a BODEGA (§4.3)', () => {
    it.each([
      'resumen',
      'menu-engineering',
      'food-cost-real',
      'punto-de-equilibrio',
      'inventario',
    ])('la vista %s le devuelve 403', async (nombre) => {
      expect((await vista(nombre, bodeguero)).status).toBe(PROHIBIDO);
    });

    it('tampoco carga ventas: la cifra del mes no es suya', async () => {
      expect((await cargarVentas([], bodeguero)).status).toBe(PROHIBIDO);
    });

    /**
     * Lo ÚNICO que recibe, y SPEC §4 lo dice con estas palabras: «un semáforo
     * REPONER/OK **sin la cantidad que lo origina**».
     */
    it('el semaforo de reposicion SI, y su respuesta cruda no lleva ninguna cantidad', async () => {
      const respuesta = await vista('reposicion', bodeguero);
      expect(respuesta.status).toBe(OK);

      const crudo = JSON.stringify(respuesta.body).toLowerCase();
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido);
      }
      // Y lo que sí lleva: el semáforo.
      expect(crudo).toContain('semaforo');
    });
  });

  describe('el mes cerrado no admite datos nuevos (D6)', () => {
    it('cargar ventas en un periodo cerrado se rechaza con 409', async () => {
      const countId = await crear('/conteos', {
        locationId: local,
        anio: ANIO,
        mes: 4,
        note: null,
      });
      expect(
        (
          await request(servidor())
            .post(`/conteos/${countId}/confirmacion`)
            .set('Cookie', admin)
            .send()
        ).status,
      ).toBe(SIN_CONTENIDO);
      expect(
        (
          await request(servidor())
            .post(`/conteos/${countId}/cierre-de-periodo`)
            .set('Cookie', admin)
            .send()
        ).status,
      ).toBe(SIN_CONTENIDO);

      const respuesta = await request(servidor())
        .post('/analitica/ventas')
        .set('Cookie', admin)
        .send({ locationId: local, anio: ANIO, mes: 4, ventas: [] });

      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('cerrado');
    });
  });
});
