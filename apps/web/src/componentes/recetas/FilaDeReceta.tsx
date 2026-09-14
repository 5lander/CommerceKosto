import type { ReactNode } from 'react';

import { TEXTOS } from '../../textos/es';
import { CampoDeCantidad } from '../ui/CampoNumerico';
import { Casilla } from '../ui/Casilla';
import { Selector, type Opcion } from '../ui/Selector';

/** Una línea mientras se edita. `clave` es un contador, no el insumo (INC-026). */
export interface Fila {
  readonly clave: number;
  readonly itemId: string;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly excluida: boolean;
}

type Cambio = Partial<Omit<Fila, 'clave'>>;

interface PropiedadesDeFila {
  readonly fila: Fila;
  readonly opciones: readonly Opcion[];
  readonly unidad: string;
  readonly cambiar: (cambio: Cambio) => void;
  readonly quitar: () => void;
}

const BASES: readonly Opcion[] = [
  { valor: 'AP', texto: TEXTOS.receta.bases.AP },
  { valor: 'EP', texto: TEXTOS.receta.bases.EP },
];

/** Una línea de la receta: insumo, cuánto en su unidad de uso, AP o EP, y si está excluida. */
export function FilaDeReceta(propiedades: PropiedadesDeFila): ReactNode {
  const { fila, cambiar, quitar } = propiedades;
  const texto = TEXTOS.receta;

  return (
    <div className="panel panel--relleno pila pila--minima">
      <MedidaDeLaLinea {...propiedades} />
      <div className="linea linea--separada">
        <Casilla
          texto={texto.excluida}
          marcada={fila.excluida}
          cambiar={(excluida) => {
            cambiar({ excluida });
          }}
        />
        <button type="button" onClick={quitar}>
          {texto.quitar}
        </button>
      </div>
    </div>
  );
}

function MedidaDeLaLinea({ fila, opciones, unidad, cambiar }: PropiedadesDeFila): ReactNode {
  const texto = TEXTOS.receta;

  return (
    <div className="linea linea--base">
      <Selector
        etiqueta={texto.insumo}
        valor={fila.itemId}
        opciones={opciones}
        cambiar={(itemId) => {
          cambiar({ itemId });
        }}
      />
      <CampoDeCantidad
        etiqueta={`${texto.cantidad} (${unidad})`}
        nombre={`cantidad-${String(fila.clave)}`}
        requerido
        valor={fila.cantidad}
        cambiar={(cantidad) => {
          cambiar({ cantidad });
        }}
      />
      <Selector
        etiqueta={texto.base}
        valor={fila.base}
        opciones={BASES}
        cambiar={(base) => {
          cambiar({ base: base === 'EP' ? 'EP' : 'AP' });
        }}
      />
    </div>
  );
}
