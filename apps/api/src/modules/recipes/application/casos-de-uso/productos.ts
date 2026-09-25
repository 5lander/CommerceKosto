/**
 * Las lecturas de producto que las pantallas 11, 12 y 3 necesitan — P16-B.
 *
 * **LA FICHA LLEVA LA VERSIÓN** (D-16.100): es lo que la pantalla del producto
 * manda de vuelta al guardar su configuración, su empaque o sus componentes.
 *
 * **LAS UBICACIONES DE UN PRODUCTO SE FILTRAN POR ALCANCE** (D-16.113). El
 * producto es de la company, pero su PVP y su activación son de cada local, y un
 * `GERENTE_LOCAL` no tiene por qué ver a cuánto vende el local de al lado. RLS no
 * lo impide —las filas son de su company—; lo impide esto, igual que
 * `exigirUbicacionEnAlcance` en las escrituras.
 *
 * **LA CARTA DE UNA UBICACIÓN LLEVA EL NOMBRE**, unido aquí y no en el
 * repositorio (D-16.83): `productosEnUbicacion` lee una tabla y `listarProductos`
 * otra, y cada una ya tiene su índice.
 */

import type { LocationId, ProductId } from '../../../../shared/domain/identity/identificadores';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import { ProductoNoEncontradoError } from '../../domain/errores';
import type {
  ProductoConUbicacion,
  ProductoEnUbicacion,
  ProductoLeido,
} from '../ports/repositorio-de-recetas.port';
import type { DependenciasDeRecetas } from './recetas';

export class LeerProducto {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {ProductoNoEncontradoError} — también si es de otra company: la misma respuesta */
  public async ejecutar(sesion: SesionActiva, productId: ProductId): Promise<ProductoLeido> {
    const producto = await this.deps.repositorio.buscarProducto({ companyId: sesion.companyId, productId });
    if (producto === null) {
      throw new ProductoNoEncontradoError();
    }
    return producto;
  }
}

export class UbicacionesDeProducto {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {ProductoNoEncontradoError} */
  public async ejecutar(sesion: SesionActiva, productId: ProductId): Promise<readonly ProductoEnUbicacion[]> {
    const [producto, ubicaciones] = await Promise.all([
      this.deps.repositorio.buscarProducto({ companyId: sesion.companyId, productId }),
      this.deps.repositorio.ubicacionesDe({ companyId: sesion.companyId, productId }),
    ]);
    if (producto === null) {
      throw new ProductoNoEncontradoError();
    }

    const { alcance } = sesion;
    return alcance.clase === 'company'
      ? ubicaciones
      : ubicaciones.filter((u) => alcance.ids.includes(u.locationId));
  }
}

/** Un producto tal como está en la carta de una ubicación, con su nombre. */
export interface ProductoDeLaCarta extends ProductoConUbicacion {
  readonly nombre: string;
  readonly tipo: string;
  readonly categoria: string | null;
}

export class ProductosDeUbicacion {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /**
   * Solo los productos CONFIGURADOS en esa ubicación —con fila en
   * `product_location`, activos o no—, por nombre. Un producto sin fila no está
   * en esa carta y no se puede cargar su venta.
   */
  public async ejecutar(sesion: SesionActiva, locationId: LocationId): Promise<readonly ProductoDeLaCarta[]> {
    exigirUbicacionEnAlcance(sesion, locationId);

    const [productos, enUbicacion] = await Promise.all([
      this.deps.repositorio.listarProductos(sesion.companyId),
      this.deps.repositorio.productosEnUbicacion({ companyId: sesion.companyId, locationId }),
    ]);
    const configurados = new Map(enUbicacion.map((p) => [p.productId, p]));

    return productos.flatMap((producto) => {
      const configuracion = configurados.get(producto.id);
      return configuracion === undefined
        ? []
        : [{ ...configuracion, nombre: producto.nombre, tipo: producto.tipo, categoria: producto.categoria }];
    });
  }
}
