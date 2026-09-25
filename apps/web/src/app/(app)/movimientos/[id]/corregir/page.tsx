'use client';

/**
 * Pantalla 19 — corregir un movimiento del libro.
 *
 * **PIDE `inventory.read` PARA ENTRAR Y `inventory.write` PARA ESCRIBIR**: hay
 * que ver qué se corrige antes de corregirlo, y quien solo lee ve la ficha sin
 * el formulario. `BODEGA` no llega aquí —no tiene `inventory.read` (§4.3)— y
 * tampoco tiene el libro desde donde se entra.
 *
 * **TRAS CORREGIR VUELVE AL LIBRO**, que es donde se comprueba: las dos filas,
 * la original marcada «Corregido» y la nueva marcada «Es una corrección».
 */

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../componentes/armazon/Permitido';
import { Correccion, type ParaCorregir } from '../../../../../componentes/inventario/Correccion';
import type { InsumoDelLibro, MovimientoLeido } from '../../../../../componentes/inventario/libro';
import { Marco } from '../../../../../componentes/Marco';
import { Vista } from '../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../componentes/ui/Volver';
import { llamar } from '../../../../../lib/api';
import { usePermisos } from '../../../../../lib/permisos';
import { useCarga, type Lectura } from '../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../textos/es';

/** `leer` estable: una función nueva por render sería una lectura nueva (INC-031). */
function useMovimiento(id: string): Lectura<ParaCorregir> {
  const leer = useCallback(async (): Promise<ParaCorregir> => {
    const [movimiento, insumos] = await Promise.all([
      llamar<MovimientoLeido>({ ruta: `/inventario/movimientos/${id}` }),
      llamar<readonly InsumoDelLibro[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
    ]);
    return { movimiento, insumo: insumos.find((uno) => uno.id === movimiento.itemId) };
  }, [id]);

  return useCarga(leer);
}

export default function CorregirMovimiento(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tiene } = usePermisos();
  const lectura = useMovimiento(id);
  const [motivo, setMotivo] = useState('');
  const texto = TEXTOS.correccion;

  return (
    <Permitido permiso="inventory.read">
      <Marco titulo={texto.titulo} ayuda={texto.ayuda} acciones={<Volver href="/movimientos" />}>
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => (
            <Correccion
              datos={datos}
              accion={{
                motivo,
                cambiarMotivo: setMotivo,
                puedeCorregir: tiene('inventory.write'),
                alCorregir: () => {
                  router.push('/movimientos');
                },
              }}
            />
          )}
        </Vista>
      </Marco>
    </Permitido>
  );
}
