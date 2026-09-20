/**
 * El libro de inventario de punta a punta — criterios de aceptación de P6.
 *
 *   R3     no existe forma de editar ni borrar un movimiento; se corrige con
 *          uno de signo contrario
 *   R2     el saldo de una ubicación es independiente del de otra, y una
 *          transferencia deja el total de la company intacto
 *   R10    la preparación se da de alta al costo ESTÁNDAR y la varianza contra
 *          el costo real del lote queda registrada
 *   §4.3   `BODEGA` escribe el libro y NO puede leerlo, comprobado sobre la
 *          respuesta cruda
 *   P6-AC  reconstruir el saldo desde el libro da el mismo número que la
 *          proyección en SQL
 *
 * **LO QUE ESTA SUITE APORTA SOBRE LAS UNITARIAS.** El dominio ya está probado
 * con la base apagada: los signos, el par que suma cero, la varianza. Lo que no
 * se puede probar ahí es que la fila que llega a PostgreSQL sea la que el
 * dominio construyó, que RLS y los permisos dejen pasar a quien debe, y que el
 * `SUM` de la consulta coincida con el pliegue del dominio. Un libro perfecto
 * mal escrito da saldos plausibles y equivocados igual que uno roto.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { proyectarSaldos } from '../../src/modules/inventory/domain/saldo';
import type { TipoDeMovimiento } from '../../src/modules/inventory/domain/movimiento';
import {
  itemId as aItemId,
  locationId as aLocationId,
} from '../../src/shared/domain/identity/identificadores';
import { Quantity } from '../../src/shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../src/shared/domain/unidad/unidad-de-uso';
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
const ENERO = '2026-01-15T00:00:00.000Z';
const MARZO = '2026-03-15T00:00:00.000Z';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

interface SaldoDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly cantidad: string;
}

interface MovimientoDto {
  readonly id: string;
  readonly tipo: string;
  readonly cantidad: string;
  readonly costoTotal: string | null;
  readonly corrigeA: string | null;
  readonly corregidoPor: string | null;
}

/**
 * Los campos que NUNCA pueden aparecer en una respuesta a `BODEGA` — §4.3.
 *
 * Se buscan sobre el JSON crudo en texto, no sobre un objeto tipado: lo que
 * importa es que el byte no salga del backend, y un campo que la UI escondería
 * sigue viajando por el cable.
 */
const PROHIBIDOS_PARA_BODEGA = ['cantidad', 'saldo', 'costoTotal', 'consumo', 'stock'];

