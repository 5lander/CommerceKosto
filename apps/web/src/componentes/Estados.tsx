/**
 * Los tres estados que toda vista tiene que saber pintar: cargando, vacío y
 * error. `CLAUDE.md` §10 los exige en todas.
 *
 * **ESTÁN AQUÍ PARA QUE NADIE SE LOS SALTE.** Escribir el estado vacío es lo
 * primero que se omite cuando hay prisa, y es justo lo que el cliente ve en su
 * primer minuto con el sistema: si ahí pone «[]» o una tabla en blanco, la
 * conclusión es que el sistema no funciona.
 *
 * Los textos salen de `textos/es.ts` (D11). Aquí no hay ni una frase escrita.
 */

import type { ReactNode } from 'react';

import { TEXTOS } from '../textos/es';

export function Cargando(): ReactNode {
  return (
    <p role="status" style={{ color: 'var(--color-texto-suave)', padding: 'var(--espacio-6)' }}>
      {TEXTOS.comun.cargando}
    </p>
  );
}

/**
 * El estado vacío, con su explicación.
 *
 * **Siempre dos frases: qué pasa y qué hacer.** «No hay datos» no es un estado
 * vacío, es una constatación. «Todavía no hay ventas cargadas para este mes ·
 * Carga las unidades y aquí verás la matriz» sí dice qué hacer.
 */
export function Vacio({ titulo, ayuda }: { readonly titulo: string; readonly ayuda: string }): ReactNode {
  return (
    <div
      style={{
        padding: 'var(--espacio-8)',
        textAlign: 'center',
        background: 'var(--color-superficie)',
        border: '1px dashed var(--color-borde-fuerte)',
        borderRadius: 'var(--radio-lg)',
      }}
    >
      <p style={{ margin: 0, fontSize: 'var(--texto-lg)' }}>{titulo}</p>
      <p style={{ margin: 'var(--espacio-2) 0 0', color: 'var(--color-texto-suave)' }}>{ayuda}</p>
    </div>
  );
}

/**
 * El error, con la salida.
 *
 * El mensaje llega del backend y **ya está escrito para leerse**: sale del
 * dominio, en español y sin nombres de tabla. Lo que añade esta pantalla es el
 * botón de volver a intentar, que es lo que la persona quiere hacer.
 */
export function Error({
  mensaje,
  reintentar,
}: {
  readonly mensaje: string;
  readonly reintentar?: () => void;
}): ReactNode {
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--espacio-6)',
        background: 'var(--color-mal-fondo)',
        border: '1px solid var(--color-mal)',
        borderRadius: 'var(--radio-lg)',
      }}
    >
      <p style={{ margin: 0, color: 'var(--color-mal)' }}>{mensaje}</p>
      {reintentar !== undefined && (
        <button type="button" onClick={reintentar} style={{ marginTop: 'var(--espacio-4)' }}>
          {TEXTOS.comun.reintentar}
        </button>
      )}
    </div>
  );
}
