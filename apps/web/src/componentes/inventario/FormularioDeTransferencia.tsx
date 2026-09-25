'use client';

/**
 * Mover producto de una sucursal a otra — `POST /inventario/transferencias`.
 *
 * **EL ORIGEN ES LA SUCURSAL ELEGIDA**, como en el resto del sistema: se
 * transfiere desde donde estás. El destino es cualquier otra de la company.
 *
 * **LA CANTIDAD VA EN POSITIVO Y AQUÍ NO SE NIEGA NADA** (D-16.209): la API
 * escribe el par —negativo donde sale, positivo donde entra— en una sola
 * transacción, y por eso el total de la company no cambia (R2).
 *
 * **LOS DOS MESES TIENEN QUE ESTAR ABIERTOS**, el de origen y el de destino, y
 * eso lo comprueba la API por separado para cada ubicación. Aquí solo se enseña
 * el motivo que devuelva.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { textoOpcional } from '../../lib/campos';
import { conPuntoDecimal } from '../../lib/decimales';
import { diaDeHoy, instanteDelDia } from '../../lib/fechas';
import type { Sucursal } from '../../lib/sesion';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { CampoDeTexto } from '../ui/Campo';
import { CampoDeCantidad } from '../ui/CampoNumerico';
import { Formulario } from '../ui/Formulario';
import { Selector } from '../ui/Selector';
import type { InsumoDelLibro } from './libro';

export interface DatosDeTransferencia {
  readonly insumos: readonly InsumoDelLibro[];
  readonly sucursales: readonly Sucursal[];
}

interface Borrador {
  readonly destino: string;
  readonly itemId: string;
  readonly cantidad: string;
  readonly fecha: string;
  readonly nota: string;
}

/** El par de movimientos, en UNA transacción: la API los escribe juntos (R2). */
function useTraslado(borrador: Borrador, origen: string, alTransferir: () => void) {
  const envio = useEnvio();

  async function transferir(): Promise<void> {
    const bien = await envio.enviar(async () => {
      await llamar({
        ruta: '/inventario/transferencias',
        metodo: 'POST',
        cuerpo: {
          origen,
          destino: borrador.destino,
          itemId: borrador.itemId,
          cantidad: conPuntoDecimal(borrador.cantidad),
          occurredAt: instanteDelDia(borrador.fecha),
          note: textoOpcional(borrador.nota),
        },
      });
    });
    if (bien) alTransferir();
  }

  return { envio, transferir };
}

export function FormularioDeTransferencia({
  datos,
  origen,
  alTransferir,
}: {
  readonly datos: DatosDeTransferencia;
  readonly origen: string;
  readonly alTransferir: () => void;
}): ReactNode {
  const texto = TEXTOS.transferencia;
  const otras = datos.sucursales.filter((una) => una.id !== origen);
  const [borrador, setBorrador] = useState<Borrador>(() => ({
    destino: otras[0]?.id ?? '',
    itemId: datos.insumos[0]?.id ?? '',
    cantidad: '',
    fecha: diaDeHoy(),
    nota: '',
  }));
  const { envio, transferir } = useTraslado(borrador, origen, alTransferir);

  const cambiar = (cambio: Partial<Borrador>): void => {
    setBorrador({ ...borrador, ...cambio });
  };

  if (otras.length === 0) return <p className="panel panel--relleno atencion">{texto.sinOtras}</p>;

  return (
    <Formulario envio={envio} alEnviar={transferir} textoDelBoton={texto.transferir} textoEnviando={texto.transfiriendo}>
      <QueYAdonde borrador={borrador} datos={datos} otras={otras} cambiar={cambiar} />
      <CuandoYNota borrador={borrador} cambiar={cambiar} />
    </Formulario>
  );
}

/** El destino, el insumo y cuánto: las tres cosas que definen el traslado. */
function QueYAdonde({
  borrador,
  datos,
  otras,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly datos: DatosDeTransferencia;
  readonly otras: readonly Sucursal[];
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.transferencia;

  return (
    <>
      <Selector
        etiqueta={texto.hacia}
        valor={borrador.destino}
        opciones={otras.map((una) => ({ valor: una.id, texto: una.nombre }))}
        cambiar={(destino) => {
          cambiar({ destino });
        }}
      />
      <Selector
        etiqueta={texto.insumo}
        valor={borrador.itemId}
        opciones={datos.insumos.map((uno) => ({ valor: uno.id, texto: `${uno.nombre} (${uno.unidadDeUso})` }))}
        cambiar={(itemId) => {
          cambiar({ itemId });
        }}
      />
      <CuantoSeMueve valor={borrador.cantidad} cambiar={cambiar} />
    </>
  );
}

/** En positivo: el signo lo pone la API, negativo donde sale y positivo donde entra. */
function CuantoSeMueve({
  valor,
  cambiar,
}: {
  readonly valor: string;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.transferencia;

  return (
    <>
      <CampoDeCantidad
        etiqueta={texto.cantidad}
        nombre="cantidad"
        requerido
        valor={valor}
        cambiar={(cantidad) => {
          cambiar({ cantidad });
        }}
      />
      <p className="nota">{texto.cantidadAyuda}</p>
    </>
  );
}

function CuandoYNota({
  borrador,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.transferencia;

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
      <p className="nota">{texto.fechaAyuda}</p>
      <CampoDeTexto
        etiqueta={texto.nota}
        nombre="nota"
        valor={borrador.nota}
        cambiar={(nota) => {
          cambiar({ nota });
        }}
      />
      <p className="nota">{texto.notaAyuda}</p>
    </>
  );
}
