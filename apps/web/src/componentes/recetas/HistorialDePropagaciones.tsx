'use client';

/**
 * Lo que ya se propagó de este producto, y cómo deshacerlo — R11.
 *
 * **REVERTIR NO BORRA NADA**: crea en cada sucursal una versión nueva con las
 * líneas de la que estaba vigente antes. Los costeos hechos entre medias siguen
 * siendo correctos porque usaron la receta que de verdad mandaba entonces, y eso
 * es lo que la pregunta de confirmación dice con todas las letras.
 *
 * **UNA PROPAGACIÓN REVERTIDA NO SE REVIERTE OTRA VEZ**: la API responde 409 y
 * aquí, además, el botón no está. Las dos cosas, porque la de aquí es cortesía y
 * la de allá es la regla.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { comoFecha } from '../../lib/fechas';
import type { Envio } from '../../lib/useEnvio';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Confirmar } from '../ui/Confirmar';
import { Error as Fallo } from '../ui/Estados';
import { Pildora } from '../ui/Pildora';
import { Tabla } from '../ui/Tabla';
import type { ParaPropagar, PropagacionLeida } from './propagacion';

interface Reversion {
  readonly envio: Envio;
  /** La propagación que se está preguntando si revertir, o `null`. */
  readonly revirtiendo: string | null;
  readonly pedir: (id: string) => void;
  readonly cancelar: () => void;
  readonly confirmar: () => void;
}

function useReversion(recargar: () => void): Reversion {
  const [revirtiendo, setRevirtiendo] = useState<string | null>(null);
  const envio = useEnvio();

  const revertir = async (id: string): Promise<void> => {
    const bien = await envio.enviar(async () => {
      await llamar({ ruta: `/recetas/propagacion/${id}/reversion`, metodo: 'POST' });
    });
    if (bien) {
      setRevirtiendo(null);
      recargar();
    }
  };

  return {
    envio,
    revirtiendo,
    pedir: setRevirtiendo,
    cancelar: () => {
      setRevirtiendo(null);
    },
    confirmar: () => {
      if (revirtiendo !== null) void revertir(revirtiendo);
    },
  };
}

export function HistorialDePropagaciones({
  datos,
  recargar,
}: {
  readonly datos: ParaPropagar;
  readonly recargar: () => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;
  const reversion = useReversion(recargar);

  if (datos.propagaciones.length === 0) {
    return (
      <section className="pila pila--apretada">
        <h2 className="subtitulo">{texto.historial}</h2>
        <p className="nota">{texto.sinHistorial}</p>
      </section>
    );
  }

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{texto.historial}</h2>
      {reversion.envio.error !== null && reversion.revirtiendo === null && <Fallo mensaje={reversion.envio.error} />}
      <TablaDePropagaciones datos={datos} alRevertir={reversion.pedir} />
      {reversion.revirtiendo !== null && (
        <Confirmar
          pregunta={texto.preguntaRevertir}
          textoConfirmar={texto.confirmarRevertir}
          envio={reversion.envio}
          alConfirmar={reversion.confirmar}
          alCancelar={reversion.cancelar}
        />
      )}
    </section>
  );
}

function TablaDePropagaciones({
  datos,
  alRevertir,
}: {
  readonly datos: ParaPropagar;
  readonly alRevertir: (id: string) => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;

  return (
    <Tabla compacta>
      <thead>
        <tr>
          <th>{texto.cuando}</th>
          <th>{texto.sucursales}</th>
          <th className="izquierda">{texto.estado}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {datos.propagaciones.map((propagacion) => (
          <FilaDePropagacion
            key={propagacion.id}
            propagacion={propagacion}
            sucursales={datos.sucursales}
            alRevertir={() => {
              alRevertir(propagacion.id);
            }}
          />
        ))}
      </tbody>
    </Tabla>
  );
}

function FilaDePropagacion({
  propagacion,
  sucursales,
  alRevertir,
}: {
  readonly propagacion: PropagacionLeida;
  readonly sucursales: ReadonlyMap<string, string>;
  readonly alRevertir: () => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;
  const revertida = propagacion.revertidaEn !== null;
  const nombres = propagacion.destinos
    .map((destino) => sucursales.get(destino.locationId) ?? TEXTOS.comun.sinDato)
    .join(', ');

  return (
    <tr>
      <td>{comoFecha(propagacion.propagadaEn)}</td>
      <td>{nombres}</td>
      <td className="izquierda">
        <Pildora tono={revertida ? 'neutro' : 'bien'} texto={revertida ? texto.revertida : texto.aplicada} />
      </td>
      <td className="izquierda">
        {!revertida && (
          <button type="button" onClick={alRevertir}>
            {texto.revertir}
          </button>
        )}
      </td>
    </tr>
  );
}
