'use client';

/**
 * Los filtros del libro: insumo, tipo y rango de fechas.
 *
 * **SE APLICAN AL SOLTARLOS, SIN BOTÓN «Buscar».** Cada cambio es una consulta
 * nueva a la API con su propio `useCarga`, así que la página vuelve a leer con el
 * filtro puesto y la respuesta de la consulta anterior se descarta sola.
 *
 * **LAS FECHAS VAN AL MEDIODÍA UTC** (D-16.4, INC-013): a medianoche, en
 * Guayaquil sería el día anterior y «desde el 1» se comería el día 1. La
 * conversión está en `consultaDelLibro`, no aquí: esto solo recoge el día.
 */

import type { ReactNode } from 'react';

import { TEXTOS } from '../../textos/es';
import { CampoDeTexto } from '../ui/Campo';
import { Selector, type Opcion } from '../ui/Selector';
import { SIN_FILTRO, TIPOS_DE_MOVIMIENTO, type Filtros, type InsumoDelLibro } from './libro';

export const FILTROS_VACIOS: Filtros = { itemId: SIN_FILTRO, tipo: SIN_FILTRO, desde: SIN_FILTRO, hasta: SIN_FILTRO };

export function FiltrosDelLibro({
  filtros,
  insumos,
  cambiar,
}: {
  readonly filtros: Filtros;
  readonly insumos: readonly InsumoDelLibro[];
  readonly cambiar: (filtros: Filtros) => void;
}): ReactNode {
  const conFiltro = Object.values(filtros).some((valor) => valor !== SIN_FILTRO);

  return (
    <section className="panel panel--relleno pila pila--apretada">
      <CamposDelLibro filtros={filtros} insumos={insumos} cambiar={cambiar} />
      {conFiltro && (
        <div>
          <button
            type="button"
            onClick={() => {
              cambiar(FILTROS_VACIOS);
            }}
          >
            {TEXTOS.movimientos.limpiar}
          </button>
        </div>
      )}
    </section>
  );
}

function CamposDelLibro({
  filtros,
  insumos,
  cambiar,
}: {
  readonly filtros: Filtros;
  readonly insumos: readonly InsumoDelLibro[];
  readonly cambiar: (filtros: Filtros) => void;
}): ReactNode {
  const texto = TEXTOS.movimientos;

  return (
    <div className="filtros">
      <Selector
        etiqueta={texto.insumo}
        valor={filtros.itemId}
        opciones={opcionesDeInsumos(insumos)}
        cambiar={(itemId) => {
          cambiar({ ...filtros, itemId });
        }}
      />
      <Selector
        etiqueta={texto.tipo}
        valor={filtros.tipo}
        opciones={opcionesDeTipos()}
        cambiar={(tipo) => {
          cambiar({ ...filtros, tipo });
        }}
      />
      <RangoDeFechas filtros={filtros} cambiar={cambiar} />
    </div>
  );
}

/** El desde y el hasta, juntos porque son un rango: uno sin el otro no es media respuesta. */
function RangoDeFechas({
  filtros,
  cambiar,
}: {
  readonly filtros: Filtros;
  readonly cambiar: (filtros: Filtros) => void;
}): ReactNode {
  const texto = TEXTOS.movimientos;

  return (
    <>
      <CampoDeTexto
        etiqueta={texto.desde}
        nombre="desde"
        tipo="date"
        valor={filtros.desde}
        cambiar={(desde) => {
          cambiar({ ...filtros, desde });
        }}
      />
      <CampoDeTexto
        etiqueta={texto.hasta}
        nombre="hasta"
        tipo="date"
        valor={filtros.hasta}
        cambiar={(hasta) => {
          cambiar({ ...filtros, hasta });
        }}
      />
    </>
  );
}

function opcionesDeInsumos(insumos: readonly InsumoDelLibro[]): readonly Opcion[] {
  return [
    { valor: SIN_FILTRO, texto: TEXTOS.movimientos.todosLosInsumos },
    ...insumos.map((insumo) => ({ valor: insumo.id, texto: insumo.nombre })),
  ];
}

function opcionesDeTipos(): readonly Opcion[] {
  const texto = TEXTOS.movimientos;
  return [
    { valor: SIN_FILTRO, texto: texto.todosLosTipos },
    ...TIPOS_DE_MOVIMIENTO.map((tipo) => ({ valor: tipo, texto: texto.tipos[tipo] ?? tipo })),
  ];
}
