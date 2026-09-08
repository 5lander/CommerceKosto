/**
 * El marco de una tabla — P14.
 *
 * **ES DELIBERADAMENTE PEQUEÑO.** Las cuatro pantallas con datos repetían este
 * mismo envoltorio —panel, desplazamiento horizontal, `<table>` con sus
 * clases— y cada una además su propio `Encabezado` y su propia `Celda`. Eso era
 * la misma apariencia escrita cuatro veces, que es lo que `audit:duplication`
 * existe para impedir y lo que hacía que cambiar el aspecto costara cuatro
 * archivos.
 *
 * Lo que NO hay aquí, a propósito, es un componente por celda: `global.css` ya
 * estiliza `.tabla th` y `.tabla td`, así que las páginas escriben `<th>` y
 * `<td>` de HTML y añaden `numero`, `bien`, `atencion` o `mal` cuando la celda
 * lleva cifra o estado. Un componente que solo pusiera una clase sería una capa
 * más sin nada dentro.
 *
 * El desplazamiento horizontal vive DENTRO del marco: una tabla de costeo con
 * ocho columnas no cabe en un teléfono, y lo que no puede pasar es que empuje
 * el cuerpo de la página y la pantalla entera se mueva de lado.
 */

import type { ReactNode } from 'react';

export function Tabla({
  compacta = false,
  children,
}: {
  readonly compacta?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="panel tabla-marco">
      <table className={compacta ? 'tabla tabla--compacta' : 'tabla'}>{children}</table>
    </div>
  );
}
