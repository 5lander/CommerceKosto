import type { ReactNode } from 'react';

/**
 * Una casilla de verificación con su texto al lado — «incluir archivados».
 *
 * **EL TEXTO ENVUELVE A LA CASILLA**, como en `CampoDeTexto`: pulsar la frase la
 * marca, y en un teléfono el objetivo táctil es la línea entera, no el cuadrito.
 */
export function Casilla({
  texto,
  marcada,
  cambiar,
}: {
  readonly texto: string;
  readonly marcada: boolean;
  readonly cambiar: (marcada: boolean) => void;
}): ReactNode {
  return (
    <label className="casilla">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(evento) => {
          cambiar(evento.target.checked);
        }}
      />
      {texto}
    </label>
  );
}
