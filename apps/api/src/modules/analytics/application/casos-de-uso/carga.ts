/**
 * Cargar las unidades vendidas y los costos fijos de un mes.
 *
 * **SON LOS DOS DATOS QUE EL SISTEMA NO PUEDE DEDUCIR.** Todo lo demás sale del
 * catálogo, de las recetas o del libro; estos dos los teclea alguien, y de las
 * unidades vendidas dependen **tres de las seis vistas** (SPEC §10). Por eso la
 * API recibe un lote y no un producto: la pantalla que hace tolerable digitar
 * 48 productos al mes es una grilla, y una API de alta en alta la haría
 * imposible.
 *
 * **LAS DOS CARGAS SON POR REEMPLAZO.** Lo que el usuario ve al guardar es
 * exactamente lo que queda. Un producto que desaparece del lote deja de tener
 * ventas ese mes, que es lo que significa borrarlo de la grilla.
 *
 * **Y LAS DOS EXIGEN LA VERSIÓN QUE SE LEYÓ** (D-16.121, ADR-023). Son
 * reemplazos totales: sin testigo, dos personas con la rejilla abierta se
 * pisan y la segunda borra lo de la primera sin que nadie se entere. Las dos
 * cargas comparten la versión del período —la de «la carga del mes»—.
 *
 * **Y LAS DOS SE RECHAZAN EN UN MES CERRADO.** Si la cifra de ventas de un mes
 * sellado pudiera cambiar, el food cost real de ese mes cambiaría con ella
 * (D6). A diferencia del libro, aquí **no hay trigger de respaldo**: el vínculo
 * con el período es una clave foránea y un `CHECK` no puede seguirla.
 */

import type { DesenlaceVersionado } from '../../../../shared/application/concurrencia';
import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import { ConflictoDeVersionError } from '../../../../shared/domain/errors/conflicto-de-version';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { LocationId } from '../../../../shared/domain/identity/identificadores';
import { Count, Money } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type {
  AsegurarPeriodo,
  ConsultarPeriodo,
} from '../../../periods/application/casos-de-uso/periodos';
import type { ListarProductos } from '../../../recipes/application/casos-de-uso/recetas';
import type { PeriodoLeido } from '../../../periods/application/ports/repositorio-de-periodos.port';
import { exigirAbierto } from '../../../periods/domain/cierre';
import { Periodo } from '../../../periods/domain/periodo';
import {
  exigirCostosValidos,
  exigirVentasValidas,
  type CostoDelMes,
  type VentaDeProducto,
} from '../../domain/carga';
import type { ClasificacionDeCosto } from '../../domain/punto-de-equilibrio';
import type {
  CostoLeido,
  RepositorioDeAnalitica,
  VentaLeida,
} from '../ports/repositorio-de-analitica.port';

export interface DependenciasDeCarga {
  readonly repositorio: RepositorioDeAnalitica;
  readonly asegurarPeriodo: AsegurarPeriodo;
  readonly consultarPeriodo: ConsultarPeriodo;
  /**
   * **PARA EL NOMBRE DEL PRODUCTO, Y POR AQUI NO POR OTRO SITIO** (P16-A2).
   *
   * `RepositorioDeAnalitica` dice en su cabecera que solo toca SUS DOS TABLAS;
   * un `JOIN` a `product` desde alli seria un segundo sitio que mantener en
   * sincronia con `recipes`, que es quien manda en los productos (ADR-011).
   * Asi que el nombre se pide al caso de uso de ese modulo y se une aqui, en
   * aplicacion — exactamente lo que `vistas.ts` hace con el catalogo de items.
   */
  readonly listarProductos: ListarProductos;
  readonly auditoria: AuditLogPort;
}

/** Producto que ya no esta en la carta: ver `VentaConNombre.nombre`. */
const SIN_NOMBRE = '';

export interface MesDeUbicacion {
  readonly locationId: LocationId;
  readonly anio: number;
  readonly mes: number;
}

/**
 * La versión con la que se lee un mes que todavía no tiene fila de período
 * (D-16.122): la que tendrá la fila cuando la primera carga o el primer
 * movimiento la creen. Así el cuerpo no necesita un `null` con significado
 * propio, y un movimiento que abra el mes entre la lectura y la escritura no
 * provoca un conflicto que nadie causó.
 */
