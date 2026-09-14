'use client';

/**
 * Recorrer una rejilla de captura sin tocar el ratón.
 *
 * Enter y las flechas mueven de fila; Tab lo hace solo el navegador. Es lo que
 * convierte la rejilla de ventas y la hoja de conteo en algo que se llena de un
 * tirón: la mano no sale del teclado numérico (CLAUDE.md §10).
 */

import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

const BAJA = new Set(['Enter', 'ArrowDown']);
const SUBE = 'ArrowUp';

export interface CeldaDeRejilla {
  readonly ref: (elemento: HTMLInputElement | null) => void;
  readonly onKeyDown: (evento: KeyboardEvent<HTMLInputElement>) => void;
}

function salto(tecla: string): number {
  if (tecla === SUBE) return -1;
  return BAJA.has(tecla) ? 1 : 0;
}

/** Devuelve, para la fila `indice`, lo que su casilla necesita para moverse. */
export function useRejilla(): (indice: number) => CeldaDeRejilla {
  const campos = useRef<(HTMLInputElement | null)[]>([]);

  return useCallback(
    (indice: number): CeldaDeRejilla => ({
      ref: (elemento) => {
        campos.current[indice] = elemento;
      },
      onKeyDown: (evento) => {
        const paso = salto(evento.key);
        if (paso === 0) return;
        evento.preventDefault();
        campos.current[indice + paso]?.focus();
      },
    }),
    [],
  );
}
