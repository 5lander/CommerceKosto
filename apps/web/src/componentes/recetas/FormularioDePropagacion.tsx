'use client';

/**
 * Elegir a qué sucursales va la receta de esta, y propagarla — R11.
 *
 * **NINGUNA SUCURSAL CON RECETA PROPIA VIENE MARCADA.** Propagar sobre ella
 * borra el ajuste que alguien hizo ahí, y una casilla marcada de entrada
 * convierte esa pérdida en un descuido de un clic. Las que no tienen receta
 * propia sí vienen marcadas: ahí propagar no quita nada.
 *
 * **Y SI AUN ASÍ SE MARCA UNA, HAY QUE CONFIRMARLO** diciendo cuáles son, por su
 * nombre. Es la previsualización que R11 exige, no un «¿estás seguro?».
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import type { Envio } from '../../lib/useEnvio';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Casilla } from '../ui/Casilla';
import { Confirmar } from '../ui/Confirmar';
import { Error as Fallo } from '../ui/Estados';
import { Pildora } from '../ui/Pildora';
import type { DestinoDePropagacion, ParaPropagar } from './propagacion';

interface Destinos {
  readonly elegidas: ReadonlySet<string>;
  readonly alternar: (locationId: string, marcada: boolean) => void;
}

function useDestinos(destinos: readonly DestinoDePropagacion[]): Destinos {
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(
    () => new Set(destinos.filter((destino) => !destino.personalizada).map((destino) => destino.locationId)),
  );

  const alternar = (locationId: string, marcada: boolean): void => {
    const siguiente = new Set(elegidas);
    if (marcada) siguiente.add(locationId);
    else siguiente.delete(locationId);
    setElegidas(siguiente);
  };

  return { elegidas, alternar };
}

interface Propagado {
  readonly envio: Envio;
  readonly preguntando: boolean;
  readonly preguntar: () => void;
  readonly cancelar: () => void;
  readonly propagar: () => void;
}

function usePropagado(entrada: {
  readonly productId: string;
  readonly sucursal: string;
  readonly elegidas: ReadonlySet<string>;
  readonly recargar: () => void;
}): Propagado {
  const [preguntando, setPreguntando] = useState(false);
  const envio = useEnvio();

  const propagar = async (): Promise<void> => {
    const bien = await envio.enviar(async () => {
      await llamar({
        ruta: '/recetas/propagacion',
        metodo: 'POST',
        cuerpo: { productId: entrada.productId, origen: entrada.sucursal, destinos: [...entrada.elegidas] },
      });
    });
    if (bien) {
      setPreguntando(false);
      entrada.recargar();
    }
  };

  return {
    envio,
    preguntando,
    preguntar: () => {
      setPreguntando(true);
    },
    cancelar: () => {
      setPreguntando(false);
    },
    propagar: () => {
      void propagar();
    },
  };
}

export function FormularioDePropagacion({
  productId,
  datos,
  sucursal,
  recargar,
}: {
  readonly productId: string;
  readonly datos: ParaPropagar;
  readonly sucursal: string;
  readonly recargar: () => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;
  const { destinos } = datos.previsualizacion;
  const { elegidas, alternar } = useDestinos(destinos);
  const accion = usePropagado({ productId, sucursal, elegidas, recargar });

  const enPeligro = destinos.filter((destino) => destino.personalizada && elegidas.has(destino.locationId));

  if (destinos.length === 0) return <p className="panel panel--relleno atencion">{texto.sinDestinos}</p>;

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{texto.aDonde}</h2>
      <p className="nota">{texto.avisoPersonalizadas}</p>
      <ListaDeDestinos destinos={destinos} elegidas={elegidas} alternar={alternar} />
      {accion.envio.error !== null && !accion.preguntando && <Fallo mensaje={accion.envio.error} />}
      <AccionDePropagar accion={accion} enPeligro={enPeligro} elegidas={elegidas.size} />
    </section>
  );
}

/** El botón, o la pregunta con los nombres de las sucursales que perderían su receta. */
function AccionDePropagar({
  accion,
  enPeligro,
  elegidas,
}: {
  readonly accion: Propagado;
  readonly enPeligro: readonly DestinoDePropagacion[];
  readonly elegidas: number;
}): ReactNode {
  const texto = TEXTOS.propagacion;

  if (!accion.preguntando) {
    return (
      <BotonDePropagar
        envio={accion.envio}
        elegidas={elegidas}
        alPulsar={enPeligro.length > 0 ? accion.preguntar : accion.propagar}
      />
    );
  }

  return (
    <Confirmar
      pregunta={texto.preguntaPersonalizadas.replace('{n}', enPeligro.map((destino) => destino.nombre).join(', '))}
      textoConfirmar={texto.confirmarPropagar}
      envio={accion.envio}
      alConfirmar={accion.propagar}
      alCancelar={accion.cancelar}
    />
  );
}

function ListaDeDestinos({
  destinos,
  elegidas,
  alternar,
}: {
  readonly destinos: readonly DestinoDePropagacion[];
  readonly elegidas: ReadonlySet<string>;
  readonly alternar: (locationId: string, marcada: boolean) => void;
}): ReactNode {
  return (
    <div className="panel panel--relleno pila pila--minima">
      {destinos.map((destino) => (
        <FilaDeDestino
          key={destino.locationId}
          destino={destino}
          marcada={elegidas.has(destino.locationId)}
          cambiar={(marcada) => {
            alternar(destino.locationId, marcada);
          }}
        />
      ))}
    </div>
  );
}

function BotonDePropagar({
  envio,
  elegidas,
  alPulsar,
}: {
  readonly envio: Envio;
  readonly elegidas: number;
  readonly alPulsar: () => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;

  return (
    <div>
      <button type="button" data-variante="primario" disabled={envio.ocupado || elegidas === 0} onClick={alPulsar}>
        {envio.ocupado ? texto.propagando : texto.propagar}
      </button>
      {elegidas === 0 && <p className="nota">{texto.ningunaElegida}</p>}
    </div>
  );
}

function FilaDeDestino({
  destino,
  marcada,
  cambiar,
}: {
  readonly destino: DestinoDePropagacion;
  readonly marcada: boolean;
  readonly cambiar: (marcada: boolean) => void;
}): ReactNode {
  const texto = TEXTOS.propagacion;

  return (
    <div className="linea">
      <Casilla texto={destino.nombre} marcada={marcada} cambiar={cambiar} />
      <Pildora
        tono={destino.personalizada ? 'atencion' : 'neutro'}
        texto={destino.personalizada ? texto.tieneReceta : texto.sinReceta}
      />
    </div>
  );
}
