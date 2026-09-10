/**
 * Períodos y conteo físico de punta a punta — criterios de aceptación de P7.
 *
 *   D6     un movimiento con fecha en período cerrado se rechaza, por las
 *          CINCO rutas de escritura del libro, y con 4xx y no con un 500
 *   D6     reabrir es solo del `OWNER`, y exige un motivo
 *   D7     un conteo parcial produce su indicador de cobertura, y el consumo
 *          real de SPEC §16 cuando hay inventario inicial encadenado
 *   §4.3   la respuesta cruda de la hoja de conteo no contiene stock teórico,
 *          diferencia ni valorización, y `BODEGA` recibe 403 en la conciliación
 *
 * **LO QUE ESTA SUITE APORTA SOBRE LAS UNITARIAS.** El dominio ya prueba la
 * frontera del mes y la aritmética del hallazgo con la base apagada. Lo que no
 * se puede probar ahí es que la guarda de aplicación y el trigger de PostgreSQL
 * rechacen **los mismos** movimientos —si discreparan, uno de los dos mentiría—
 * y que los permisos dejen pasar exactamente a quien deben.
 *
 * **CADA MES DE 2026 SE USA UNA SOLA VEZ**, y las dos ubicaciones separan los
 * bloques que necesitan un libro limpio. Un conteo mide el saldo *hasta su
 * corte*, así que un movimiento sembrado por otra prueba en un mes anterior
 * entra en el número, y la suite se volvería dependiente de su propio orden.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { CalendarioDePeriodos } from '../../src/modules/periods/domain/periodo';
import { ZONA_HORARIA_DE_PERIODOS } from '../../src/shared/infrastructure/config/periods';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

const OK = 200;
const CREADO = 201;
const SIN_CONTENIDO = 204;
const ENTRADA_INVALIDA = 400;
const PROHIBIDO = 403;
const CONFLICTO = 409;

const CLAVE = 'siete limones verdes';
const CALENDARIO = new CalendarioDePeriodos(ZONA_HORARIA_DE_PERIODOS);

const EN_ENERO = '2026-01-20T12:00:00.000Z';
const EN_MARZO = '2026-03-15T12:00:00.000Z';
const EN_ABRIL = '2026-04-15T12:00:00.000Z';
const VIGENCIA = '2026-01-01T00:00:00.000Z';

/**
 * Lo que jamás puede aparecer en una respuesta a `BODEGA` — §4.3.
 *
 * Se busca sobre el JSON **crudo**, en texto: lo que importa es que el byte no
 * salga del backend. Un campo que la interfaz escondería sigue viajando.
 */
const PROHIBIDOS_PARA_BODEGA = ['teorico', 'diferencia', 'valor', 'costo', 'consumo', 'cobertura'];

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

type Cuerpo = Readonly<Record<string, unknown>>;

interface ItemCosteado {
  readonly itemId: string;
  readonly articuloId: string;
}

interface PeriodoDto {
  readonly id: string;
  readonly etiqueta: string;
  readonly estado: string;
}

interface ConteoDto {
  readonly id: string;
  readonly etiqueta: string;
  readonly estado: string;
}

interface ConciliacionDto {
  readonly filas: readonly {
    readonly itemId: string;
    readonly contado: string | null;
    readonly teorico: string;
    readonly diferencia: string | null;
    readonly valorDeDiferencia: string | null;
  }[];
  readonly valorTeorico: string;
  readonly valorCubierto: string;
  readonly valorFisico: string;
  readonly cobertura: string | null;
  readonly comprasDelPeriodo: string;
  readonly valorInicial: string | null;
  readonly consumoReal: string | null;
}

