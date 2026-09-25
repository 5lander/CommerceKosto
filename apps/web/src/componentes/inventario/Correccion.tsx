'use client';

/**
 * Corregir un movimiento — `POST /inventario/movimientos/:id/correccion`.
 *
 * **NO EDITA NADA** (R3): la API escribe una fila nueva de signo contrario, con
 * la fecha del original, y las dos se quedan. Por eso esta pantalla no tiene
 * campos que cambiar: enseña lo que se corrige y **solo pide el motivo**.
 *
 * **Y NO ADELANTA EL NÚMERO.** Podría pintar «quedará −25 kg» invirtiendo la
 * cantidad, y sería calcular en el navegador lo que calcula el dominio. Se
 * describe la operación con palabras; el resultado lo enseña el libro.
 *
 * **LOS DOS CASOS EN QUE NO SE PUEDE, EN SITIO**: ya corregido, o es una
 * corrección. La API los rechaza igual; aquí se dicen antes para no hacer
 * escribir un motivo que se va a perder.
 */

import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { textoOpcional } from '../../lib/campos';
import { comoImporte, sinCerosDeSobra } from '../../lib/decimales';
import { comoFecha } from '../../lib/fechas';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Dato } from '../ui/Dato';
import { CampoDeTexto } from '../ui/Campo';
import { Formulario } from '../ui/Formulario';
import type { InsumoDelLibro, MovimientoLeido } from './libro';

export interface ParaCorregir {
  readonly movimiento: MovimientoLeido;
  readonly insumo: InsumoDelLibro | undefined;
}

export interface AccionDeCorregir {
  readonly motivo: string;
  readonly cambiarMotivo: (motivo: string) => void;
  readonly alCorregir: () => void;
  /** Sin `inventory.write` se ve el movimiento y no el formulario. */
  readonly puedeCorregir: boolean;
}

export function Correccion({ datos, accion }: { readonly datos: ParaCorregir; readonly accion: AccionDeCorregir }): ReactNode {
  const { motivo, cambiarMotivo, alCorregir, puedeCorregir } = accion;
  const texto = TEXTOS.correccion;
  const envio = useEnvio();

  async function corregir(): Promise<void> {
    const bien = await envio.enviar(async () => {
      await llamar({
        ruta: `/inventario/movimientos/${datos.movimiento.id}/correccion`,
        metodo: 'POST',
        cuerpo: { note: textoOpcional(motivo) },
      });
    });
    if (bien) alCorregir();
  }

  if (!puedeCorregir) return <ElMovimiento datos={datos} />;

  return (
    <div className="pila">
      <ElMovimiento datos={datos} />
      {impedimentoDe(datos.movimiento) ?? (
        <Formulario
          envio={envio}
          alEnviar={corregir}
          textoDelBoton={texto.corregir}
          textoEnviando={texto.corrigiendo}
        >
          <p className="nota">{texto.queDejaAyuda}</p>
          <CampoDeTexto
            etiqueta={texto.motivo}
            nombre="motivo"
            requerido
            valor={motivo}
            cambiar={cambiarMotivo}
          />
          <p className="nota">{texto.motivoAyuda}</p>
        </Formulario>
      )}
    </div>
  );
}

/** Lo que impide corregir, si algo lo impide. La frontera de verdad es la API. */
function impedimentoDe(movimiento: MovimientoLeido): ReactNode {
  const texto = TEXTOS.correccion;
  if (movimiento.corregidoPor !== null) return <p className="panel panel--relleno atencion">{texto.yaCorregido}</p>;
  if (movimiento.corrigeA !== null) return <p className="panel panel--relleno atencion">{texto.esCorreccion}</p>;
  return null;
}

function ElMovimiento({ datos }: { readonly datos: ParaCorregir }): ReactNode {
  const texto = TEXTOS.correccion;
  const { movimiento, insumo } = datos;
  const unidad = insumo === undefined ? '' : ` ${insumo.unidadDeUso}`;

  return (
    <section className="panel panel--relleno pila pila--apretada">
      <h2 className="subtitulo">{texto.elMovimiento}</h2>
      <dl className="datos">
        <Dato etiqueta={texto.fecha} valor={comoFecha(movimiento.occurredAt)} />
        <Dato etiqueta={texto.tipo} valor={TEXTOS.movimientos.tipos[movimiento.tipo] ?? movimiento.tipo} />
        <Dato etiqueta={texto.insumo} valor={insumo?.nombre ?? TEXTOS.comun.sinDato} />
        <Dato etiqueta={texto.cantidad} valor={`${sinCerosDeSobra(movimiento.cantidad)}${unidad}`} />
        <Dato
          etiqueta={texto.importe}
          valor={movimiento.costoTotal === null ? TEXTOS.comun.sinDato : comoImporte(movimiento.costoTotal)}
        />
        <Dato etiqueta={texto.notaOriginal} valor={movimiento.note ?? TEXTOS.comun.sinDato} />
      </dl>
    </section>
  );
}
