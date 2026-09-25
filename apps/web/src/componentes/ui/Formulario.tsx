import type { ReactNode, SyntheticEvent } from 'react';

import type { Envio } from '../../lib/useEnvio';
import { Error as Fallo } from './Estados';

/**
 * Un formulario de alta o edición: los campos, el error de la API y el botón.
 *
 * **EL ERROR VA JUNTO AL BOTÓN**, no arriba de la página: es donde se está
 * mirando cuando se pulsa, y el mensaje del backend ya dice qué corregir.
 *
 * **EL BOTÓN SE BLOQUEA MIENTRAS SE ENVÍA**: un doble toque en un teléfono daría
 * dos altas, y la segunda un 409 que nadie entendería.
 */
export function Formulario({
  envio,
  alEnviar,
  textoDelBoton,
  textoEnviando,
  children,
}: {
  readonly envio: Envio;
  readonly alEnviar: () => Promise<void>;
  readonly textoDelBoton: string;
  readonly textoEnviando: string;
  readonly children: ReactNode;
}): ReactNode {
  function enviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    void alEnviar();
  }

  return (
    <form className="pila pila--apretada formulario" onSubmit={enviar}>
      {children}
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      <div>
        <button type="submit" data-variante="primario" disabled={envio.ocupado}>
          {envio.ocupado ? textoEnviando : textoDelBoton}
        </button>
      </div>
    </form>
  );
}
