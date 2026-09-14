'use client';

/**
 * El mes, en la cabecera de las secciones que trabajan sobre uno — D-16.5.
 *
 * **DOS `select` Y NO `<input type="month">`**: Firefox de escritorio no lo
 * implementa y lo degrada a un campo de texto donde hay que escribir `2026-09`.
 *
 * **LOS AÑOS SON LOS CINCO ÚLTIMOS**, más el de la URL si viene de otro: un
 * enlace guardado a un mes antiguo tiene que seguir mostrándose tal cual.
 */

import type { ReactNode } from 'react';

import { mesDeHoy, mesDeTexto } from '../../lib/fechas';
import { usePeriodo } from '../../lib/periodo';
import { TEXTOS } from '../../textos/es';

const ANIOS_HACIA_ATRAS = 4;

function aniosElegibles(anioElegido: number): readonly number[] {
  const actual = mesDeHoy().anio;
  const recientes = Array.from({ length: ANIOS_HACIA_ATRAS + 1 }, (_, indice) => actual - indice);
  return recientes.includes(anioElegido) ? recientes : [anioElegido, ...recientes];
}

export function SelectorDeMes(): ReactNode {
  const { periodo, elegir } = usePeriodo();

  function cambiar(anio: string, mes: string): void {
    const elegido = mesDeTexto(anio, mes);
    if (elegido !== null) elegir(elegido);
  }

  return (
    <div className="selector-compacto">
      <span className="etiqueta">{TEXTOS.periodo.mes}</span>
      <select
        aria-label={TEXTOS.periodo.mes}
        value={String(periodo.mes)}
        onChange={(evento) => {
          cambiar(String(periodo.anio), evento.target.value);
        }}
      >
        {TEXTOS.periodo.meses.map((nombre, indice) => (
          <option key={nombre} value={String(indice + 1)}>
            {nombre}
          </option>
        ))}
      </select>
      <select
        aria-label={TEXTOS.periodo.anio}
        value={String(periodo.anio)}
        onChange={(evento) => {
          cambiar(evento.target.value, String(periodo.mes));
        }}
      >
        {aniosElegibles(periodo.anio).map((anio) => (
          <option key={anio} value={String(anio)}>
            {anio}
          </option>
        ))}
      </select>
    </div>
  );
}
