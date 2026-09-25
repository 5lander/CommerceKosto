import type { ReactNode } from 'react';

import type { Envio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Error as Fallo } from './Estados';

/**
 * La confirmación en línea — U1, como Commerce: la pregunta aparece donde estaba
 * el botón, no en una ventana que tapa lo que se está decidiendo.
 *
 * **LA PREGUNTA DICE QUÉ PASA**, no «¿Estás seguro?»: quien archiva un insumo
 * tiene que leer qué cambia y qué no, no adivinarlo.
 */
export function Confirmar({
  pregunta,
  textoConfirmar,
  envio,
  alConfirmar,
  alCancelar,
}: {
  readonly pregunta: string;
  readonly textoConfirmar: string;
  readonly envio: Envio;
  readonly alConfirmar: () => void;
  readonly alCancelar: () => void;
}): ReactNode {
  return (
    <div className="panel panel--relleno pila pila--apretada" role="group">
      <p>{pregunta}</p>
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      <div className="linea">
        <button type="button" data-variante="primario" disabled={envio.ocupado} onClick={alConfirmar}>
          {textoConfirmar}
        </button>
        <button type="button" disabled={envio.ocupado} onClick={alCancelar}>
          {TEXTOS.comun.cancelar}
        </button>
      </div>
    </div>
  );
}
