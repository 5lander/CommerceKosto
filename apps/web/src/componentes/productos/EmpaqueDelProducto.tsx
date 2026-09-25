'use client';

/**
 * El empaque del producto (`PUT /productos/:id/empaque`).
 *
 * **EL EMPAQUE ES UN INSUMO** (ADR-008): se compra, tiene presentación y precio
 * con vigencia, y su costo neto de uso es el `empaque_neto` de SPEC §14. Por eso
 * se elige de la lista de insumos activos y no de una lista propia. «Sin
 * empaque» viaja como `null` y deja ese costo en cero.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Formulario } from '../ui/Formulario';
import { Selector } from '../ui/Selector';
import { VolverACargar } from '../ui/VolverACargar';
import type { ProductoLeido } from './ficha';

/** El valor del selector que significa «no lleva empaque». */
const SIN_EMPAQUE = '';

export function EmpaqueDelProducto({
  leido,
  recargar,
}: {
  readonly leido: ProductoLeido;
  readonly recargar: () => void;
}): ReactNode {
  const envio = useEnvio();
  const [empaque, setEmpaque] = useState(leido.ficha.empaqueItemId ?? SIN_EMPAQUE);
  const texto = TEXTOS.productoDeVenta;
  const opciones = [
    { valor: SIN_EMPAQUE, texto: texto.sinEmpaque },
    ...leido.insumos
      .filter((insumo) => insumo.estado === 'ACTIVE' || insumo.id === leido.ficha.empaqueItemId)
      .map((insumo) => ({ valor: insumo.id, texto: insumo.nombre })),
  ];

  async function guardar(): Promise<void> {
    const cuerpo = { empaqueItemId: empaque === SIN_EMPAQUE ? null : empaque, version: leido.ficha.version };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: `/productos/${leido.ficha.id}/empaque`, metodo: 'PUT', cuerpo });
    });
    if (salio) recargar();
  }

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={texto.guardarEmpaque} textoEnviando={texto.guardando}>
      <Selector etiqueta={texto.empaque} valor={empaque} opciones={opciones} cambiar={setEmpaque} />
      <p className="nota">{texto.empaqueAyuda}</p>
      <VolverACargar envio={envio} recargar={recargar} />
    </Formulario>
  );
}
