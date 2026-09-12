/**
 * Los componentes de un combo: leerlos y reemplazarlos — SPEC §8, D-16.114.
 *
 * **P4 CREÓ LA TABLA Y HASTA P10 NADIE LA ESCRIBÍA**; P10 le dio el camino del
 * importador. Esto es el camino de la pantalla 13: la lista entera, con la
 * versión del combo, como cualquier otra escritura del agregado producto
 * (D-16.100).
 *
 * **LOS NOMBRES SE UNEN AQUÍ** para que la pantalla no tenga que cruzar ids con
 * otra llamada; `listarProductos` hace falta de todos modos para comprobar los
 * tipos, así que no es una consulta más.
 */

import type { ProductId } from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { problemaDeComponentes } from '../../domain/componentes-de-combo';
import { ProductoNoEncontradoError, RecetaInvalidaError } from '../../domain/errores';
import type { TipoDeProducto } from '../../domain/linea-de-receta';
import type { ProductoLeido } from '../ports/repositorio-de-recetas.port';
import { registrarCambioDeProducto, versionEscrita, type DependenciasDeRecetas } from './recetas';

export interface ComponenteConNombre {
  readonly productId: ProductId;
  readonly nombre: string;
  readonly cantidad: string;
}

export interface ComponentesDelCombo {
  /** La del combo: la que `PUT …/componentes` pide de vuelta. */
  readonly version: number;
  readonly componentes: readonly ComponenteConNombre[];
}

export class LeerComponentes {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {ProductoNoEncontradoError} */
  public async ejecutar(sesion: SesionActiva, comboId: ProductId): Promise<ComponentesDelCombo> {
    const [productos, filas] = await Promise.all([
      this.deps.repositorio.listarProductos(sesion.companyId),
      this.deps.repositorio.componentesDe({ companyId: sesion.companyId, comboProductId: comboId }),
    ]);
    const combo = productos.find((p) => p.id === comboId);
    if (combo === undefined) {
      throw new ProductoNoEncontradoError();
    }

    const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
    return {
      version: combo.version,
      componentes: filas.map((f) => ({
        productId: f.componentProductId,
        nombre: nombres.get(f.componentProductId) ?? '',
        cantidad: f.cantidad,
      })),
    };
  }
}

export class ReemplazarComponentes {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /**
   * @returns la versión NUEVA del combo.
   * @throws {ProductoNoEncontradoError} · {@link RecetaInvalidaError} · {@link ConflictoDeVersionError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly comboId: ProductId;
      readonly componentes: readonly { readonly productId: ProductId; readonly cantidad: string }[];
      readonly version: number;
    },
  ): Promise<number> {
    const productos = await this.deps.repositorio.listarProductos(sesion.companyId);
    const combo = productos.find((p) => p.id === entrada.comboId);
    if (combo === undefined) {
      throw new ProductoNoEncontradoError();
    }

    const problema = problemaDeComponentes({
      comboId: entrada.comboId,
      tipoDelCombo: tipoDe(combo),
      componentes: entrada.componentes,
      tipos: new Map(productos.map((p) => [p.id, tipoDe(p)])),
    });
    if (problema !== null) {
      throw new RecetaInvalidaError(problema);
    }

    const version = versionEscrita(
      await this.deps.repositorio.reemplazarComponentes({
        companyId: sesion.companyId,
        comboProductId: entrada.comboId,
        componentes: entrada.componentes.map((c) => ({ componentProductId: c.productId, cantidad: c.cantidad })),
        versionEsperada: entrada.version,
      }),
      'producto',
    );

    await registrarCambioDeProducto(this.deps, sesion, {
      productId: entrada.comboId,
      componentes: entrada.componentes.length,
      version,
    });

    return version;
  }
}

/** La columna `type` es texto; los dos valores válidos los sostiene su FK a `product_type`. */
function tipoDe(producto: ProductoLeido): TipoDeProducto {
  return producto.tipo === 'COMBO' ? 'COMBO' : 'SIMPLE';
}
