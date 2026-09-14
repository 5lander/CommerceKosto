import type { HTMLInputAutoCompleteAttribute, HTMLInputTypeAttribute, ReactNode } from 'react';

/**
 * Un campo de texto con su etiqueta — la primitiva de los formularios.
 *
 * **LA ETIQUETA ENVUELVE AL CAMPO**, y no va al lado con un `htmlFor`: así no hay
 * un identificador que inventar y mantener único en cada pantalla, y pulsar el
 * texto lleva el foco al campo igual.
 *
 * **CONTROLADO**: el valor vive en quien lo usa. La validación que decide es la
 * de la API (CLAUDE.md §10); lo que aquí se marca como requerido es ayuda.
 */
export function CampoDeTexto({
  etiqueta,
  nombre,
  valor,
  cambiar,
  tipo = 'text',
  autocompletar = 'off',
  requerido = false,
}: {
  readonly etiqueta: string;
  readonly nombre: string;
  readonly valor: string;
  readonly cambiar: (valor: string) => void;
  readonly tipo?: HTMLInputTypeAttribute;
  readonly autocompletar?: HTMLInputAutoCompleteAttribute;
  readonly requerido?: boolean;
}): ReactNode {
  return (
    <label className="campo">
      {etiqueta}
      <input
        type={tipo}
        name={nombre}
        autoComplete={autocompletar}
        required={requerido}
        value={valor}
        onChange={(evento) => {
          cambiar(evento.target.value);
        }}
      />
    </label>
  );
}
