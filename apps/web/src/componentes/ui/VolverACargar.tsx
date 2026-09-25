import type { ReactNode } from 'react';

import { CONFLICTO_DE_VERSION } from '../../lib/api';
import type { Envio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';

/**
 * El botón que aparece junto al 409 `CONFLICTO_DE_VERSION` (ADR-023).
 *
 * **NO REINTENTA: VUELVE A LEER.** Otra persona guardó entre medias; mandar lo
 * mismo con la versión nueva pisaría lo suyo sin haberlo visto. El mensaje de la
 * API ya está encima, en el formulario.
 */
export function VolverACargar({ envio, recargar }: { readonly envio: Envio; readonly recargar: () => void }): ReactNode {
  if (envio.codigo !== CONFLICTO_DE_VERSION) return null;

  return (
    <button type="button" onClick={recargar}>
      {TEXTOS.insumo.volverACargar}
    </button>
  );
}
