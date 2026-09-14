import type { ReactNode } from 'react';

export interface Opcion {
  readonly valor: string;
  readonly texto: string;
}

/**
 * Una lista desplegable con su etiqueta — el grupo de un insumo, una unidad.
 *
 * **LOS VALORES SON CADENAS**, también los identificadores: un `<select>` solo
 * sabe de texto, y convertir por el camino es donde un id acaba siendo `NaN`.
 */
export function Selector({
  etiqueta,
  valor,
  opciones,
  cambiar,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly opciones: readonly Opcion[];
  readonly cambiar: (valor: string) => void;
}): ReactNode {
  return (
    <label className="campo">
      {etiqueta}
      <select
        value={valor}
        onChange={(evento) => {
          cambiar(evento.target.value);
        }}
      >
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.texto}
          </option>
        ))}
      </select>
    </label>
  );
}
