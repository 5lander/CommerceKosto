'use client';

/**
 * Registrar un lote — `POST /inventario/producciones`.
 *
 * **LO PRODUCIDO ENTRA AL COSTO ESTÁNDAR** (R10), no al del lote; la diferencia
 * con lo que costó de verdad queda como varianza. Esta pantalla no calcula ni
 * una ni otra: manda lo que salió y lo que se usó.
 *
 * **LAS CANTIDADES DE LOS INSUMOS SE ESCRIBEN A MANO**, aunque la receta las
 * sepa: ver `produccion.ts`.
 */

import { useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { llamar } from '../../lib/api';
import { diaDeHoy } from '../../lib/fechas';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { CampoDeTexto } from '../ui/Campo';
import { CampoDeCantidad } from '../ui/CampoNumerico';
import { Formulario } from '../ui/Formulario';
import { Selector } from '../ui/Selector';
import {
  cuerpoDelLote,
  lineasDeLaReceta,
  preparacionesDe,
  type BorradorDeLote,
  type InsumoDelCatalogo,
  type LineaDeLote,
} from './produccion';

export interface DatosDeProduccion {
  readonly insumos: readonly InsumoDelCatalogo[];
}

/**
 * Al elegir preparación, la receta de esta sucursal repuebla la lista de insumos.
 *
 * **DEPENDE DEL SETTER DE `useState`, QUE ES ESTABLE**, y no de una función
 * escrita en el render: así las dependencias del efecto son las de verdad
 * —preparación y sucursal— sin tener que silenciar a nadie. Es la misma lección
 * de INC-031 vista desde el otro lado.
 */
function useLineasDeLaReceta(
  itemId: string,
  sucursal: string,
  setBorrador: Dispatch<SetStateAction<BorradorDeLote>>,
): void {
  useEffect(() => {
    if (itemId === '') return undefined;
    let vigente = true;
    const poner = (lineas: readonly LineaDeLote[]): void => {
      if (vigente) setBorrador((anterior) => ({ ...anterior, lineas }));
    };
    // Sin receta se escriben a mano: no es un error, es un caso.
    void lineasDeLaReceta(itemId, sucursal).then(poner, () => {
      poner([]);
    });
    return () => {
      vigente = false;
    };
  }, [itemId, sucursal, setBorrador]);
}

export function FormularioDeProduccion({
  datos,
  sucursal,
  alProducir,
}: {
  readonly datos: DatosDeProduccion;
  readonly sucursal: string;
  readonly alProducir: () => void;
}): ReactNode {
  const texto = TEXTOS.produccion;
  const preparaciones = preparacionesDe(datos.insumos);
  const [borrador, setBorrador] = useState<BorradorDeLote>(() => ({
    itemId: preparaciones[0]?.id ?? '',
    cantidad: '',
    lineas: [],
    fecha: diaDeHoy(),
    nota: '',
  }));
  const envio = useEnvio();

  const cambiar = (cambio: Partial<BorradorDeLote>): void => {
    setBorrador((anterior) => ({ ...anterior, ...cambio }));
  };
  useLineasDeLaReceta(borrador.itemId, sucursal, setBorrador);

  async function producir(): Promise<void> {
    const bien = await envio.enviar(async () => {
      await llamar({ ruta: '/inventario/producciones', metodo: 'POST', cuerpo: cuerpoDelLote(borrador, sucursal) });
    });
    if (bien) alProducir();
  }

  if (preparaciones.length === 0) return <p className="panel panel--relleno atencion">{texto.sinPreparaciones}</p>;

  return (
    <Formulario envio={envio} alEnviar={producir} textoDelBoton={texto.producir} textoEnviando={texto.produciendo}>
      <QueYCuanto borrador={borrador} preparaciones={preparaciones} cambiar={cambiar} />
      <InsumosDelLote borrador={borrador} insumos={datos.insumos} cambiar={cambiar} />
      <CuandoYNota borrador={borrador} cambiar={cambiar} />
    </Formulario>
  );
}

/** Qué preparación y cuánto salió del lote. */
function QueYCuanto({
  borrador,
  preparaciones,
  cambiar,
}: {
  readonly borrador: BorradorDeLote;
  readonly preparaciones: readonly InsumoDelCatalogo[];
  readonly cambiar: (cambio: Partial<BorradorDeLote>) => void;
}): ReactNode {
  const texto = TEXTOS.produccion;

  return (
    <>
      <Selector
        etiqueta={texto.preparacion}
        valor={borrador.itemId}
        opciones={preparaciones.map((una) => ({ valor: una.id, texto: `${una.nombre} (${una.unidadDeUso})` }))}
        cambiar={(itemId) => {
          cambiar({ itemId });
        }}
      />
      <CampoDeCantidad
        etiqueta={texto.cantidad}
        nombre="cantidad"
        requerido
        valor={borrador.cantidad}
        cambiar={(cantidad) => {
          cambiar({ cantidad });
        }}
      />
      <p className="nota">{texto.cantidadAyuda}</p>
    </>
  );
}

function InsumosDelLote({
  borrador,
  insumos,
  cambiar,
}: {
  readonly borrador: BorradorDeLote;
  readonly insumos: readonly InsumoDelCatalogo[];
  readonly cambiar: (cambio: Partial<BorradorDeLote>) => void;
}): ReactNode {
  const texto = TEXTOS.produccion;
  const siguiente = borrador.lineas.reduce((mayor, linea) => Math.max(mayor, linea.clave + 1), 0);

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{texto.insumos}</h2>
      <p className="nota">{borrador.lineas.length === 0 ? texto.sinReceta : texto.insumosAyuda}</p>
      {borrador.lineas.map((linea) => (
        <LineaDelLote
          key={linea.clave}
          linea={linea}
          insumos={insumos}
          cambiar={(cambio) => {
            cambiar({ lineas: borrador.lineas.map((una) => (una.clave === linea.clave ? { ...una, ...cambio } : una)) });
          }}
          quitar={() => {
            cambiar({ lineas: borrador.lineas.filter((una) => una.clave !== linea.clave) });
          }}
        />
      ))}
      <BotonDeAnadir
        alAnadir={() => {
          const primero = insumos[0];
          if (primero === undefined) return;
          cambiar({ lineas: [...borrador.lineas, { clave: siguiente, itemId: primero.id, cantidad: '' }] });
        }}
      />
    </section>
  );
}

