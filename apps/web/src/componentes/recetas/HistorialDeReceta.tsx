'use client';

/**
 * Pantalla 15 — las versiones de una receta en una sucursal, la más nueva arriba.
 *
 * **ES SOLO LECTURA, Y ESE ES EL PUNTO.** La receta se edita en la pantalla 14 y
 * guardar crea una versión (SPEC §9); aquí se ve qué se cambió y desde cuándo,
 * que es lo que hace auditable un costo de hace tres meses. No hay «restaurar»:
 * volver a una receta anterior es guardarla otra vez, con su fecha y su nota,
 * y así queda escrito quién la devolvió y cuándo.
 *
 * **LAS MARCAS SALEN DE COMPARAR IDENTIFICADORES**, nunca de mirar una fecha
 * contra «hoy»: cuál manda lo responde la API (ver `versiones.ts`).
 */

import type { ReactNode } from 'react';

import { sinCerosDeSobra } from '../../lib/decimales';
import { comoFecha } from '../../lib/fechas';
import { TEXTOS } from '../../textos/es';
import { Pildora } from '../ui/Pildora';
import { Tabla } from '../ui/Tabla';
import type { InsumoParaReceta, LineaLeida } from './receta';
import type { HistorialDeReceta as Historial, VersionLeida } from './versiones';

/** Una versión sin líneas activas no costea nada: dice «aquí no hay receta». */
const SIN_RECETA = 'VOID';
const EXCLUIDA = 'INACTIVA';

export function HistorialDeReceta({ datos }: { readonly datos: Historial }): ReactNode {
  const texto = TEXTOS.versionesDeReceta;
  const hayFutura = datos.ultimaVersionId !== null && datos.ultimaVersionId !== datos.vigenteId;

  return (
    <div className="pila">
      <div className="pila pila--minima">
        {datos.vigenteId === null && <p className="nota atencion">{texto.hoySinReceta}</p>}
        {hayFutura && <p className="nota atencion">{texto.hayFutura}</p>}
      </div>
      {datos.versiones.map((version) => (
        <VersionDeReceta key={version.id} version={version} datos={datos} />
      ))}
    </div>
  );
}

function VersionDeReceta({ version, datos }: { readonly version: VersionLeida; readonly datos: Historial }): ReactNode {
  const texto = TEXTOS.versionesDeReceta;

  return (
    <section className="panel panel--relleno pila pila--apretada">
      <div className="linea">
        <h2 className="subtitulo">{`${texto.desde} ${comoFecha(version.validFrom)}`}</h2>
        <MarcasDeVersion version={version} datos={datos} />
      </div>
      <p className="nota">{version.nota === null ? texto.sinNota : `${texto.nota}: ${version.nota}`}</p>
      {version.lineas.length === 0 ? (
        <p className="nota atencion">{texto.sinLineas}</p>
      ) : (
        <LineasDeVersion lineas={version.lineas} insumos={datos.insumos} />
      )}
    </section>
  );
}

function MarcasDeVersion({ version, datos }: { readonly version: VersionLeida; readonly datos: Historial }): ReactNode {
  const texto = TEXTOS.versionesDeReceta;

  return (
    <div className="linea">
      {version.id === datos.vigenteId && <Pildora tono="bien" texto={texto.mandaHoy} />}
      {version.id === datos.ultimaVersionId && version.id !== datos.vigenteId && (
        <Pildora tono="atencion" texto={texto.masNueva} />
      )}
      {version.estado === SIN_RECETA && <Pildora tono="neutro" texto={texto.sinReceta} />}
    </div>
  );
}

function LineasDeVersion({
  lineas,
  insumos,
}: {
  readonly lineas: readonly LineaLeida[];
  readonly insumos: ReadonlyMap<string, InsumoParaReceta>;
}): ReactNode {
  const texto = TEXTOS.versionesDeReceta;

  return (
    <Tabla compacta>
      <thead>
        <tr>
          <th>{texto.insumo}</th>
          <th className="numero">{texto.cantidad}</th>
          <th className="izquierda">{texto.base}</th>
        </tr>
      </thead>
      <tbody>
        {lineas.map((linea) => (
          <LineaDeVersion key={linea.itemId} linea={linea} insumo={insumos.get(linea.itemId)} />
        ))}
      </tbody>
    </Tabla>
  );
}

function LineaDeVersion({
  linea,
  insumo,
}: {
  readonly linea: LineaLeida;
  readonly insumo: InsumoParaReceta | undefined;
}): ReactNode {
  const texto = TEXTOS.versionesDeReceta;
  const unidad = insumo === undefined ? '' : ` ${insumo.unidadDeUso}`;

  return (
    <tr>
      <td>
        {insumo?.nombre ?? TEXTOS.comun.sinDato}
        {linea.estado === EXCLUIDA && <span className="nota"> · {texto.excluida}</span>}
      </td>
      <td className="numero">{`${sinCerosDeSobra(linea.cantidad)}${unidad}`}</td>
      <td className="izquierda">{TEXTOS.receta.bases[linea.base]}</td>
    </tr>
  );
}
