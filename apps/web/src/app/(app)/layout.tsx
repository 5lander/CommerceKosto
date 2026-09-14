/**
 * El grupo de rutas de la aplicación autenticada — U1, el patrón de Commerce.
 *
 * **LO PÚBLICO QUEDA FUERA** (`/entrar`, `/sucursal`): allí no se pide la sesión
 * ni se pinta la barra. Dentro, los permisos se leen una vez y el armazón envuelve
 * cada sección.
 *
 * **`Suspense` NO ES OPCIONAL**: el mes vive en la URL (D-16.5) y se lee con
 * `useSearchParams`, que en una página que se genera estática exige un límite de
 * suspensión o `next build` falla.
 */

import { Suspense } from 'react';
import type { ReactNode } from 'react';

import { Armazon } from '../../componentes/armazon/Armazon';
import { Cargando } from '../../componentes/ui/Estados';
import { ProveedorDePermisos } from '../../lib/permisos';

export default function LayoutDeLaAplicacion({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ProveedorDePermisos>
      <Suspense fallback={<Cargando />}>
        <Armazon>{children}</Armazon>
      </Suspense>
    </ProveedorDePermisos>
  );
}
