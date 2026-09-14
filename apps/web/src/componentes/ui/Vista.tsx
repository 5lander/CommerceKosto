import type { ReactNode } from 'react';

import type { Lectura } from '../../lib/useLectura';
import { TEXTOS } from '../../textos/es';
import { Cargando, Error as Fallo, Vacio } from './Estados';

/** El código con el que las vistas del mes dicen «este mes no se ha abierto» (D-16.2). */
const PERIODO_SIN_DATOS = 'PERIODO_SIN_DATOS';

/**
 * Los cuatro estados de una lectura, siempre en el mismo orden: error, cargando,
 * vacío y datos. Una pantalla que lee una sola cosa no vuelve a escribirlos.
 *
 * **UN MES SIN ABRIR NO SE PINTA COMO ERROR** (D-16.2). La API lo devuelve como
 * 404 con su propio código, y lo que corresponde enseñar no es una cinta roja
 * sino que ese mes todavía no tiene datos.
 */
export function Vista<T>({
  lectura,
  esVacio,
  vacio,
  children,
}: {
  readonly lectura: Lectura<T>;
  readonly esVacio: (datos: T) => boolean;
  readonly vacio: { readonly titulo: string; readonly ayuda: string };
  readonly children: (datos: T) => ReactNode;
}): ReactNode {
  if (lectura.codigo === PERIODO_SIN_DATOS) {
    return <Vacio titulo={TEXTOS.comun.mesSinAbrir} ayuda={TEXTOS.comun.mesSinAbrirAyuda} />;
  }
  if (lectura.error !== null) return <Fallo mensaje={lectura.error} reintentar={lectura.recargar} />;
  if (lectura.datos === null) return <Cargando />;
  if (esVacio(lectura.datos)) return <Vacio titulo={vacio.titulo} ayuda={vacio.ayuda} />;
  return children(lectura.datos);
}
