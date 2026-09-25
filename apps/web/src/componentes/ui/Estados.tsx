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
 *
 * **P14 los movió a `ui/`** porque son apariencia y nada más: los tres se pueden
 * reescribir enteros sin que ninguna pantalla cambie de comportamiento, que es
 * exactamente lo que la tabla de CLAUDE.md §10 dice de esta capa.
 */

import type { ReactNode } from 'react';

import { TEXTOS } from '../../textos/es';

export function Cargando(): ReactNode {
  return (
    <p role="status" className="nota">
      {TEXTOS.comun.cargando}
    </p>
  );
}

/**
 * El estado vacío, con su explicación.
 *
 * **Siempre dos frases: qué pasa y qué hacer.** «No hay datos» no es un estado
 * vacío, es una constatación. «Todavía no hay ventas cargadas para este mes ·
 * Carga las unidades y aquí verás la matriz» sí dice qué hacer. Es la misma
 * regla que el manual de marca llama «Práctica, no simplona»: nunca informar de
 * un problema sin decir qué hacer con él.
 */
export function Vacio({ titulo, ayuda }: { readonly titulo: string; readonly ayuda: string }): ReactNode {
  return (
    <div className="panel panel--pendiente pila pila--minima">
      <p className="subtitulo">{titulo}</p>
      <p className="nota">{ayuda}</p>
    </div>
  );
}

/**
 * El error, con la salida.
 *
 * El mensaje llega del backend y **ya está escrito para leerse**: sale del
 * dominio, en español y sin nombres de tabla. Lo que añade esta pantalla es el
 * botón de volver a intentar, que es lo que la persona quiere hacer.
 *
 * Sin fondo teñido: una cinta al costado en el color de la pérdida. Un bloque
 * de color de lado a lado rompería la cuota de superficie que el manual le da a
 * esos colores, y grita donde basta con señalar.
 */
export function Error({
  mensaje,
  reintentar,
}: {
  readonly mensaje: string;
  readonly reintentar?: () => void;
}): ReactNode {
  return (
    <div role="alert" className="aviso pila pila--apretada">
      <p>{mensaje}</p>
      {reintentar !== undefined && (
        <div>
          <button type="button" onClick={reintentar}>
            {TEXTOS.comun.reintentar}
          </button>
        </div>
      )}
    </div>
  );
}
