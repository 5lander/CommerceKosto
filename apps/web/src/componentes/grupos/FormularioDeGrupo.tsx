'use client';

/**
 * El formulario de un grupo de insumos, el mismo para el alta y la edición.
 *
 * **LA TARIFA DE IVA ES OPCIONAL, Y VACÍA SIGNIFICA «EL GRUPO NO DEFINE»**, que
 * la API recibe como `null` (P16-A1). No es cero: un grupo sin tarifa no dice que
 * sus compras no llevan IVA, dice que la tarifa sale del artículo, y si tampoco
 * la hay la API rechaza la compra con su motivo. Se escribe en porcentaje y viaja
 * como fracción (`fraccionDePorcentaje`).
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { fraccionDePorcentaje, porcentajeDeFraccion } from '../../lib/decimales';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { PORCENTAJE } from '../insumos/opciones';
import { CampoDeTexto } from '../ui/Campo';
import { Formulario } from '../ui/Formulario';

export interface Grupo {
  readonly id: string;
  readonly nombre: string;
  readonly ivaTarifa: string | null;
}

/** `null` para un alta; el grupo que se edita, si no. */
export function FormularioDeGrupo({ grupo }: { readonly grupo: Grupo | null }): ReactNode {
  const router = useRouter();
  const envio = useEnvio();
  const [nombre, setNombre] = useState(grupo?.nombre ?? '');
  const ivaActual = grupo?.ivaTarifa ?? null;
  const [iva, setIva] = useState(ivaActual === null ? '' : porcentajeDeFraccion(ivaActual));
  const { grupos } = TEXTOS;

  async function guardar(): Promise<void> {
    const cuerpo = { nombre: nombre.trim(), ivaTarifa: iva.trim() === '' ? null : fraccionDePorcentaje(iva) };
    const salio = await envio.enviar(async () => {
      await (grupo === null
        ? llamar({ ruta: '/catalogo/grupos', metodo: 'POST', cuerpo })
        : llamar({ ruta: `/catalogo/grupos/${grupo.id}`, metodo: 'PUT', cuerpo }));
    });
    if (salio) router.push('/grupos');
  }

  return (
    <Formulario
      envio={envio}
      alEnviar={guardar}
      textoDelBoton={grupo === null ? grupos.crear : grupos.guardar}
      textoEnviando={grupos.guardando}
    >
      <CampoDeTexto etiqueta={grupos.nombre} nombre="nombre" requerido valor={nombre} cambiar={setNombre} />
      <CampoDeTexto
        etiqueta={grupos.iva}
        nombre="iva"
        valor={iva}
        cambiar={(crudo) => {
          if (PORCENTAJE.test(crudo)) setIva(crudo);
        }}
      />
      <p className="nota">{grupos.ivaAyuda}</p>
    </Formulario>
  );
}
