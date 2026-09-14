'use client';

/**
 * Una escritura a la API con su estado: ocupada y, si falló, por qué.
 *
 * **EL ERROR NO SE TRAGA: SE ENSEÑA.** `enviar` captura el fallo para ponerlo en
 * pantalla con el mensaje del backend, que ya viene escrito para leerse; no para
 * esconderlo. Y devuelve si salió bien, para que quien llama decida qué hacer
 * después —recargar, confirmar— sin un segundo `try`.
 *
 * **LO QUE SE ESCRIBIÓ NO SE PIERDE AL FALLAR.** El estado de lo que se estaba
 * capturando vive en la pantalla, no aquí: un 409 o una red caída dejan la hoja
 * como estaba.
 */

import { useCallback, useState } from 'react';

import { mensajeDe } from './api';

export interface Envio {
  readonly ocupado: boolean;
  readonly error: string | null;
  readonly enviar: (accion: () => Promise<void>) => Promise<boolean>;
}

export function useEnvio(): Envio {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = useCallback(async (accion: () => Promise<void>): Promise<boolean> => {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      return true;
    } catch (fallo) {
      setError(mensajeDe(fallo));
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);

  return { ocupado, error, enviar };
}
