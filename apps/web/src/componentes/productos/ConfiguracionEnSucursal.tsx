'use client';

/**
 * Si el producto se vende en la sucursal elegida, a cuánto y en cuántas porciones
 * se reparte su receta (`PUT /productos/:id/ubicaciones`).
 *
 * **LA SUCURSAL ES LA DEL SELECTOR**, como en ventas y costeo: se configura donde
 * se está mirando, y la tabla de arriba enseña las demás.
 *
 * **LAS REGLAS SON DE LA API**: un producto que se vende necesita PVP (400), y
 * `0` no es «sin capturar» en ninguno de los dos números (400). La pantalla manda
 * vacío como `null` y enseña el motivo junto al botón.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { conPuntoDecimal, sinCerosDeSobra } from '../../lib/decimales';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { CampoDeCantidad } from '../ui/CampoNumerico';
import { Casilla } from '../ui/Casilla';
import { Formulario } from '../ui/Formulario';
import { VolverACargar } from '../ui/VolverACargar';
import type { Configuracion, ProductoLeido } from './ficha';

/** Un número vacío viaja como `null`: «todavía no se sabe». */
function cantidadOpcional(texto: string): string | null {
  return texto.trim() === '' ? null : conPuntoDecimal(texto);
}

function useConfiguracion(leido: ProductoLeido, sucursal: string, recargar: () => void) {
  const actual: Configuracion | undefined = leido.configuraciones.find((c) => c.locationId === sucursal);
  const envio = useEnvio();
  const [activo, setActivo] = useState(actual?.activo ?? false);
  const [pvp, setPvp] = useState(actual?.pvp === null || actual === undefined ? '' : sinCerosDeSobra(actual.pvp));
  const porcionesActuales = actual?.rendimientoPorciones ?? null;
  const [porciones, setPorciones] = useState(porcionesActuales === null ? '' : sinCerosDeSobra(porcionesActuales));

  async function guardar(): Promise<void> {
    const cuerpo = {
      locationId: sucursal,
      activo,
      pvp: cantidadOpcional(pvp),
      rendimientoPorciones: cantidadOpcional(porciones),
      version: leido.ficha.version,
    };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: `/productos/${leido.ficha.id}/ubicaciones`, metodo: 'PUT', cuerpo });
    });
    if (salio) recargar();
  }

  return { campos: { activo, setActivo, pvp, setPvp, porciones, setPorciones }, envio, guardar };
}

export function ConfiguracionEnSucursal({
  leido,
  sucursal,
  recargar,
}: {
  readonly leido: ProductoLeido;
  readonly sucursal: string;
  readonly recargar: () => void;
}): ReactNode {
  const { campos, envio, guardar } = useConfiguracion(leido, sucursal, recargar);
  const texto = TEXTOS.productoDeVenta;
  const nombre = leido.sucursales.get(sucursal) ?? TEXTOS.comun.sinDato;

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{`${texto.configurarEn} ${nombre}`}</h2>
      <Formulario envio={envio} alEnviar={guardar} textoDelBoton={texto.guardar} textoEnviando={texto.guardando}>
        <Casilla texto={texto.seVendeAqui} marcada={campos.activo} cambiar={campos.setActivo} />
        <CampoDeCantidad etiqueta={texto.pvpConIva} nombre="pvp" requerido={campos.activo} valor={campos.pvp} cambiar={campos.setPvp} />
        <CampoDeCantidad etiqueta={texto.porciones} nombre="porciones" valor={campos.porciones} cambiar={campos.setPorciones} />
        <p className="nota">{texto.porcionesAyuda}</p>
        <VolverACargar envio={envio} recargar={recargar} />
      </Formulario>
    </section>
  );
}
