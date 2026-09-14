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
