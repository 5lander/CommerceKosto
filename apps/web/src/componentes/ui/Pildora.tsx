import type { ReactNode } from 'react';

/** Los tonos que existen: los tres del semáforo y el que no dice nada. */
export type Tono = 'bien' | 'atencion' | 'mal' | 'neutro';

/**
 * Un estado corto dentro de una tabla: «Vigente», «Sugerido», «Rechazado».
 *
 * **EL TONO LO PINTA `global.css`** desde `data-tono`, como el semáforo de los
 * indicadores: la pantalla dice qué estado es y la hoja de estilos de qué color.
 */
export function Pildora({ tono, texto }: { readonly tono: Tono; readonly texto: string }): ReactNode {
  return (
    <span className="pildora" data-tono={tono}>
      {texto}
    </span>
  );
}
