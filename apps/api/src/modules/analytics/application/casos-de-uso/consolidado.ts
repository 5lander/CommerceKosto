/**
 * El consolidado de company y las dos comparativas entre ubicaciones.
 *
 * SE APOYA EN LO QUE P8 YA ARMA, Y ESO NO ES UN ATAJO: es la garantía de que
 * el consolidado no pueda discrepar de las vistas que consolida. Cada
 * ubicación pasa por el MISMO `contexto` que sirve su food cost real y su
 * inventario valorizado, así que «la suma de las ubicaciones» es literalmente
 * la suma de lo que cada una publica. Si se recalculara por otro camino —una
 * consulta agregada en SQL, por ejemplo— habría dos verdades y solo cuestión
 * de tiempo hasta que dejaran de coincidir.
 *
 * **UNA UBICACIÓN SIN PERÍODO NO ROMPE EL CONSOLIDADO.** `contexto` lanza
 * `PeriodoSinDatosError` cuando nadie ha tocado ese mes en esa ubicación, y
 * aquí eso no es un error: es información. Se aparta, se nombra, y las demás
 * se consolidan igual. Lo contrario —que un local recién abierto tumbe el
 * informe de toda la cadena— sería un sistema que se para solo.
 *
 * **EL ALCANCE ES DE COMPANY, y por eso lleva su propio permiso.** Un
 * `GERENTE_LOCAL` que pudiera pedir el consolidado vería, sumadas, las ventas y
 * los márgenes de los locales de sus compañeros. Es exactamente la escalada
 * horizontal que E18 prohíbe en la propagación de recetas, con otro disfraz.
 */

import type { ListarArticulos } from '../../../catalog/application/casos-de-uso/articulos';
import type { ListarUbicaciones } from '../../../iam/application/casos-de-uso/ubicaciones';
import type { ConsultarComprasPorArticulo } from '../../../inventory/application/casos-de-uso/para-analitica';
import type { CalendarioDePeriodos } from '../../../periods/domain/periodo';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { PermisoDenegadoError } from '../../../iam/domain/errores';
import type { LocationId } from '../../../../shared/domain/identity/identificadores';
import { Count, Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import {
  compararCompras,
  compararProductos,
  type ComparativaDeCompra,
  type ComparativaDeProducto,
  type ObservacionDeProducto,
} from '../../domain/comparativas';
import {
  consolidar,
  type AporteDeUbicacion,
  type Consolidado,
  type UbicacionSinDatos,
} from '../../domain/consolidado';
import { PeriodoSinDatosError } from '../../domain/errores';
import { contexto, type ContextoDelPeriodo, type DependenciasDeVistas } from './contexto';
import { foodCostDe, inventarioDe } from './vistas';

/** El permiso de nivel company. `GERENTE_LOCAL` NO lo tiene. */
export const PERMISO_CONSOLIDADO = 'analytics.consolidated.read';

export interface MesDeCompany {
  readonly anio: number;
  readonly mes: number;
}

export interface DependenciasDelConsolidado extends DependenciasDeVistas {
  readonly listarUbicaciones: ListarUbicaciones;
  readonly listarArticulos: ListarArticulos;
  readonly comprasPorArticulo: ConsultarComprasPorArticulo;
  readonly calendario: CalendarioDePeriodos;
}

interface UbicacionNombrada {
  readonly id: LocationId;
  readonly nombre: string;
}

interface Recogida {
  readonly aportes: readonly AporteDeUbicacion[];
  readonly sinDatos: readonly UbicacionSinDatos[];
  readonly contextos: readonly {
    readonly ubicacion: UbicacionNombrada;
    readonly datos: ContextoDelPeriodo;
  }[];
}

export class ConsultarConsolidado {
  public constructor(private readonly deps: DependenciasDelConsolidado) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesDeCompany): Promise<Consolidado> {
    const recogida = await recoger(this.deps, sesion, pedido);

    return consolidar({ ...pedido, aportes: recogida.aportes, sinDatos: recogida.sinDatos });
  }
}

