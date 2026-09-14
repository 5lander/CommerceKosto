import type { ReactNode } from 'react';

/**
 * Una cifra con su etiqueta y, si la API la juzgó, su color.
 *
 * El patrón es el del manual: etiqueta en Plex Mono versalita encima y la cifra
 * debajo. **EL COLOR NO LO DECIDE ESTE COMPONENTE**: recibe el semáforo que mandó
 * la API y lo pone en un atributo; `global.css` decide de qué color se pinta
 * cada uno, como con los cuadrantes del menú. `SIN_DATO` no es un nivel de
 * gravedad —es que no se pudo medir— y por eso no lleva color.
 */
export function Indicador({
  etiqueta,
  valor,
  semaforo,
  detalle,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly semaforo?: 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';
  readonly detalle?: string;
}): ReactNode {
  return (
    <div className="panel panel--relleno dato indicador" data-semaforo={semaforo}>
      <span className="etiqueta">{etiqueta}</span>
      <strong className="cifra cifra--menor">{valor}</strong>
      {detalle !== undefined && <span className="nota">{detalle}</span>}
    </div>
  );
}
