'use client';

/**
 * De qué producto y de qué sucursal habla una pantalla de receta.
 *
 * **EXISTE POR LA TERCERA REPETICIÓN, NO POR LA PRIMERA** (CLAUDE.md §3): el
 * mismo par de lecturas estaba en la receta, en sus versiones y en la
 * propagación, y `audit:duplication` lo cazó al tercer sitio.
 *
 * **Y PIDE EL PRODUCTO AUNQUE EL NOMBRE YA SE TENGA EN LA FICHA**: es lo que
 * convierte el id de otra company en un «no encontrado» en su sitio. Las
 * versiones o los destinos de un producto ajeno son una lista vacía —RLS hace su
 * trabajo en silencio— y una lista vacía no se distingue de un producto recién
 * creado. El 404 de `GET /productos/:id` sí.
 */

import { llamar } from '../../lib/api';
import type { Sucursal } from '../../lib/sesion';

export interface ContextoDelProducto {
  readonly nombre: string;
  readonly sucursal: string;
  /** Todas las sucursales de la company, por id: los nombres de un historial. */
  readonly sucursales: ReadonlyMap<string, string>;
}

export async function contextoDelProducto(productId: string, sucursal: string): Promise<ContextoDelProducto> {
  const [producto, sucursales] = await Promise.all([
    llamar<{ readonly nombre: string }>({ ruta: `/productos/${productId}` }),
    llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
  ]);

  return {
    nombre: producto.nombre,
    sucursal: sucursales.find((una) => una.id === sucursal)?.nombre ?? '',
    sucursales: new Map(sucursales.map((una) => [una.id, una.nombre])),
  };
}
