/**
 * El registro único de navegación — U1.
 *
 * **UNA ENTRADA POR SECCIÓN, Y DE AQUÍ SALEN TRES COSAS**: la barra lateral, el
 * permiso que muestra cada enlace y si la sección enseña el selector de mes. El
 * `layout.tsx` de cada sección repite su permiso con `seccion(...)`, y los dos
 * sitios se leen juntos al añadir una pantalla.
 *
 * **SOLO RUTAS QUE EXISTEN.** Con `typedRoutes`, un `href` sin carpeta no compila;
 * y un enlace a una pantalla que no está —el «Pronto» de Commerce— es una promesa
 * que nadie ha hecho. Cada pantalla nueva entra aquí en el commit que la crea.
 *
 * **EL PERMISO ES EL DE LEER LA SECCIÓN**, el mismo que exige su endpoint
 * principal. Ocultar el enlace no protege nada (el 403 de la API sí): evita
 * ofrecer una puerta que va a dar «no tienes acceso».
 */

import type { Route } from 'next';

import { TEXTOS } from '../../textos/es';

export interface EntradaDeNavegacion {
  readonly href: Route;
  readonly texto: string;
  readonly permiso: string;
  /** Si la sección trabaja sobre un mes: enseña el selector y lo arrastra en el enlace. */
  readonly conMes: boolean;
}

export interface GrupoDeNavegacion {
  readonly titulo: string;
  readonly entradas: readonly EntradaDeNavegacion[];
}

export const NAVEGACION: readonly GrupoDeNavegacion[] = [
  {
    titulo: TEXTOS.navegacion.general,
    entradas: [
      // `replenishment.read` lo tienen todos los roles: Inicio es de todos, y la
      // página enseña el resumen o la reposición según lo que la sesión lee.
      { href: '/inicio', texto: TEXTOS.inicio.titulo, permiso: 'replenishment.read', conMes: true },
    ],
  },
  {
    titulo: TEXTOS.navegacion.catalogo,
    entradas: [
      { href: '/insumos', texto: TEXTOS.insumos.titulo, permiso: 'catalog.read', conMes: false },
      { href: '/grupos', texto: TEXTOS.grupos.titulo, permiso: 'catalog.read', conMes: false },
      { href: '/precios', texto: TEXTOS.precios.titulo, permiso: 'pricing.read', conMes: false },
    ],
  },
  {
    titulo: TEXTOS.navegacion.carta,
    entradas: [{ href: '/productos', texto: TEXTOS.productos.titulo, permiso: 'product.read', conMes: false }],
  },
  {
    titulo: TEXTOS.navegacion.analisis,
    entradas: [
      { href: '/costeo', texto: TEXTOS.costeo.titulo, permiso: 'costing.read', conMes: false },
      { href: '/menu', texto: TEXTOS.menu.titulo, permiso: 'analytics.read', conMes: true },
    ],
  },
  {
    titulo: TEXTOS.navegacion.operacion,
    entradas: [
      { href: '/ventas', texto: TEXTOS.ventas.titulo, permiso: 'sales.read', conMes: true },
      // DOS ENTRADAS PARA LA MISMA SECCIÓN, Y NO ES UN DESCUIDO: BODEGA tiene
      // `inventory.write` y NO `inventory.read` —del libro se despeja el consumo
      // teórico, y de ahí la receta (§4.3)—, así que ve «Registrar» y no el libro.
      //
      // «Registrar» VA PRIMERO a propósito: `entradaDe` devuelve la primera
      // entrada que casa, y con el libro delante `/movimientos/nuevo` caería en
      // la sección de `inventory.read`, que es justo la que BODEGA no tiene.
      { href: '/movimientos/nuevo', texto: TEXTOS.movimientoNuevo.enlace, permiso: 'inventory.write', conMes: false },
      { href: '/movimientos', texto: TEXTOS.movimientos.titulo, permiso: 'inventory.read', conMes: false },
      // Transferir lo hace BODEGA; producir, no: el alta de un lote entra al costo
      // estandar (R10) y esa es una decision de costeo, no de almacen.
      { href: '/transferencias/nueva', texto: TEXTOS.transferencia.enlace, permiso: 'inventory.transfer', conMes: false },
      { href: '/producciones/nueva', texto: TEXTOS.produccion.enlace, permiso: 'inventory.produce', conMes: false },
      // La hoja de conteo pide `count.write`, que BODEGA tiene: cuenta a ciegas.
      { href: '/inventario', texto: TEXTOS.inventario.titulo, permiso: 'count.write', conMes: true },
    ],
  },
];

/** La entrada de la sección en la que está una ruta, incluidas sus subpáginas. */
export function entradaDe(ruta: string): EntradaDeNavegacion | undefined {
  return NAVEGACION.flatMap((grupo) => grupo.entradas).find(
    (entrada) => ruta === entrada.href || ruta.startsWith(`${entrada.href}/`),
  );
}
