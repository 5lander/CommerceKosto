'use client';

/**
 * Lo que una sección enseña según el permiso de la sesión — D-16.6.
 *
 * **SIN PERMISO, UN ESTADO EN SITIO, NO UNA REDIRECCIÓN.** Quien abre un enlace
 * que no puede ver entiende por qué no ve nada; mandarlo a otra pantalla le quita
 * el contexto (lo que hace Commerce, y se descartó).
 *
 * **CARGANDO TAMBIÉN ES «NO»**: mientras no han llegado los permisos no se pinta
 * la sección, así que ninguna pantalla lanza su lectura antes de saber si puede.
 * Si la sesión no se pudo leer, el armazón ya enseña el error.
 */

import type { ReactNode } from 'react';

import { usePermisos } from '../../lib/permisos';
import { TEXTOS } from '../../textos/es';
import { Cargando, Vacio } from '../ui/Estados';

export function Permitido({
  permiso,
  children,
}: {
  readonly permiso: string;
  readonly children: ReactNode;
}): ReactNode {
  const { estado, tiene } = usePermisos();

  if (estado !== 'lista') return <Cargando />;
  if (!tiene(permiso)) {
    return <Vacio titulo={TEXTOS.comun.sinPermiso} ayuda={TEXTOS.comun.sinPermisoAyuda} />;
  }
  return children;
}

/**
 * El `layout.tsx` de una sección, en una línea: `export default seccion('costing.read')`.
 *
 * **UNA FÁBRICA Y NO TREINTA COPIAS**: el mismo componente de ocho líneas en cada
 * sección es exactamente el clon que `audit:duplication` para.
 */
export function seccion(permiso: string): (props: { readonly children: ReactNode }) => ReactNode {
  function LayoutDeSeccion({ children }: { readonly children: ReactNode }): ReactNode {
    return <Permitido permiso={permiso}>{children}</Permitido>;
  }
  return LayoutDeSeccion;
}