describe('periodos y conteo fisico', () => {
  let app: INestApplication;
  let duena: Client;
  let admin: string;
  let owner: string;
  let bodeguero: string;
  let company: string;
  let bodega: string;
  let otra: string;
  let usuarioId: string;

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

  async function confirmarPrecio(cuerpo: Cuerpo): Promise<void> {
    const sugerido = await request(servidor())
      .post('/precios')
      .set('Cookie', admin)
      .send({ ivaCompra: '0', validFrom: VIGENCIA, origen: 'MANUAL', nota: null, ...cuerpo });
    expect(sugerido.status).toBe(CREADO);

    const decision = await request(servidor())
      .post(`/precios/${(sugerido.body as { id: string }).id}/decision`)
      .set('Cookie', admin)
      .send({ decision: 'CONFIRMED' });
    expect(decision.status).toBe(SIN_CONTENIDO);
  }

  /** Un ítem comprado con artículo y precio confirmado, listo para valorizar. */
  async function itemCosteado(precio: string): Promise<ItemCosteado> {
    const item = await request(servidor())
      .post('/catalogo/items')
      .set('Cookie', admin)
      .send({
        nombre: `Insumo ${randomUUID().slice(0, 8)}`,
        tipo: 'COMPRADO',
        unidadDeUso: 'kg',
        rendimiento: '1',
        grupoId: null,
        confianzaDePrecio: 'FACTURA',
        llevaStock: null,
      });
    expect(item.status).toBe(CREADO);
    const itemId = (item.body as { id: string }).id;

    const articulo = await request(servidor())
      .post('/catalogo/articulos')
      .set('Cookie', admin)
      .send({
        itemId,
        nombre: `Presentacion ${randomUUID().slice(0, 8)}`,
        marca: null,
        proveedor: null,
        presentacion: '1',
        unidadDePresentacion: 'kg',
        factorExplicito: null,
        ivaTarifa: '0',
      });
    expect(articulo.status).toBe(CREADO);
    const articuloId = (articulo.body as { id: string }).id;

    await confirmarPrecio({ itemId, purchaseArticleId: articuloId, precio });
    return { itemId, articuloId };
  }

  function movimiento(cuerpo: Cuerpo, quien = admin) {
    return request(servidor())
      .post('/inventario/movimientos')
      .set('Cookie', quien)
      .send({
        locationId: bodega,
        tipo: 'COMPRA',
        cantidad: '1',
        costoTotal: '20.00',
        purchaseArticleId: null,
        // La tarifa es del cuerpo aquí: estos insumos no tienen grupo. Cero,
        // para que el importe siga siendo el que las aserciones esperan.
        ivaTarifa: '0',
        note: null,
        occurredAt: EN_MARZO,
        ...cuerpo,
      });
  }

  async function comprar(cuerpo: Cuerpo): Promise<string> {
    const respuesta = await movimiento(cuerpo);
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  function abrir(datos: { readonly mes: number; readonly donde?: string; readonly quien?: string }) {
    return request(servidor())
      .post('/conteos')
      .set('Cookie', datos.quien ?? admin)
      .send({ locationId: datos.donde ?? bodega, anio: 2026, mes: datos.mes, note: null });
  }

  async function abrirConteo(datos: {
    readonly mes: number;
    readonly donde?: string;
    readonly quien?: string;
  }): Promise<string> {
    const respuesta = await abrir(datos);
    expect(respuesta.status).toBe(CREADO);
    return (respuesta.body as { id: string }).id;
  }

  function anotar(countId: string, lineas: readonly Cuerpo[], quien = admin) {
    return request(servidor())
      .put(`/conteos/${countId}/lineas`)
      .set('Cookie', quien)
      .send({ lineas });
  }

  function confirmar(countId: string, quien = admin) {
    return request(servidor()).post(`/conteos/${countId}/confirmacion`).set('Cookie', quien).send();
  }

  function cerrarMes(countId: string, quien = admin) {
    return request(servidor())
      .post(`/conteos/${countId}/cierre-de-periodo`)
      .set('Cookie', quien)
      .send();
  }

  async function conciliacion(countId: string): Promise<ConciliacionDto> {
    const respuesta = await request(servidor()).get(`/conteos/${countId}`).set('Cookie', admin);
    expect(respuesta.status).toBe(OK);
    return respuesta.body as ConciliacionDto;
  }

  async function periodoDe(etiqueta: string): Promise<PeriodoDto | undefined> {
    const respuesta = await request(servidor())
      .get('/periodos')
      .query({ locationId: bodega })
      .set('Cookie', admin);
    expect(respuesta.status).toBe(OK);
    return (respuesta.body as readonly PeriodoDto[]).find(
      (periodo) => periodo.etiqueta === etiqueta,
    );
  }

  async function conteosDe(donde: string, quien = admin): Promise<readonly ConteoDto[]> {
    const respuesta = await request(servidor())
      .get('/conteos')
      .query({ locationId: donde })
      .set('Cookie', quien);
    expect(respuesta.status).toBe(OK);
    return respuesta.body as readonly ConteoDto[];
  }

  /** Cierra un mes de punta a punta: abrir conteo, confirmarlo y sellar. */
  async function cerrarElMesDe(mes: number): Promise<string> {
    const countId = await abrirConteo({ mes });
    expect((await confirmar(countId)).status).toBe(SIN_CONTENIDO);
    expect((await cerrarMes(countId)).status).toBe(SIN_CONTENIDO);
    return countId;
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
      [`periodos ${sufijo}`],
    );
    company = rows[0]?.id ?? '';

    const ubicacion = async (nombre: string): Promise<string> => {
      const { rows: creadas } = await duena.query<{ id: string }>(
        `INSERT INTO location (company_id, name, type, status)
         VALUES ($1, $2, 'BODEGA', 'ACTIVE') RETURNING id`,
        [company, nombre],
      );
      return creadas[0]?.id ?? '';
    };
    bodega = await ubicacion('Bodega central');
    otra = await ubicacion('Bodega norte');

    const correos = {
      admin: `admin.${sufijo}@snacklab.ec`,
      owner: `owner.${sufijo}@snacklab.ec`,
      bodega: `bodega.${sufijo}@snacklab.ec`,
    };
    for (const correo of Object.values(correos)) {
      await duena.query(
        `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`,
        [company, correo, hash],
      );
    }
    for (const [rol, correo] of [
      ['ADMIN', correos.admin],
      ['OWNER', correos.owner],
    ] as const) {
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, has_location)
         SELECT $1, id, $2, false FROM app_user WHERE email = $3`,
        [company, rol, correo],
      );
    }
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       SELECT $1, id, 'BODEGA', $2, true FROM app_user WHERE email = $3`,
      [company, bodega, correos.bodega],
    );

    const { rows: autores } = await duena.query<{ id: string }>(
      `SELECT id FROM app_user WHERE email = $1`,
      [correos.admin],
    );
    usuarioId = autores[0]?.id ?? '';

    admin = await entrar(correos.admin);
    owner = await entrar(correos.owner);
    bodeguero = await entrar(correos.bodega);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('el mes se cierra al confirmar el conteo (D6)', () => {
    it('cerrar un mes sin conteo confirmado se rechaza: quedaria sellado y ciego', async () => {
      const countId = await abrirConteo({ mes: 5 });

      const respuesta = await cerrarMes(countId);
      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('borrador');
    });

    it('un mes que todavia no ha terminado no se puede cerrar', async () => {
      const countId = await abrirConteo({ mes: 12 });
      expect((await confirmar(countId)).status).toBe(SIN_CONTENIDO);

      const respuesta = await cerrarMes(countId);
      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('no ha terminado');
    });

    it('confirmado y terminado, el mes se cierra y aparece CERRADO', async () => {
      await cerrarElMesDe(6);

      expect((await periodoDe('2026-06'))?.estado).toBe('CERRADO');
    });

    it('cerrar dos veces el mismo mes se rechaza', async () => {
      const countId = await cerrarElMesDe(7);

      const respuesta = await cerrarMes(countId);
      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('ya está cerrado');
    });
  });

  describe('un periodo cerrado no admite movimientos, por ninguna de las cinco rutas', () => {
    it('una compra con fecha del mes cerrado devuelve 409, no un 500 del trigger', async () => {
      await cerrarElMesDe(8);
      const item = await itemCosteado('2.00');

      const respuesta = await movimiento({
        itemId: item.itemId,
        occurredAt: '2026-08-10T12:00:00.000Z',
      });

      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('cerrado');
    });

    it('y una transferencia, una produccion y un consumo tambien', async () => {
      const item = await itemCosteado('2.00');
      const enAgosto = '2026-08-11T12:00:00.000Z';

      const transferencia = await request(servidor())
        .post('/inventario/transferencias')
        .set('Cookie', admin)
        .send({
          origen: bodega,
          destino: otra,
          itemId: item.itemId,
          cantidad: '1',
          occurredAt: enAgosto,
          note: null,
        });
      expect(transferencia.status).toBe(CONFLICTO);

      const produccion = await request(servidor())
        .post('/inventario/producciones')
        .set('Cookie', admin)
        .send({
          locationId: bodega,
          itemId: item.itemId,
          cantidad: '1',
          insumos: [{ itemId: item.itemId, cantidad: '1' }],
          occurredAt: enAgosto,
          note: null,
        });
      expect(produccion.status).toBe(CONFLICTO);

      const consumo = await request(servidor())
        .post('/inventario/consumos')
        .set('Cookie', admin)
        .send({
          locationId: bodega,
          ventas: [{ productId: randomUUID(), unidades: '1' }],
          occurredAt: enAgosto,
          note: null,
        });
      expect(consumo.status).toBe(CONFLICTO);
    });

    /**
     * LA CORRECCIÓN TAMBIÉN, y es la consecuencia menos obvia del cierre.
     *
     * Una corrección conserva la fecha del movimiento que anula (R3), así que
     * cae dentro del mes sellado. Es exactamente lo que «cerrado es de solo
     * lectura» significa: para arreglarlo hay que reabrir.
     */
    it('corregir un movimiento de un mes cerrado tambien se rechaza', async () => {
      const item = await itemCosteado('2.00');
      const compra = await comprar({ itemId: item.itemId, occurredAt: EN_ENERO });

      await cerrarElMesDe(1);

      const respuesta = await request(servidor())
        .post(`/inventario/movimientos/${compra}/correccion`)
        .set('Cookie', admin)
        .send({ note: 'me equivoque' });

      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('cerrado');
    });

    /**
     * LA GARANTÍA NO ES LA GUARDA.
     *
     * Se inserta directamente en la tabla, saltándose la aplicación entera, y
     * el trigger lo rechaza igual. Es lo que cubre la sexta escritura del libro
     * que alguien escriba mañana y olvide llamar a `exigirLibroEscribible`.
     */
    it('el trigger de la base rechaza la fila aunque nadie pase por la API', async () => {
      const item = await itemCosteado('2.00');

      await expect(
        duena.query(
          `INSERT INTO inventory_movement
             (company_id, location_id, item_id, type, direction, quantity, total_cost,
              occurred_at, created_by)
           VALUES ($1, $2, $3, 'COMPRA', 'ENTRADA', 1, 2.00, $4, $5)`,
          [company, bodega, item.itemId, '2026-08-12T12:00:00.000Z', usuarioId],
        ),
      ).rejects.toThrow(/cerrado/u);
    });

    /**
     * LA FRONTERA, que es donde guarda y trigger podrían discrepar.
     *
     * El intervalo es semiabierto `[inicio, fin)`: el instante exacto de
     * `finEn` ya pertenece al mes siguiente y tiene que entrar.
     */
    it('el instante exacto del fin del mes cerrado ya es del mes siguiente y SI entra', async () => {
      const item = await itemCosteado('2.00');
      const agosto = CALENDARIO.de(2026, 8);

      const justoAntes = await movimiento({
        itemId: item.itemId,
        occurredAt: new Date(agosto.finEn.getTime() - 1).toISOString(),
      });
      expect(justoAntes.status).toBe(CONFLICTO);

      const justoEn = await movimiento({
        itemId: item.itemId,
        occurredAt: agosto.finEn.toISOString(),
      });
      expect(justoEn.status).toBe(CREADO);
    });
  });

  describe('la reapertura es solo del OWNER (D6)', () => {
    it('un ADMIN no puede reabrir', async () => {
      await cerrarElMesDe(2);
      const febrero = await periodoDe('2026-02');

      const respuesta = await request(servidor())
        .post(`/periodos/${febrero?.id ?? ''}/reapertura`)
        .set('Cookie', admin)
        .send({ motivo: 'falto una factura' });

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('el OWNER si, y despues el movimiento entra', async () => {
      const febrero = await periodoDe('2026-02');
      const item = await itemCosteado('2.00');
      const enFebrero = '2026-02-10T12:00:00.000Z';

      expect((await movimiento({ itemId: item.itemId, occurredAt: enFebrero })).status).toBe(
        CONFLICTO,
      );

      const reapertura = await request(servidor())
        .post(`/periodos/${febrero?.id ?? ''}/reapertura`)
        .set('Cookie', owner)
        .send({ motivo: 'falto una factura de febrero' });
      expect(reapertura.status).toBe(SIN_CONTENIDO);

      expect((await movimiento({ itemId: item.itemId, occurredAt: enFebrero })).status).toBe(
        CREADO,
      );
      expect((await periodoDe('2026-02'))?.estado).toBe('ABIERTO');
    });

    /**
     * El evento `period.reopened` SÍ se escribe con su motivo, y esta prueba
     * **no lo comprueba**: nadie puede leer `audit_log`, ni siquiera el dueño
     * de la tabla. Es deliberado —SEGURIDAD.md §10: el acceso al log es del
     * back office— y significa que la verificación del rastro es un pendiente
     * de **P11**, no de este paquete. Lo que sí se comprueba aquí es que sin
     * motivo no se reabre, que es la condición que hace útil el rastro.
     */
    it('reabrir exige un motivo', async () => {
      const febrero = await periodoDe('2026-02');

      const respuesta = await request(servidor())
        .post(`/periodos/${febrero?.id ?? ''}/reapertura`)
        .set('Cookie', owner)
        .send({ motivo: '' });

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    it('reabrir un periodo que esta abierto se rechaza', async () => {
      const febrero = await periodoDe('2026-02');

      const respuesta = await request(servidor())
        .post(`/periodos/${febrero?.id ?? ''}/reapertura`)
        .set('Cookie', owner)
        .send({ motivo: 'otra vez' });

      expect(respuesta.status).toBe(CONFLICTO);
    });
  });

  describe('el conteo fisico', () => {
    let marzo: string;
    let item: ItemCosteado;

    it('la hoja lista los items almacenables y refleja lo anotado', async () => {
      item = await itemCosteado('2.00');
      marzo = await abrirConteo({ mes: 3 });

      expect((await anotar(marzo, [{ itemId: item.itemId, cantidad: '7.5' }])).status).toBe(
        SIN_CONTENIDO,
      );

      const hoja = await request(servidor()).get(`/conteos/${marzo}/hoja`).set('Cookie', admin);
      expect(hoja.status).toBe(OK);

      const filas = (hoja.body as { filas: { itemId: string; cantidad: string | null }[] }).filas;
      expect(filas.find((fila) => fila.itemId === item.itemId)?.cantidad).toBe('7.500000000000');
      // Y aparecen tambien los items que nadie conto: la hoja no dice nada del
      // libro por el mero hecho de listar una fila.
      expect(filas.length).toBeGreaterThan(1);
    });

    it('contar en negativo se rechaza con el mensaje del dominio, no con un 500', async () => {
      const respuesta = await anotar(marzo, [{ itemId: item.itemId, cantidad: '-1' }]);

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
      expect((respuesta.body as { message: string }).message).toContain('cero');
    });

    it('dos lineas del mismo item se rechazan', async () => {
      const respuesta = await anotar(marzo, [
        { itemId: item.itemId, cantidad: '1' },
        { itemId: item.itemId, cantidad: '2' },
      ]);

      expect(respuesta.status).toBe(ENTRADA_INVALIDA);
    });

    /**
     * DOS BORRADORES DEL MISMO MES SON LEGÍTIMOS; dos confirmados no.
     *
     * Es la carrera que el índice único de la base cierra, y esta guarda la
     * convierte en un 409 con mensaje en vez de un `23505` → 500 (INC-012).
     */
    it('solo puede haber un conteo confirmado por periodo', async () => {
      const segundo = await abrirConteo({ mes: 3 });
      expect((await confirmar(marzo)).status).toBe(SIN_CONTENIDO);

      const respuesta = await confirmar(segundo);
      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('2026-03');
    });

    it('con uno ya confirmado, ni siquiera se puede abrir otro', async () => {
      const respuesta = await abrir({ mes: 3 });

      expect(respuesta.status).toBe(CONFLICTO);
    });

    it('un conteo confirmado ya no admite cambios', async () => {
      const respuesta = await anotar(marzo, [{ itemId: item.itemId, cantidad: '2' }]);

      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as { message: string }).message).toContain('confirmado');
    });
  });

  describe('la conciliacion y su cobertura (D7)', () => {
    let contado: ItemCosteado;
    let sinContar: ItemCosteado;
    let abril: string;

    it('la diferencia sale valorizada, y un item sin contar no genera ninguna', async () => {
      contado = await itemCosteado('2.00');
      sinContar = await itemCosteado('5.00');
      await comprar({ locationId: otra, itemId: contado.itemId, cantidad: '10', occurredAt: EN_ABRIL });
      await comprar({ locationId: otra, itemId: sinContar.itemId, cantidad: '4', occurredAt: EN_ABRIL });

      abril = await abrirConteo({ mes: 4, donde: otra });
      await anotar(abril, [{ itemId: contado.itemId, cantidad: '8.5' }]);
      const previa = await conciliacion(abril);

      const linea = previa.filas.find((fila) => fila.itemId === contado.itemId);
      expect(linea?.diferencia).toBe('-1.500000000000');
      expect(linea?.valorDeDiferencia).toBe('-3.000000000000');

      const ausente = previa.filas.find((fila) => fila.itemId === sinContar.itemId);
      expect(ausente?.contado).toBeNull();
      expect(ausente?.diferencia).toBeNull();
    });

    /**
     * EL INDICADOR QUE PIDE D7, con el número que lo hace útil.
     *
     * Se contó un ítem de dos, pero lo que mide la calidad del dato es el
     * **valor** verificado: 20 de 40, la mitad.
     */
    it('la cobertura es valor verificado sobre valor total, no items contados', async () => {
      const previa = await conciliacion(abril);

      expect(previa.valorTeorico).toBe('40.000000000000');
      expect(previa.valorCubierto).toBe('20.000000000000');
      expect(previa.cobertura).toBe('0.500000000000');
      // 8,5 contados a 2,00 + los 20 teoricos del que nadie conto. No 17 + 0.
      expect(previa.valorFisico).toBe('37.000000000000');
    });

    it('sin conteo del mes anterior no hay inventario inicial, y el consumo real es null', async () => {
      const previa = await conciliacion(abril);

      expect(previa.valorInicial).toBeNull();
      expect(previa.consumoReal).toBeNull();
      expect(previa.comprasDelPeriodo).toBe('40.000000000000');
    });

    /**
     * LA CADENA DE SPEC §16: el inventario final de un mes es el inicial del
     * siguiente. Es lo que hace que `consumo_real` signifique algo.
     */
    it('con el mes anterior confirmado, el inicial se encadena y el consumo real sale', async () => {
      expect((await confirmar(abril)).status).toBe(SIN_CONTENIDO);
      const finalDeAbril = (await conciliacion(abril)).valorFisico;

      const mayo = await abrirConteo({ mes: 5, donde: otra });
      const deMayo = await conciliacion(mayo);

      expect(deMayo.valorInicial).toBe(finalDeAbril);
      // inicial + compras − final. En mayo no hubo compras y no se conto nada,
      // asi que el final fisico es el teorico —40— y el consumo real es 37−40.
      expect(deMayo.comprasDelPeriodo).toBe('0.000000000000');
      expect(deMayo.consumoReal).toBe('-3.000000000000');
    });

    /**
     * CONFIRMAR CONGELA, y esta es la prueba que lo demuestra: se cambia el
     * precio DESPUÉS y la conciliación del mes ya confirmado no se mueve.
     */
    it('un precio nuevo no reescribe la conciliacion de un conteo ya confirmado', async () => {
      const antes = await conciliacion(abril);

      await confirmarPrecio({
        itemId: contado.itemId,
        purchaseArticleId: contado.articuloId,
        precio: '999.00',
        validFrom: VIGENCIA,
      });

      const despues = await conciliacion(abril);
      expect(despues.valorTeorico).toBe(antes.valorTeorico);
      expect(despues.valorFisico).toBe(antes.valorFisico);
    });
  });

  describe('confidencialidad frente a BODEGA (§4.3)', () => {
    it('BODEGA cuenta: puede abrir la hoja, anotarla y confirmarla', async () => {
      const item = await itemCosteado('2.00');
      const countId = await abrirConteo({ mes: 10, quien: bodeguero });

      expect(
        (await anotar(countId, [{ itemId: item.itemId, cantidad: '3' }], bodeguero)).status,
      ).toBe(SIN_CONTENIDO);
      expect((await confirmar(countId, bodeguero)).status).toBe(SIN_CONTENIDO);
    });

    it('y NO concilia: la conciliacion le devuelve 403', async () => {
      const alguno = (await conteosDe(bodega, bodeguero))[0]?.id ?? '';

      const respuesta = await request(servidor())
        .get(`/conteos/${alguno}`)
        .set('Cookie', bodeguero);

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('tampoco cierra el mes: contar y sellar son permisos distintos', async () => {
      const alguno = (await conteosDe(bodega, bodeguero))[0]?.id ?? '';

      expect((await cerrarMes(alguno, bodeguero)).status).toBe(PROHIBIDO);
    });

    /**
     * SOBRE LA RESPUESTA CRUDA, no sobre un objeto tipado: lo que importa es
     * que el byte no salga del backend.
     */
    it('ni la hoja ni la lista que recibe BODEGA llevan teorico, diferencia ni valorizacion', async () => {
      const conteos = await conteosDe(bodega, bodeguero);
      const alguno = conteos[0]?.id ?? '';

      const hoja = await request(servidor())
        .get(`/conteos/${alguno}/hoja`)
        .set('Cookie', bodeguero);
      expect(hoja.status).toBe(OK);

      for (const crudo of [JSON.stringify(hoja.body), JSON.stringify(conteos)]) {
        for (const prohibido of PROHIBIDOS_PARA_BODEGA) {
          expect(crudo.toLowerCase()).not.toContain(prohibido);
        }
      }
    });

    it('confirmar no le devuelve la conciliacion que acaba de calcular', async () => {
      const item = await itemCosteado('2.00');
      const countId = await abrirConteo({ mes: 11, quien: bodeguero });
      await anotar(countId, [{ itemId: item.itemId, cantidad: '1' }], bodeguero);

      const respuesta = await confirmar(countId, bodeguero);

      expect(respuesta.status).toBe(SIN_CONTENIDO);
      expect(JSON.stringify(respuesta.body)).toBe('{}');
    });
  });
});
