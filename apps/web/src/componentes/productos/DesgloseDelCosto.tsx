import type { ReactNode } from 'react';

import { comoPorcentaje, sinCerosDeSobra } from '../../lib/decimales';
import { TEXTOS } from '../../textos/es';
import type { LineaDeCosto } from '../costeo/tipos';
import { Tabla } from '../ui/Tabla';
import type { InsumoDelCatalogo } from './ficha';

/**
 * De qué está hecho el costo del lote: una fila por línea de la receta, en su
 * orden (SPEC §13).
 *
 * **SOLO LLEGA CON `recipe.read`** (D-16.106): las cantidades son la receta
 * misma (§4.3). Sin el permiso la API manda `null` y este componente no se monta.
 *
 * **LA UNIDAD SALE DEL CATÁLOGO**: la línea trae cuánto lleva, no en qué; «0.12»
 * sin «kg» no dice nada. Una línea excluida se enseña, atenuada y dicha: no suma,
 * pero sigue en la receta.
 */
export function DesgloseDelCosto({
  lineas,
  insumos,
}: {
  readonly lineas: readonly LineaDeCosto[];
  readonly insumos: readonly InsumoDelCatalogo[];
}): ReactNode {
  const texto = TEXTOS.productoDeVenta;
  const unidades = new Map(insumos.map((insumo) => [insumo.id, insumo.unidadDeUso]));
  if (lineas.length === 0) return null;

  return (
    <div className="pila pila--apretada">
      <h3 className="subtitulo">{texto.desglose}</h3>
      <Tabla compacta>
        <thead>
          <tr>
            <th>{texto.insumo}</th>
            <th>{texto.cantidad}</th>
            <th className="izquierda">{texto.base}</th>
            <th>{texto.costo}</th>
            <th>{texto.participacion}</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((linea, posicion) => (
            // Un mismo insumo puede ir dos veces en una receta: la posición desempata.
            <FilaDelDesglose key={`${linea.itemId}-${String(posicion)}`} linea={linea} unidad={unidades.get(linea.itemId) ?? ''} />
          ))}
        </tbody>
      </Tabla>
    </div>
  );
}

function FilaDelDesglose({ linea, unidad }: { readonly linea: LineaDeCosto; readonly unidad: string }): ReactNode {
  const texto = TEXTOS.productoDeVenta;
  const excluida = linea.estado === 'INACTIVA';

  return (
    <tr className={excluida ? 'tenue' : undefined}>
      <td>
        {linea.nombre}
        {excluida && <span className="bloque tenue">{texto.excluida}</span>}
      </td>
      <td className="numero">{`${sinCerosDeSobra(linea.cantidad)} ${unidad}`.trim()}</td>
      <td className="izquierda">{linea.base}</td>
      <td className="numero">{linea.costo.mostrar}</td>
      <td className="numero">{comoPorcentaje(linea.participacion)}</td>
    </tr>
  );
}
