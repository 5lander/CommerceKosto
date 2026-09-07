/**
 * Lo que `inventory` expone hacia `analytics` — las vistas de P8.
 *
 * **EXISTE PARA QUE LA FLECHA SIGA APUNTANDO EN UN SOLO SENTIDO.** `analytics`
 * necesita dos cosas del inventario: qué movió cada ítem en el período y qué
 * dijo el conteo confirmado. Podría leerlas de las tablas, y entonces habría
 * dos módulos escribiendo consultas sobre `inventory_movement` y dos sitios que
 * mantener en sincronía el día que cambie el signo de algo.
 *
 * Aquí son dos casos de uso, y son la única puerta.
 *
 * **NO COMPRUEBAN PERMISOS**, igual que el resto de casos de uso: eso lo hace
 * el `@Requiere` del controlador que los usa. Lo que sí comprueban es el
 * alcance de ubicación, que es autorización de sesión y viaja con ella.
 */

import type {
  ItemId,
  LocationId,
  PeriodId,
} from '../../../../shared/domain/identity/identificadores';
import type { Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import type {
  AgregadoDeItem,
  CompraPorArticulo,
} from '../ports/repositorio-de-inventario.port';
import {
  catalogoDeConsumo,
  totalConsumido,
  type DependenciasDeConsumo,
  type VentaDeProducto,
} from './consumo';
import { LeerConciliacion, type ConciliacionDeConteo, type DependenciasDeConteo } from './conteos';

export class ConsultarAgregadosDelPeriodo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /** @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly desde: Date;
      readonly hasta: Date;
    },
  ): Promise<readonly AgregadoDeItem[]> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);
    return this.deps.repositorio.agregadosDelPeriodo({ companyId: sesion.companyId, ...entrada });
  }
}

/**
 * Lo que cada ubicación pagó por cada ítem en el período — la comparativa de
 * compras de P9.
 *
 * **NO COMPRUEBA ALCANCE DE UBICACIÓN, y es a propósito.** Esta consulta es de
 * company entera: su razón de ser es cruzar ubicaciones. Quien la llama tiene
 * que haber exigido antes el permiso de nivel company, y lo hace
 * `CompararComprasEntreUbicaciones` en su primera línea. Un `GERENTE_LOCAL` no
 * llega hasta aquí.
 */
export class ConsultarComprasPorArticulo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly desde: Date; readonly hasta: Date },
  ): Promise<readonly CompraPorArticulo[]> {
    return this.deps.repositorio.comprasPorArticulo({ companyId: sesion.companyId, ...entrada });
  }
}

/**
 * La conciliación **congelada** del conteo confirmado de un período, o `null`.
 *
 * `null` no es un error: un mes sin conteo confirmado es lo normal hasta que
 * alguien cuenta. Quien lo consume tiene que decidir qué hacer con esa
 * ausencia, y en P8 la decisión está escrita: sin conteo no hay inventario
 * final físico, así que no hay consumo real, así que no hay food cost real.
 */
export class ConsultarConteoConfirmado {
  public constructor(
    private readonly deps: DependenciasDeConteo,
    private readonly conciliacion: LeerConciliacion,
  ) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly periodId: PeriodId },
  ): Promise<ConciliacionDeConteo | null> {
    const conteo = await this.deps.conteos.confirmadoDe({
      companyId: sesion.companyId,
      periodId: entrada.periodId,
    });
    if (conteo === null) return null;

    return this.conciliacion.ejecutar(sesion, { countId: conteo.id });
  }
}

/**
 * El consumo teórico de un período — SPEC §16 y §18.
 *
 * **ES LA MISMA FUNCIÓN QUE REGISTRA EL CONSUMO EN EL LIBRO**, no una copia:
 * `totalConsumido` explota la receta por las unidades vendidas, y eso es
 * exactamente lo que «consumo teórico» significa. Dos implementaciones darían
 * dos respuestas a la misma pregunta, y la vista de inventario compararía un
 * stock teórico contra un consumo que el libro descontó de otra forma.
 *
 * `fecha` es la del corte del período, no «hoy»: la receta que manda es la que
 * estaba vigente entonces.
 */
export class CalcularConsumoTeorico {
  public constructor(private readonly deps: DependenciasDeConsumo) {}

  /** @throws {UbicacionFueraDeAlcanceError} @throws {CicloEnConsumoError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly fecha: Date;
      readonly ventas: readonly VentaDeProducto[];
    },
  ): Promise<ReadonlyMap<ItemId, Ratio>> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const [carta, items] = await Promise.all([
      this.deps.leerCarta.ejecutar(sesion, {
        locationId: entrada.locationId,
        fecha: entrada.fecha,
      }),
      this.deps.listarItems.ejecutar(sesion, false),
    ]);

    return totalConsumido(entrada.ventas, carta, catalogoDeConsumo(items, carta));
  }
}
