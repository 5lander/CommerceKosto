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
 * **Y LAS DOS SE RECHAZAN EN UN MES CERRADO.** Si la cifra de ventas de un mes
 * sellado pudiera cambiar, el food cost real de ese mes cambiaría con ella
 * (D6). A diferencia del libro, aquí **no hay trigger de respaldo**: el vínculo
 * con el período es una clave foránea y un `CHECK` no puede seguirla.
 */

import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { LocationId } from '../../../../shared/domain/identity/identificadores';
import { Count, Money } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type {
  AsegurarPeriodo,
  ConsultarPeriodo,
} from '../../../periods/application/casos-de-uso/periodos';
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
  readonly auditoria: AuditLogPort;
}

export interface MesDeUbicacion {
  readonly locationId: LocationId;
  readonly anio: number;
  readonly mes: number;
}

export class RegistrarVentas {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {MesInvalidoError}
   * @throws {PeriodoCerradoError} @throws {ProductoRepetidoEnVentasError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: MesDeUbicacion & { readonly ventas: readonly VentaDeProducto[] },
  ): Promise<void> {
    const periodo = await abrirParaEscribir(this.deps, sesion, datos);
    const validadas = exigirVentasValidas(datos.ventas);

    await this.deps.repositorio.reemplazarVentas({
      companyId: sesion.companyId,
      periodId: periodo.id,
      userId: sesion.userId,
      ventas: validadas.map((venta) => ({
        productId: venta.productId,
        unidades: venta.unidades.toStorageString(),
      })),
    });

    await registrar({
      deps: this.deps,
      sesion,
      eventType: 'sales.recorded',
      periodo,
      cuantos: validadas.length,
    });
  }
}

export class RegistrarCostosFijos {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {PeriodoCerradoError}
   * @throws {ConceptoRepetidoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: MesDeUbicacion & { readonly costos: readonly CostoDelMes[] },
  ): Promise<void> {
    const periodo = await abrirParaEscribir(this.deps, sesion, datos);
    const validados = exigirCostosValidos(datos.costos);

    await this.deps.repositorio.reemplazarCostos({
      companyId: sesion.companyId,
      periodId: periodo.id,
      userId: sesion.userId,
      costos: validados.map((costo) => ({
        concepto: costo.concepto.trim(),
        clasificacion: costo.clasificacion,
        importe: costo.importe.toStorageString(),
      })),
    });

    await registrar({
      deps: this.deps,
      sesion,
      eventType: 'fixed_cost.recorded',
      periodo,
      cuantos: validados.length,
    });
  }
}

export class ConsultarVentas {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  /** Un mes sin fila de período no tiene ventas: la lista vacía es la verdad. */
  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeUbicacion,
  ): Promise<readonly VentaLeida[]> {
    const periodo = await this.deps.consultarPeriodo.ejecutar(sesion, pedido);
    if (periodo === null) return [];

    return this.deps.repositorio.ventasDe({
      companyId: sesion.companyId,
      periodId: periodo.id,
    });
  }
}

export class ConsultarCostosFijos {
  public constructor(private readonly deps: DependenciasDeCarga) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeUbicacion,
  ): Promise<readonly CostoLeido[]> {
    const periodo = await this.deps.consultarPeriodo.ejecutar(sesion, pedido);
    if (periodo === null) return [];

    return this.deps.repositorio.costosDe({
      companyId: sesion.companyId,
      periodId: periodo.id,
    });
  }
}

/* --- Piezas compartidas ---------------------------------------------------- */

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