function BotonDeAnadir({ alAnadir }: { readonly alAnadir: () => void }): ReactNode {
  return (
    <div>
      <button type="button" onClick={alAnadir}>
        {TEXTOS.produccion.anadir}
      </button>
    </div>
  );
}

function LineaDelLote({
  linea,
  insumos,
  cambiar,
  quitar,
}: {
  readonly linea: LineaDeLote;
  readonly insumos: readonly InsumoDelCatalogo[];
  readonly cambiar: (cambio: Partial<Omit<LineaDeLote, 'clave'>>) => void;
  readonly quitar: () => void;
}): ReactNode {
  const texto = TEXTOS.produccion;

  return (
    <div className="linea">
      <Selector
        etiqueta={texto.insumos}
        valor={linea.itemId}
        opciones={insumos.map((uno) => ({ valor: uno.id, texto: `${uno.nombre} (${uno.unidadDeUso})` }))}
        cambiar={(itemId) => {
          cambiar({ itemId });
        }}
      />
      <CampoDeCantidad
        etiqueta={texto.cantidad}
        nombre={`cantidad-${String(linea.clave)}`}
        requerido
        valor={linea.cantidad}
        cambiar={(cantidad) => {
          cambiar({ cantidad });
        }}
      />
      <button type="button" onClick={quitar}>
        {texto.quitar}
      </button>
    </div>
  );
}

function CuandoYNota({
  borrador,
  cambiar,
}: {
  readonly borrador: BorradorDeLote;
  readonly cambiar: (cambio: Partial<BorradorDeLote>) => void;
}): ReactNode {
  const texto = TEXTOS.produccion;

  return (
    <>
      <CampoDeTexto
        etiqueta={texto.fecha}
        nombre="fecha"
        tipo="date"
        requerido
        valor={borrador.fecha}
        cambiar={(fecha) => {
          cambiar({ fecha });
        }}
      />
      <CampoDeTexto
        etiqueta={texto.nota}
        nombre="nota"
        valor={borrador.nota}
        cambiar={(nota) => {
          cambiar({ nota });
        }}
      />
    </>
  );
}