export class CompararProductosEntreUbicaciones {
  public constructor(private readonly deps: DependenciasDelConsolidado) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeCompany,
  ): Promise<readonly ComparativaDeProducto[]> {
    const { contextos } = await recoger(this.deps, sesion, pedido);

    return compararProductos(contextos.flatMap((c) => observacionesDe(c.datos, c.ubicacion)));
  }
}

export class CompararComprasEntreUbicaciones {
  public constructor(private readonly deps: DependenciasDelConsolidado) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeCompany,
  ): Promise<readonly ComparativaDeCompra[]> {
    exigirAlcanceDeCompany(sesion);

    const mes = this.deps.calendario.de(pedido.anio, pedido.mes);

    // Los nombres se leen del CATALOGO por sus puertos, no de las tablas desde
    // `inventory`: el catalogo es fuente unica de verdad (CLAUDE.md §2), y
    // `audit:forbidden` lo hace cumplir. Tres listados completos y ni una
    // consulta por fila, que seria el N+1 que §5 prohibe.
    const [compras, items, articulos, ubicaciones] = await Promise.all([
      this.deps.comprasPorArticulo.ejecutar(sesion, { desde: mes.inicioEn, hasta: mes.finEn }),
      this.deps.listarItems.ejecutar(sesion, false),
      this.deps.listarArticulos.ejecutar(sesion, null),
      this.deps.listarUbicaciones.ejecutar(sesion),
    ]);

    const nombreDe = <T extends { readonly id: string }>(
      filas: readonly T[],
      campo: (fila: T) => string,
    ): ReadonlyMap<string, string> => new Map(filas.map((fila) => [fila.id, campo(fila)]));

    const porItem = nombreDe(items, (i) => i.nombre);
    const porArticulo = nombreDe(articulos, (a) => a.nombre);
    const porUbicacion = nombreDe(ubicaciones, (u) => u.nombre);

    return compararCompras(
      compras.map((fila) => ({
        itemId: fila.itemId,
        item: porItem.get(fila.itemId) ?? '',
        locationId: fila.locationId,
        ubicacion: porUbicacion.get(fila.locationId) ?? '',
        purchaseArticleId: fila.purchaseArticleId,
        articulo:
          fila.purchaseArticleId === null
            ? null
            : (porArticulo.get(fila.purchaseArticleId) ?? null),
        importe: Money.fromDatabase(fila.importe),
        cantidad: Ratio.fromDecimalString(fila.cantidad),
      })),
    );
  }
}

/**
 * Comprueba el permiso de company ANTES de tocar nada.
 *
 * Va en su propia función y se llama al principio de cada caso de uso, no
 * dentro de un refinamiento ni al final: CLAUDE.md §3 lo exige para todo
 * control de seguridad, y INC-008 cuenta lo que pasa cuando no se hace.
 *
 * @throws {PermisoDenegadoError}
 */
function exigirAlcanceDeCompany(sesion: SesionActiva): void {
  if (!sesion.permisos.includes(PERMISO_CONSOLIDADO)) {
    throw new PermisoDenegadoError(PERMISO_CONSOLIDADO);
  }
}

async function recoger(
  deps: DependenciasDelConsolidado,
  sesion: SesionActiva,
  pedido: MesDeCompany,
): Promise<Recogida> {
  exigirAlcanceDeCompany(sesion);

  const ubicaciones = await deps.listarUbicaciones.ejecutar(sesion);
  const recogidas = await Promise.all(
    ubicaciones.map(async (ubicacion) => unaUbicacion({ deps, sesion, pedido, ubicacion })),
  );

  return {
    aportes: recogidas.map((r) => r.aporte).filter((a): a is AporteDeUbicacion => a !== null),
    sinDatos: recogidas
      .map((r) => r.sinDatos)
      .filter((s): s is UbicacionSinDatos => s !== null),
    contextos: recogidas.flatMap((r) =>
      r.datos === null ? [] : [{ ubicacion: r.ubicacion, datos: r.datos }],
    ),
  };
}