export const VERSION_INICIAL_DEL_MES = 1;

/** Lo que se escribe, con la versión de la carga que se leyó. */
export interface CargaDelMes extends MesDeUbicacion {
  readonly version: number;
}

export class RegistrarVentas {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {MesInvalidoError}
   * @throws {PeriodoCerradoError} @throws {ProductoRepetidoEnVentasError}
   * @throws {ConflictoDeVersionError}
   * @returns la versión NUEVA de la carga del mes.
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: CargaDelMes & { readonly ventas: readonly VentaDeProducto[] },
  ): Promise<number> {
    const periodo = await abrirParaEscribir(this.deps, sesion, datos);
    const validadas = exigirVentasValidas(datos.ventas);

    const version = versionDelMes(
      await this.deps.repositorio.reemplazarVentas({
        companyId: sesion.companyId,
        periodId: periodo.id,
        userId: sesion.userId,
        versionEsperada: datos.version,
        ventas: validadas.map((venta) => ({
          productId: venta.productId,
          unidades: venta.unidades.toStorageString(),
        })),
      }),
    );

    await registrar({
      deps: this.deps,
      sesion,
      eventType: 'sales.recorded',
      periodo,
      cuantos: validadas.length,
      version,
    });
    return version;
  }
}

export class RegistrarCostosFijos {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {PeriodoCerradoError}
   * @throws {ConceptoRepetidoError} @throws {ConflictoDeVersionError}
   * @returns la versión NUEVA de la carga del mes.
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: CargaDelMes & { readonly costos: readonly CostoDelMes[] },
  ): Promise<number> {
    const periodo = await abrirParaEscribir(this.deps, sesion, datos);
    const validados = exigirCostosValidos(datos.costos);

    const version = versionDelMes(
      await this.deps.repositorio.reemplazarCostos({
        companyId: sesion.companyId,
        periodId: periodo.id,
        userId: sesion.userId,
        versionEsperada: datos.version,
        costos: validados.map((costo) => ({
          concepto: costo.concepto.trim(),
          clasificacion: costo.clasificacion,
          importe: costo.importe.toStorageString(),
        })),
      }),
    );

    await registrar({
      deps: this.deps,
      sesion,
      eventType: 'fixed_cost.recorded',
      periodo,
      cuantos: validados.length,
      version,
    });
    return version;
  }
}

/**
 * Las unidades vendidas de un mes, **con el nombre del producto al lado**.
 *
 * El nombre no lo guarda la tabla de ventas —guarda `product_id`, que es lo
 * correcto: un producto renombrado no reescribe su historia—, asi que se une al
 * leer. Hasta P16-A2 no se unia en ningun sitio del servidor y la pantalla de
 * ventas pedia `/costeo` **entero** en paralelo solo para traducir ids a
 * nombres: costear la carta completa para pintar una columna de texto.
 */
export interface VentaConNombre extends VentaLeida {
  /**
   * Vacio si el producto ya no esta en la carta de la company.
   *
   * Pasa: un producto borrado deja sus ventas historicas en pie. Se devuelve
   * vacio y no se omite la fila, porque las unidades vendidas SI ocurrieron y
   * quitarlas cambiaria el total del mes.
   */
  readonly nombre: string;
}

/** Las ventas del mes y la versión con la que se guardarán (D-16.123). */
export interface VentasDelMes {
  readonly version: number;
  readonly ventas: readonly VentaConNombre[];
}

export class ConsultarVentas {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /** Un mes sin fila de período no tiene ventas: la lista vacía es la verdad. */
  public async ejecutar(sesion: SesionActiva, pedido: MesDeUbicacion): Promise<VentasDelMes> {
    const periodo = await this.deps.consultarPeriodo.ejecutar(sesion, pedido);
    if (periodo === null) return { version: VERSION_INICIAL_DEL_MES, ventas: [] };

    const [ventas, productos] = await Promise.all([
      this.deps.repositorio.ventasDe({ companyId: sesion.companyId, periodId: periodo.id }),
      this.deps.listarProductos.ejecutar(sesion),
    ]);
    const nombres = new Map(productos.map((producto) => [producto.id, producto.nombre]));

    return {
      version: periodo.version,
      ventas: ventas.map((venta) => ({
        productId: venta.productId,
        unidades: venta.unidades,
        nombre: nombres.get(venta.productId) ?? SIN_NOMBRE,
      })),
    };
  }
}

