'use client';

/**
 * Pantalla 21 — registrar un lote de una preparación.
 *
 * **PIDE `inventory.produce`**, que tienen DUEÑA y GERENTE y **no** `BODEGA`:
 * producir decide el costo estándar con el que entra el lote (R10), y eso es
 * una decisión de costeo, no de almacén.
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { FormularioDeProduccion, type DatosDeProduccion } from '../../../../componentes/inventario/FormularioDeProduccion';
import type { InsumoDelCatalogo } from '../../../../componentes/inventario/produccion';
import { Marco } from '../../../../componentes/Marco';
import { Vista } from '../../../../componentes/ui/Vista';
import { llamar } from '../../../../lib/api';
import { useSucursal } from '../../../../lib/sesion';
import { useCarga, type Lectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

/** `leer` estable: una función nueva por render sería una lectura nueva (INC-031). */
function useCatalogo(): Lectura<DatosDeProduccion> {
  const leer = useCallback(async (): Promise<DatosDeProduccion> => {
    const insumos = await llamar<readonly InsumoDelCatalogo[]>({ ruta: '/catalogo/items' });
    return { insumos };
  }, []);

  return useCarga(leer);
}

export default function ProduccionNueva(): ReactNode {
  const { sucursal } = useSucursal();
  const lectura = useCatalogo();
  const [hechas, setHechas] = useState(0);
  const texto = TEXTOS.produccion;

  return (
    <Permitido permiso="inventory.produce">
      <Marco titulo={texto.titulo} ayuda={texto.ayuda}>
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => (
            <div className="pila">
              {hechas > 0 && <p className="panel panel--relleno bien">{texto.hecho}</p>}
              {sucursal !== null && (
                <FormularioDeProduccion
                  // Una clave por lote: el formulario vuelve a nacer limpio y la
                  // receta se vuelve a leer para la preparación de arranque.
                  key={`lote-${sucursal}-${String(hechas)}`}
                  datos={datos}
                  sucursal={sucursal}
                  alProducir={() => {
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