interface Recogido {
  readonly ubicacion: UbicacionNombrada;
  readonly aporte: AporteDeUbicacion | null;
  readonly sinDatos: UbicacionSinDatos | null;
  readonly datos: ContextoDelPeriodo | null;
}

async function unaUbicacion(entrada: {
  readonly deps: DependenciasDelConsolidado;
  readonly sesion: SesionActiva;
  readonly pedido: MesDeCompany;
  readonly ubicacion: UbicacionNombrada;
}): Promise<Recogido> {
  const { deps, sesion, pedido, ubicacion } = entrada;

  try {
    const datos = await contexto(deps, sesion, { ...pedido, locationId: ubicacion.id });
    return {
      ubicacion,
      aporte: aporteDe(datos, ubicacion),
      sinDatos: null,
      datos,
    };
  } catch (error) {
    // SOLO se convierte en «sin datos» la ausencia de período. Cualquier otro
    // fallo sube: un consolidado que se traga un error de verdad y devuelve un
    // total mas bajo es peor que un consolidado que no sale.
    if (!(error instanceof PeriodoSinDatosError)) throw error;

    return {
      ubicacion,
      aporte: null,
      sinDatos: { locationId: ubicacion.id, nombre: ubicacion.nombre },
      datos: null,
    };
  }
}

function aporteDe(datos: ContextoDelPeriodo, ubicacion: UbicacionNombrada): AporteDeUbicacion {
  const real = foodCostDe(datos);

  return {
    locationId: ubicacion.id,
    nombre: ubicacion.nombre,
    estadoDelPeriodo: datos.conteo === null ? 'ABIERTO' : 'CERRADO',
    unidades: datos.unidadesTotales,
    ventaNeta: datos.ventaNetaMes,
    mcTotal: datos.mcMesTotal,
    consumoTeorico: datos.consumoTeoricoValorizado,
    consumoReal: real.consumoReal,
    comprasDelMes: datos.comprasDelMes,
    inventarioFinal: inventarioDe(datos).valorTotal,
    costosFijos: Money.sum(datos.costosFijos.map((linea) => linea.importe)),
    valorVerificado: datos.conteo === null ? Money.CERO : Money.fromDatabase(datos.conteo.valorCubierto),
    valorInventariado:
      datos.conteo === null ? Money.CERO : Money.fromDatabase(datos.conteo.valorTeorico),
  };
}

function observacionesDe(
  datos: ContextoDelPeriodo,
  ubicacion: { readonly id: LocationId; readonly nombre: string },
): readonly ObservacionDeProducto[] {
  return datos.carta.map((producto) => {
    const venta = producto.costeo.venta;

    return {
      productId: producto.productId,
      nombre: producto.nombre,
      locationId: ubicacion.id,
      ubicacion: ubicacion.nombre,
      activo: producto.activo,
      // EL PVP SE RECOMPONE, no se vuelve a leer: `venta_neta + iva_en_precio`
      // es exactamente el PVP con el que se costeó (R14). Leerlo otra vez de
      // `product_location` abriría la puerta a comparar un precio contra un
      // food cost calculado con otro.
      pvp: venta.clase === 'vendible' ? venta.ventaNeta.plus(venta.ivaEnPrecio) : null,
      costoPorPorcion: producto.costeo.costos.costoPorPorcion,
      foodCostPct: venta.clase === 'vendible' ? venta.foodCostPct : null,
      margenUnitario: venta.clase === 'vendible' ? venta.margenContribucion : null,
      unidades: datos.unidadesPorProducto.get(producto.productId) ?? Count.CERO,
    };
  });
}

/** Reexportado para que el controlador no tenga que importar del dominio. */
export type { ComparativaDeCompra, ComparativaDeProducto, Consolidado };