/** Los costos fijos del mes y la versión con la que se guardarán (D-16.123). */
export interface CostosDelMes {
  readonly version: number;
  readonly costos: readonly CostoLeido[];
}

export class ConsultarCostosFijos {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesDeUbicacion): Promise<CostosDelMes> {
    const periodo = await this.deps.consultarPeriodo.ejecutar(sesion, pedido);
    if (periodo === null) return { version: VERSION_INICIAL_DEL_MES, costos: [] };

    const costos = await this.deps.repositorio.costosDe({
      companyId: sesion.companyId,
      periodId: periodo.id,
    });
    return { version: periodo.version, costos };
  }
}

/* --- Piezas compartidas ---------------------------------------------------- */

/**
 * Del desenlace de la escritura condicionada, la versión nueva o el 409.
 *
 * `no_encontrado` no puede pasar —`AsegurarPeriodo` acaba de crear o leer la
 * fila, y los períodos no se borran—, y por eso NO se traduce a un error de
 * dominio: si pasara sería un fallo del servidor y el 500 es la respuesta honesta.
 */
function versionDelMes(desenlace: DesenlaceVersionado): number {
  if (desenlace.clase === 'conflicto_de_version') throw new ConflictoDeVersionError('carga del mes');
  if (desenlace.clase === 'no_encontrado') throw new Error('El período desapareció entre asegurarlo y escribir su carga.');
  return desenlace.version;
}

/**
 * Asegura el mes y comprueba que se puede escribir en él.
 *
 * El orden importa: `AsegurarPeriodo` ya comprueba el alcance de ubicación, así
 * que un usuario de otro local recibe «esa ubicación no es tuya» y no «el mes
 * está cerrado», que sería una respuesta engañosa y además filtraría el estado
 * de un período que no le corresponde.
 *
 * @throws {PeriodoCerradoError}
 */
async function abrirParaEscribir(
  deps: DependenciasDeCarga,
  sesion: SesionActiva,
  pedido: MesDeUbicacion,
): Promise<PeriodoLeido> {
  const periodo = await deps.asegurarPeriodo.ejecutar(sesion, pedido);

  exigirAbierto({
    periodo: Periodo.reconstruir({
      anio: periodo.anio,
      mes: periodo.mes,
      inicioEn: periodo.inicioEn,
      finEn: periodo.finEn,
    }),
    estadoActual: periodo.estado,
  });

  return periodo;
}

interface EventoDeCarga {
  readonly deps: DependenciasDeCarga;
  readonly sesion: SesionActiva;
  readonly eventType: string;
  readonly periodo: PeriodoLeido;
  readonly cuantos: number;
  readonly version: number;
}

async function registrar(evento: EventoDeCarga): Promise<void> {
  await registrarEventoDeUsuario({
    auditoria: evento.deps.auditoria,
    actorId: evento.sesion.userId,
    companyId: evento.sesion.companyId,
    eventType: evento.eventType,
    detail: {
      periodId: evento.periodo.id,
      locationId: evento.periodo.locationId,
      // Cuántas filas quedaron tras el reemplazo. Es el dato que permite ver
      // en el log que una carga de 48 productos se guardó con 3.
      filas: String(evento.cuantos),
      version: evento.version,
    },
  });
}

/** Los tipos que el borde HTTP convierte y los casos de uso reciben ya tipados. */
export function comoVenta(entrada: {
  readonly productId: VentaDeProducto['productId'];
  readonly unidades: string;
}): VentaDeProducto {
  return { productId: entrada.productId, unidades: Count.fromString(entrada.unidades) };
}

export function comoCosto(entrada: {
  readonly concepto: string;
  readonly clasificacion: ClasificacionDeCosto;
  readonly importe: string;
}): CostoDelMes {
  return {
    concepto: entrada.concepto,
    clasificacion: entrada.clasificacion,
    importe: Money.fromDecimalString(entrada.importe),
  };
}
