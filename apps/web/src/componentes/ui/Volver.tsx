import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';

import { TEXTOS } from '../../textos/es';

/**
 * «← Volver» a la pantalla de la que se viene — U1, como Commerce.
 *
 * **UN ENLACE A UNA RUTA, NO `history.back()`**: quien abrió la ficha desde un
 * enlace guardado no tiene «atrás», y volver tiene que llevar al listado igual.
 */
export function Volver({ href }: { readonly href: Route }): ReactNode {
  return (
    <Link href={href} className="enlace">
      ← {TEXTOS.comun.volver}
    </Link>
  );
}
