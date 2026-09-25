'use client';

/**
 * Pantalla 20 — transferir producto a otra sucursal.
 *
 * **PIDE `inventory.transfer`**, que tiene también `BODEGA`: mover mercancía
 * entre bodega y local es su trabajo. No necesita `inventory.read`, así que
 * tras registrar se le ofrece hacer otra, no ir al libro.
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { FormularioDeTransferencia, type DatosDeTransferencia } from '../../../../componentes/inventario/FormularioDeTransferencia';
import type { InsumoDelLibro } from '../../../../componentes/inventario/libro';
import { Marco } from '../../../../componentes/Marco';
import { Vista } from '../../../../componentes/ui/Vista';
import { llamar } from '../../../../lib/api';
import type { Sucursal } from '../../../../lib/sesion';
import { useSucursal } from '../../../../lib/sesion';
import { useCarga, type Lectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

/** `leer` estable: una función nueva por render sería una lectura nueva (INC-031). */
function useDatos(): Lectura<DatosDeTransferencia> {
  const leer = useCallback(async (): Promise<DatosDeTransferencia> => {
    const [insumos, sucursales] = await Promise.all([
      llamar<readonly InsumoDelLibro[]>({ ruta: '/catalogo/items' }),
      llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
    ]);
    return { insumos, sucursales };
  }, []);

  return useCarga(leer);
}

export default function TransferenciaNueva(): ReactNode {
  const { sucursal } = useSucursal();
  const lectura = useDatos();
  const [hechas, setHechas] = useState(0);
  const texto = TEXTOS.transferencia;
  const nombre = lectura.datos?.sucursales.find((una) => una.id === sucursal)?.nombre;

  return (
    <Permitido permiso="inventory.transfer">
      <Marco titulo={texto.titulo} ayuda={nombre === undefined ? texto.ayuda : `${texto.desde} ${nombre}. ${texto.ayuda}`}>
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => (
            <div className="pila">
              {hechas > 0 && <p className="panel panel--relleno bien">{texto.hecho}</p>}
              {sucursal !== null && (
                <FormularioDeTransferencia
                  // Una clave por registro: el formulario vuelve a nacer limpio.
                  key={`transferencia-${sucursal}-${String(hechas)}`}
                  datos={datos}
                  origen={sucursal}
                  alTransferir={() => {
                    setHechas(hechas + 1);
                  }}
                />
              )}
            </div>
          )}
        </Vista>
      </Marco>
    </Permitido>
  );
}
