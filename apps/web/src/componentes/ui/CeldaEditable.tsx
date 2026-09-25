import type { ReactNode } from 'react';

import type { CeldaDeRejilla } from '../../lib/rejilla';

/**
 * La casilla de una rejilla de captura: ventas del mes y hoja de conteo.
 *
 * **TEXTO, NO `type="number"`.** Un campo numérico del navegador acepta `1e3`,
 * cambia el valor con la rueda del ratón y en algunos teclados no deja escribir
 * la coma decimal. La forma la valida quien la usa; la cifra, la API.
 */
export function CeldaEditable({
  celda,
  etiqueta,
  valor,
  modo,
  bloqueada = false,
  escribir,
}: {
  readonly celda: CeldaDeRejilla;
  readonly etiqueta: string;
  readonly valor: string;
  readonly modo: 'numeric' | 'decimal';
  readonly bloqueada?: boolean;
  readonly escribir: (crudo: string) => void;
}): ReactNode {
  return (
    <input
      ref={celda.ref}
      onKeyDown={celda.onKeyDown}
      className="celda-editable"
      type="text"
      inputMode={modo}
      autoComplete="off"
      disabled={bloqueada}
      aria-label={etiqueta}
      value={valor}
      onChange={(evento) => {
        escribir(evento.target.value);
      }}
    />
  );
}
