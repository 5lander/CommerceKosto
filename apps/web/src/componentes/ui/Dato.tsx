import type { ReactNode } from 'react';

/**
 * Un dato de una ficha: la etiqueta encima y el valor debajo, dentro de un
 * `<dl className="datos">`. Lo usan la ficha del insumo y la del producto.
 */
export function Dato({ etiqueta, valor }: { readonly etiqueta: string; readonly valor: string }): ReactNode {
  return (
    <div className="dato">
      <dt className="etiqueta">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