describe('inventario', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let cookieGerente: string;
  let cookieBodega: string;
  let bodegaCentral: string;
  let local: string;

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

  async function crearItem(datos: {
    readonly tipo: 'COMPRADO' | 'PRODUCIDO';
    readonly unidad: string;
    readonly llevaStock: boolean | null;
  }): Promise<string> {
    const respuesta = await request(servidor())
      .post('/catalogo/items')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({
        nombre: `Insumo ${randomUUID().slice(0, 8)}`,
        tipo: datos.tipo,
        unidadDeUso: datos.unidad,
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: datos.llevaStock,
      });
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  /** Un ítem comprado con artículo y precio confirmado, listo para costear. */
  async function itemConPrecio(precio: string, unidad = 'unid'): Promise<string> {
    const itemId = await crearItem({ tipo: 'COMPRADO', unidad, llevaStock: null });

    const articulo = await request(servidor())
      .post('/catalogo/articulos')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({
        itemId,
        nombre: `Presentacion ${randomUUID().slice(0, 8)}`,
        marca: null,
        proveedor: null,
        presentacion: '1',
        unidadDePresentacion: unidad,
        factorExplicito: null,
        ivaTarifa: '0',
      });
    expect(articulo.status).toBe(CREADO);

    await confirmarPrecio({
      itemId,
      purchaseArticleId: (articulo.body as { id: string }).id,
      precio,
      ivaCompra: '0',
      validFrom: ENERO,
    });
    return itemId;
  }

  /** Una preparación se costea con su precio de referencia: no tiene artículo. */
  async function preparacionConPrecio(datos: {
    readonly precio: string;
    readonly unidad: string;
    readonly llevaStock: boolean;
  }): Promise<string> {
    const itemId = await crearItem({
      tipo: 'PRODUCIDO',
      unidad: datos.unidad,
      llevaStock: datos.llevaStock,
    });
    await confirmarPrecio({
      itemId,
      purchaseArticleId: null,
      precio: datos.precio,
      ivaCompra: '0',
      validFrom: ENERO,
    });
    return itemId;
  }

  async function confirmarPrecio(cuerpo: Cuerpo): Promise<void> {
    const sugerido = await request(servidor())
      .post('/precios')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({ origen: 'MANUAL', nota: null, ...cuerpo });
    expect(sugerido.status).toBe(CREADO);

    const decision = await request(servidor())
      .post(`/precios/${(sugerido.body as { id: string }).id}/decision`)
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .send({ decision: 'CONFIRMED' });
    expect(decision.status).toBe(SIN_CONTENIDO);
  }

  /**
   * Una COMPRA de esta suite lleva tarifa CERO en el cuerpo: los ítems no
   * tienen grupo y la compra no trae artículo, así que sin ella sería 400
   * (D-16.9). Con cero, el neto ES el bruto y los saldos e importes que estas
   * pruebas esperan no cambian. La tarifa real se prueba en `iva-de-compra`.
   */
  function registrar(cuerpo: Cuerpo, quien = cookie) {
    return request(servidor())
      .post('/inventario/movimientos')
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien))
      .send({
        costoTotal: null,
        purchaseArticleId: null,
        ivaTarifa: cuerpo['tipo'] === 'COMPRA' ? '0' : null,
        note: null,
        occurredAt: MARZO,
        ...cuerpo,
      });
  }

  async function comprar(datos: {
    readonly itemId: string;
    readonly locationId: string;
    readonly cantidad: string;
    readonly costoTotal?: string;
  }): Promise<string> {
    const respuesta = await registrar({
      locationId: datos.locationId,
      itemId: datos.itemId,
      tipo: 'COMPRA',
      cantidad: datos.cantidad,
      costoTotal: datos.costoTotal ?? '10.00',
    });
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  async function saldos(locationId: string, quien = cookie): Promise<readonly SaldoDto[]> {
    const respuesta = await request(servidor())
      .get('/inventario/saldos')
      .query({ locationId })
      .set('Cookie', quien).set('X-CSRF-Token', csrfDe(quien));
    expect(respuesta.status).toBe(OK);
    return respuesta.body as readonly SaldoDto[];
  }

  async function saldoDe(locationId: string, itemId: string): Promise<string | null> {
    const todos = await saldos(locationId);
    return todos.find((saldo) => saldo.itemId === itemId)?.cantidad ?? null;
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

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`inventario ${sufijo}`],
    );
    const company = rows[0]?.id ?? '';

    // `company_settings` NO se inserta aquí: la crea la semilla de P3 al dar de
    // alta la company, con los valores de D3. Insertarla a mano choca contra su
    // propia clave primaria.

    const ubicacion = async (nombre: string, tipo: string): Promise<string> => {
      const { rows: creadas } = await duena.query<{ id: string }>(
        `INSERT INTO location (company_id, name, type, status)
         VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
        [company, nombre, tipo],
      );
      return creadas[0]?.id ?? '';
    };
    bodegaCentral = await ubicacion('Bodega central', 'BODEGA');
    local = await ubicacion('Local Centro', 'LOCAL');

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
      [company, local, gerente],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, bodegaCentral, bodeguero],
    );

    cookie = await entrar(admin);
    cookieGerente = await entrar(gerente);
    cookieBodega = await entrar(bodeguero);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('el signo lo pone el tipo, y la base lo sostiene', () => {
    it('una compra suma y una merma resta, capturando las dos en positivo', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '10' });

      const merma = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'MERMA',
        cantidad: '1.5',
      });
      expect(merma.status).toBe(CREADO);

      expect(await saldoDe(bodegaCentral, item)).toBe('8.500000000000');
    });

    it('una COMPRA en negativo se rechaza con 400 y no con un 500 del driver', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'COMPRA',
        cantidad: '-10',
        costoTotal: '20.00',
      });

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('entrada');
    });

    it('un AJUSTE sí admite signo: existe para mover el saldo donde haga falta', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '10' });

      const ajuste = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'AJUSTE',
        cantidad: '-2',
      });
      expect(ajuste.status).toBe(CREADO);
      expect(await saldoDe(bodegaCentral, item)).toBe('8.000000000000');
    });

    it('un movimiento de cero no es un hecho, y se rechaza', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'MERMA',
        cantidad: '0',
      });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    it('una fecha futura se rechaza: el libro registra lo que ya ocurrió', async () => {
      const item = await itemConPrecio('2.00');
      const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const respuesta = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'MERMA',
        cantidad: '1',
        occurredAt: manana,
      });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    it('🔴 un importe negativo es 400, no el 500 de inventory_movement_importe_no_negativo (INC-012, D-16.110)', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'COMPRA',
        cantidad: '5',
        costoTotal: '-5',
      });
      const merma = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'MERMA',
        cantidad: '1',
        costoTotal: '-5',
      });

      expect([compra.status, merma.status]).toEqual([ENTRADA_INVALIDA, ENTRADA_INVALIDA]);
      expect(compra.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      expect(merma.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('una compra sin importe se rechaza: de ahí sale `compras_del_mes`', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await registrar({
        locationId: bodegaCentral,
        itemId: item,
        tipo: 'COMPRA',
        cantidad: '5',
        costoTotal: null,
      });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });
  });

  describe('R3 — un error se corrige con un movimiento de signo contrario', () => {
    it('la corrección deja el saldo como estaba, sin borrar la fila original', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '10' });

      const correccion = await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: 'me equivoqué de bodega' });
      expect(correccion.status).toBe(CREADO);

      expect(await saldoDe(bodegaCentral, item)).toBe('0.000000000000');

      const libro = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodegaCentral, itemId: item })
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      const movimientos = (libro.body as { movimientos: MovimientoDto[] }).movimientos;

      // LAS DOS FILAS SIGUEN AHÍ. Es la diferencia entre corregir y borrar.
      expect(movimientos).toHaveLength(2);
      expect(movimientos.map((m) => m.tipo)).toEqual(['COMPRA', 'COMPRA']);
      expect(movimientos.map((m) => m.cantidad).sort()).toEqual([
        '-10.000000000000',
        '10.000000000000',
      ]);
    });

    it('la corrección CONSERVA el tipo, para que Σ(COMPRA) del mes se cancele sola', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '4' });

      await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      const { rows } = await duena.query<{ suma: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS suma FROM inventory_movement
         WHERE item_id = $1 AND type = 'COMPRA'`,
        [item],
      );
      expect(Number.parseFloat(rows[0]?.suma ?? '1')).toBe(0);
    });

    /**
     * **Y EL DINERO TAMBIÉN VUELVE — INC-029.**
     *
     * La prueba de arriba miraba la cantidad, que siempre estuvo bien porque
     * lleva signo. El importe NO lo lleva (ADR-009 §2), así que `SUM(total_cost)`
     * sumaba la compra y su corrección: `compras_del_mes` (SPEC §16) contaba el
     * dinero de una compra que se anuló, y de ahí sale el food cost real. Esto
     * pregunta por el número que el cierre usa —con el signo aplicado— y exige
     * que sea cero.
     */
    it('y su DINERO también se cancela: la compra corregida no cuenta en el mes', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({
        itemId: item,
        locationId: bodegaCentral,
        cantidad: '4',
        costoTotal: '46.00',
      });

      await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      const { rows } = await duena.query<{ neto: string }>(
        `SELECT COALESCE(SUM(sign(quantity) * total_cost), 0)::text AS neto
           FROM inventory_movement WHERE item_id = $1 AND type = 'COMPRA'`,
        [item],
      );
      expect(Number.parseFloat(rows[0]?.neto ?? '1')).toBe(0);
    });

    it('corregir dos veces el mismo movimiento devuelve 409, no un 500 del índice único', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '3' });

      const primera = await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });
      expect(primera.status).toBe(CREADO);

      const segunda = await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });
      expect(segunda.status).toBe(CONFLICTO);
    });

    it('corregir una corrección devuelve 409: encadenarlas es editar con otro nombre', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '3' });

      const primera = await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });

      const segunda = await request(servidor())
        .post(`/inventario/movimientos/${(primera.body as { id: string }).id}/correccion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ note: null });
      expect(segunda.status).toBe(CONFLICTO);
    });

    it('NO EXISTE una ruta para editar ni borrar un movimiento', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '1' });

      const editar = await request(servidor())
        .put(`/inventario/movimientos/${compra}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ cantidad: '999' });
      const borrar = await request(servidor())
        .delete(`/inventario/movimientos/${compra}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(editar.status).toBe(404);
      expect(borrar.status).toBe(404);
    });
  });

  describe('R2 — las ubicaciones no se mezclan, y una transferencia suma cero', () => {
    it('el total de la company no cambia, y los dos saldos sí', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '10' });

      const transferencia = await request(servidor())
        .post('/inventario/transferencias')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          origen: bodegaCentral,
          destino: local,
          itemId: item,
          cantidad: '4',
          occurredAt: MARZO,
          note: null,
        });
      expect(transferencia.status).toBe(CREADO);

      expect(await saldoDe(bodegaCentral, item)).toBe('6.000000000000');
      expect(await saldoDe(local, item)).toBe('4.000000000000');

      const { rows } = await duena.query<{ suma: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS suma FROM inventory_movement WHERE item_id = $1`,
        [item],
      );
      expect(Number.parseFloat(rows[0]?.suma ?? '-1')).toBe(10);
    });

    it('transferir a la misma ubicación se rechaza con 400', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await request(servidor())
        .post('/inventario/transferencias')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          origen: bodegaCentral,
          destino: bodegaCentral,
          itemId: item,
          cantidad: '1',
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    it('el saldo de una ubicación no arrastra nada de la otra', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '7' });

      expect(await saldoDe(bodegaCentral, item)).toBe('7.000000000000');
      expect(await saldoDe(local, item)).toBeNull();
    });
  });

  describe('el criterio de aceptación: reconstruir el libro da la misma proyección', () => {
    it('el SUM de la consulta y el pliegue del dominio coinciden hasta el último dígito', async () => {
      const item = await itemConPrecio('2.00', 'kg');
      await comprar({ itemId: item, locationId: local, cantidad: '12.345' });
      await registrar({
        locationId: local,
        itemId: item,
        tipo: 'MERMA',
        cantidad: '0.075',
      });
      await registrar({
        locationId: local,
        itemId: item,
        tipo: 'AJUSTE',
        cantidad: '-1.27',
      });

      // Los movimientos CRUDOS, leídos sin pasar por el repositorio: la prueba
      // no puede confiar en la misma capa que está verificando.
      const { rows } = await duena.query<{
        location_id: string;
        item_id: string;
        type: string;
        quantity: string;
      }>(
        `SELECT location_id, item_id, type, quantity::text
           FROM inventory_movement WHERE location_id = $1 AND item_id = $2`,
        [local, item],
      );

      const kg = unidadDeUso('kg');
      const reconstruido = proyectarSaldos(
        rows.map((fila) => ({
          locationId: aLocationId(fila.location_id),
          itemId: aItemId(fila.item_id),
          tipo: fila.type as TipoDeMovimiento,
          cantidad: Quantity.fromDatabase(fila.quantity, kg),
          ocurridoEn: new Date(),
        })),
      );

      const proyectado = await saldoDe(local, item);
      expect(reconstruido).toHaveLength(1);
      expect(reconstruido[0]?.cantidad.toStorageString()).toBe(proyectado);
      // 12,345 − 0,075 − 1,27
      expect(proyectado).toBe('11.000000000000');
    });
  });

  describe('R10 — la producción se valora al estándar y deja su varianza', () => {
    it('el alta lleva el costo estándar, y los insumos su costo real', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({
        precio: '0.20',
        unidad: 'lt',
        llevaStock: true,
      });
      await comprar({ itemId: cebolla, locationId: bodegaCentral, cantidad: '100' });

      const produccion = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: bodegaCentral,
          itemId: salsa,
          cantidad: '5',
          insumos: [{ itemId: cebolla, cantidad: '2' }],
          occurredAt: MARZO,
          note: null,
        });
      expect(produccion.status).toBe(CREADO);

      const { rows } = await duena.query<{
        standard_total: string;
        real_total: string;
      }>(
        `SELECT standard_total::text, real_total::text FROM inventory_production WHERE id = $1`,
        [(produccion.body as { id: string }).id],
      );

      // 5 lt × 0,20 estándar = 1,00 · 2 kg × 0,50 real = 1,00 → varianza 0
      expect(Number.parseFloat(rows[0]?.standard_total ?? '')).toBe(1);
      expect(Number.parseFloat(rows[0]?.real_total ?? '')).toBe(1);

      expect(await saldoDe(bodegaCentral, salsa)).toBe('5.000000000000');
      expect(await saldoDe(bodegaCentral, cebolla)).toBe('98.000000000000');
    });

    it('un lote más caro de lo previsto deja varianza positiva', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({
        precio: '0.20',
        unidad: 'lt',
        llevaStock: true,
      });
      await comprar({ itemId: cebolla, locationId: bodegaCentral, cantidad: '100' });

      const produccion = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: bodegaCentral,
          itemId: salsa,
          cantidad: '5',
          // 2,6 kg en vez de 2: se usó de más, y eso es lo que la varianza ve.
          insumos: [{ itemId: cebolla, cantidad: '2.6' }],
          occurredAt: MARZO,
          note: null,
        });
      expect(produccion.status).toBe(CREADO);

      const { rows } = await duena.query<{ standard_total: string; real_total: string }>(
        `SELECT standard_total::text, real_total::text FROM inventory_production WHERE id = $1`,
        [(produccion.body as { id: string }).id],
      );
      expect(Number.parseFloat(rows[0]?.real_total ?? '')).toBe(1.3);
      expect(Number.parseFloat(rows[0]?.standard_total ?? '')).toBe(1);
    });

    it('el alta al ESTÁNDAR se ve en el libro: 5 × 0,20, no el costo real', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({
        precio: '0.20',
        unidad: 'lt',
        llevaStock: true,
      });
      await comprar({ itemId: cebolla, locationId: bodegaCentral, cantidad: '100' });

      await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: bodegaCentral,
          itemId: salsa,
          cantidad: '5',
          insumos: [{ itemId: cebolla, cantidad: '2.6' }],
          occurredAt: MARZO,
          note: null,
        });

      const { rows } = await duena.query<{ total_cost: string }>(
        `SELECT total_cost::text FROM inventory_movement
          WHERE item_id = $1 AND type = 'PRODUCCION' AND quantity > 0`,
        [salsa],
      );
      expect(Number.parseFloat(rows[0]?.total_cost ?? '')).toBe(1);
    });

    it('un ítem COMPRADO no se produce: se compra', async () => {
      const comprado = await itemConPrecio('0.50', 'kg');
      const respuesta = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: bodegaCentral,
          itemId: comprado,
          cantidad: '5',
          insumos: [{ itemId: comprado, cantidad: '1' }],
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    it('una preparación SIN stock propio no se produce en lote', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({
        precio: '0.20',
        unidad: 'lt',
        llevaStock: false,
      });

      const respuesta = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: bodegaCentral,
          itemId: salsa,
          cantidad: '5',
          insumos: [{ itemId: cebolla, cantidad: '1' }],
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('interruptor');
    });
  });

  describe('§4.3 — BODEGA escribe el libro y no puede leerlo', () => {
    it('SÍ puede registrar una compra: es su trabajo', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await registrar(
        {
          locationId: bodegaCentral,
          itemId: item,
          tipo: 'COMPRA',
          cantidad: '5',
          costoTotal: '10.00',
        },
        cookieBodega,
      );
      expect(respuesta.status).toBe(CREADO);
    });

    it('la respuesta de esa escritura NO trae el saldo resultante', async () => {
      const item = await itemConPrecio('2.00');
      const respuesta = await registrar(
        {
          locationId: bodegaCentral,
          itemId: item,
          tipo: 'COMPRA',
          cantidad: '5',
          costoTotal: '10.00',
        },
        cookieBodega,
      );

      // Sobre el JSON CRUDO: lo que importa es el byte que sale del backend.
      const crudo = JSON.stringify(respuesta.body);
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido);
      }
      expect(Object.keys(respuesta.body as object)).toEqual(['id']);
    });

    it('NO puede leer los saldos: con ellos despejaría la receta', async () => {
      const respuesta = await request(servidor())
        .get('/inventario/saldos')
        .query({ locationId: bodegaCentral })
        .set('Cookie', cookieBodega).set('X-CSRF-Token', csrfDe(cookieBodega));
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('NO puede leer el libro de movimientos', async () => {
      const respuesta = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodegaCentral })
        .set('Cookie', cookieBodega).set('X-CSRF-Token', csrfDe(cookieBodega));
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('NO puede registrar producción: fija el costo estándar de una preparación', async () => {
      const respuesta = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', cookieBodega).set('X-CSRF-Token', csrfDe(cookieBodega))
        .send({
          locationId: bodegaCentral,
          itemId: randomUUID(),
          cantidad: '1',
          insumos: [{ itemId: randomUUID(), cantidad: '1' }],
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('el interruptor de stock decide hasta dónde baja el consumo de una venta', () => {
    /** Un producto con receta vigente en el local, listo para venderse. */
    async function productoConReceta(lineas: readonly Cuerpo[]): Promise<string> {
      const producto = await request(servidor())
        .post('/productos')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre: `Plato ${randomUUID().slice(0, 8)}`, tipo: 'SIMPLE', categoria: null });
      expect(producto.status).toBe(CREADO);
      const id = (producto.body as { id: string }).id;

      const activacion = await request(servidor())
        .put(`/productos/${id}/ubicaciones`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        // Recién creado: versión 1 (D-16.100).
        .send({ locationId: local, activo: true, pvp: '3.00', rendimientoPorciones: '1', version: 1 });
      expect(activacion.status).toBe(OK);

      const receta = await request(servidor())
        .put('/recetas')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          // Sin receta previa: la primera versión se basa en ninguna (D-16.101).
          basadaEn: null,
          destino: { clase: 'producto', productId: id },
          locationId: local,
          validFrom: ENERO,
          nota: null,
          lineas,
        });
      expect(receta.status).toBe(CREADO);
      return id;
    }

    async function recetaDeItem(itemId: string, lineas: readonly Cuerpo[]): Promise<void> {
      const receta = await request(servidor())
        .put('/recetas')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          basadaEn: null,
          destino: { clase: 'item', itemId },
          locationId: local,
          validFrom: ENERO,
          nota: null,
          lineas,
        });
      expect(receta.status).toBe(CREADO);
    }

    async function vender(productId: string, unidades: string): Promise<void> {
      const respuesta = await request(servidor())
        .post('/inventario/consumos')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          locationId: local,
          ventas: [{ productId, unidades }],
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(CREADO);
    }

    it('CON stock propio: se consume la preparación y NO se baja a sus insumos', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({ precio: '0.20', unidad: 'lt', llevaStock: true });
      await recetaDeItem(salsa, [
        { itemId: cebolla, cantidad: '0.3', base: 'AP', estado: 'ACTIVA' },
      ]);

      const plato = await productoConReceta([
        { itemId: salsa, cantidad: '2', base: 'AP', estado: 'ACTIVA' },
      ]);
      await vender(plato, '10');

      // 10 × 2 = 20 lt de salsa. La cebolla no se toca: ya se descontó cuando
      // se produjo el lote, y bajar aquí la descontaría dos veces.
      expect(await saldoDe(local, salsa)).toBe('-20.000000000000');
      expect(await saldoDe(local, cebolla)).toBeNull();
    });

    it('SIN stock propio: la preparación desaparece y aparecen sus insumos', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({ precio: '0.20', unidad: 'lt', llevaStock: false });
      await recetaDeItem(salsa, [
        { itemId: cebolla, cantidad: '0.3', base: 'AP', estado: 'ACTIVA' },
      ]);

      const plato = await productoConReceta([
        { itemId: salsa, cantidad: '2', base: 'AP', estado: 'ACTIVA' },
      ]);
      await vender(plato, '10');

      expect(await saldoDe(local, salsa)).toBeNull();
      // 10 × 2 × 0,3 = 6 kg de cebolla
      expect(await saldoDe(local, cebolla)).toBe('-6.000000000000');
    });

    it('el interruptor se puede cambiar, y cambia el consumo de las ventas siguientes', async () => {
      const cebolla = await itemConPrecio('0.50', 'kg');
      const salsa = await preparacionConPrecio({ precio: '0.20', unidad: 'lt', llevaStock: false });
      await recetaDeItem(salsa, [
        { itemId: cebolla, cantidad: '0.3', base: 'AP', estado: 'ACTIVA' },
      ]);
      const plato = await productoConReceta([
        { itemId: salsa, cantidad: '1', base: 'AP', estado: 'ACTIVA' },
      ]);

      await vender(plato, '10');
      expect(await saldoDe(local, cebolla)).toBe('-3.000000000000');

      const cambio = await request(servidor())
        .put(`/catalogo/items/${salsa}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          nombre: `Salsa ${randomUUID().slice(0, 8)}`,
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          estado: 'ACTIVE',
          llevaStock: true,
          // La receta no toca la versión del ítem: sigue en 1 (D-16.101).
          version: 1,
        });
      expect(cambio.status).toBe(OK);

      await vender(plato, '10');

      // LO YA REGISTRADO NO SE REESCRIBE: la cebolla se queda en −3, que es lo
      // que de verdad salió de la estantería. Lo que cambia es de aquí en
      // adelante.
      expect(await saldoDe(local, cebolla)).toBe('-3.000000000000');
      expect(await saldoDe(local, salsa)).toBe('-10.000000000000');
    });

    it('una línea INACTIVA no consume nada, igual que no cuesta nada', async () => {
      const harina = await itemConPrecio('1.00', 'kg');
      const azucar = await itemConPrecio('1.00', 'kg');
      const plato = await productoConReceta([
        { itemId: harina, cantidad: '2', base: 'AP', estado: 'ACTIVA' },
        { itemId: azucar, cantidad: '5', base: 'AP', estado: 'INACTIVA' },
      ]);

      await vender(plato, '3');

      expect(await saldoDe(local, harina)).toBe('-6.000000000000');
      expect(await saldoDe(local, azucar)).toBeNull();
    });
  });

  describe('lo que la base sostiene aunque la aplicación falle', () => {
    it('la clave foránea COMPUESTA impide declarar una dirección que no es la del tipo', async () => {
      const item = await itemConPrecio('2.00');
      const compra = await comprar({ itemId: item, locationId: local, cantidad: '1' });

      const { rows } = await duena.query<{ company_id: string; created_by: string }>(
        `SELECT company_id, created_by FROM inventory_movement WHERE id = $1`,
        [compra],
      );
      const fila = rows[0];
      if (fila === undefined) throw new Error('no se pudo leer el movimiento recién creado');

      // `COMPRA` es ENTRADA en el catálogo. Declararla SALIDA sería la forma de
      // colar una cantidad negativa saltándose el CHECK de signo — y es
      // exactamente lo que la FK `(type, direction)` hace imposible.
      await expect(
        duena.query(
          `INSERT INTO inventory_movement
             (company_id, location_id, item_id, type, direction, quantity, total_cost,
              occurred_at, created_by)
           VALUES ($1, $2, $3, 'COMPRA', 'SALIDA', -10, 1, now(), $4)`,
          [fila.company_id, local, item, fila.created_by],
        ),
      ).rejects.toMatchObject({ constraint: 'inventory_movement_type_direction_fkey' });
    });

    it('RLS impide que otra company vea un movimiento, aun conociendo su id', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: local, cantidad: '5' });

      const { rows } = await duena.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM inventory_movement WHERE item_id = $1`,
        [item],
      );
      expect(Number(rows[0]?.total ?? '0')).toBeGreaterThan(0);

      // La misma consulta desde la aplicación SIN tenant fijado: cero filas.
      const sinTenant = new Client({ connectionString: process.env['DATABASE_URL'] });
      await sinTenant.connect();
      try {
        const { rows: vistas } = await sinTenant.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM inventory_movement WHERE item_id = $1`,
          [item],
        );
        expect(vistas[0]?.total).toBe('0');
      } finally {
        await sinTenant.end();
      }
    });
  });

  describe('un movimiento por su id y el libro por tipo (P16-C, D-16.125)', () => {
    function leerMovimiento(id: string, quien = cookie) {
      return request(servidor()).get(`/inventario/movimientos/${id}`).set('Cookie', quien);
    }

    it('trae exactamente la fila que el libro ya enseñaba, con su desglose', async () => {
      const item = await itemConPrecio('2.00');
      const id = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '4' });

      const suelto = await leerMovimiento(id);
      const pagina = await request(servidor()).get('/inventario/movimientos').query({ locationId: bodegaCentral, itemId: item }).set('Cookie', cookie);

      expect(suelto.status).toBe(OK);
      const fila = (pagina.body as { movimientos: { id: string }[] }).movimientos.find((m) => m.id === id);
      expect(suelto.body).toEqual(fila);
      expect(suelto.body).toMatchObject({ tipo: 'COMPRA', desglose: 'CONOCIDO' });
    });

    it('uno que no existe es 404, y un id que no es UUID es 400 antes de llegar al caso de uso', async () => {
      const inventado = await leerMovimiento(randomUUID());
      const malFormado = await leerMovimiento('no-es-un-uuid');

      expect(inventado.status).toBe(NO_ENCONTRADO);
      expect(inventado.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
      expect(malFormado.status).toBe(ENTRADA_INVALIDA);
      expect(malFormado.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('🔴 un GERENTE_LOCAL no lee un movimiento de otra ubicación, aunque tenga su id', async () => {
      const item = await itemConPrecio('2.00');
      const id = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '2' });

      const respuesta = await leerMovimiento(id, cookieGerente);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      expect(JSON.stringify(respuesta.body)).not.toContain(item);
    });

    it('🔴 §4.3 — BODEGA no lo lee: es una fila del libro, con su cantidad y su importe', async () => {
      const item = await itemConPrecio('2.00');
      const id = await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '2' });

      const respuesta = await leerMovimiento(id, cookieBodega);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      const crudo = JSON.stringify(respuesta.body).toLowerCase();
      for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
        expect(crudo).not.toContain(prohibido.toLowerCase());
      }
    });

    it('?tipo=MERMA trae solo las mermas del ítem, y un tipo que no existe es 400', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: bodegaCentral, cantidad: '10' });
      const merma = await registrar({ locationId: bodegaCentral, itemId: item, tipo: 'MERMA', cantidad: '1' });
      expect(merma.status).toBe(CREADO);

      const filtrado = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodegaCentral, itemId: item, tipo: 'MERMA' })
        .set('Cookie', cookie);
      const inventado = await request(servidor())
        .get('/inventario/movimientos')
        .query({ locationId: bodegaCentral, tipo: 'ROBO' })
        .set('Cookie', cookie);

      expect(filtrado.status).toBe(OK);
      const tipos = (filtrado.body as { movimientos: { id: string; tipo: string }[] }).movimientos.map((m) => m.tipo);
      expect(tipos).toEqual(['MERMA']);
      expect(inventado.status).toBe(ENTRADA_INVALIDA);
    });
  });

  describe('el alcance por ubicación, que RLS no sabe decidir', () => {
    it('un GERENTE_LOCAL no lee el saldo de una ubicación que no es la suya', async () => {
      const respuesta = await request(servidor())
        .get('/inventario/saldos')
        .query({ locationId: bodegaCentral })
        .set('Cookie', cookieGerente).set('X-CSRF-Token', csrfDe(cookieGerente));
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('sí lee el de la suya', async () => {
      const respuesta = await request(servidor())
        .get('/inventario/saldos')
        .query({ locationId: local })
        .set('Cookie', cookieGerente).set('X-CSRF-Token', csrfDe(cookieGerente));
      expect(respuesta.status).toBe(OK);
    });

    it('no transfiere hacia una ubicación ajena, ni siquiera desde la suya', async () => {
      const item = await itemConPrecio('2.00');
      await comprar({ itemId: item, locationId: local, cantidad: '5' });

      const respuesta = await request(servidor())
        .post('/inventario/transferencias')
        .set('Cookie', cookieGerente).set('X-CSRF-Token', csrfDe(cookieGerente))
        .send({
          origen: local,
          destino: bodegaCentral,
          itemId: item,
          cantidad: '1',
          occurredAt: MARZO,
          note: null,
        });
      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });
});
