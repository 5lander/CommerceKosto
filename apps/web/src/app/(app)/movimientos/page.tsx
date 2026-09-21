'use client';

/**
 * Pantalla 17 — el libro de movimientos de la sucursal elegida.
 *
 * **ES UNA PANTALLA DE LECTURA SOBRE UN LIBRO APPEND-ONLY** (R3): no hay editar
 * ni borrar una fila, y eso no es una carencia de la interfaz sino la regla. La
 * corrección es un movimiento nuevo, y llega en la pantalla 19.
 *
 * **LOS FILTROS SON PARTE DE LA CONSULTA A LA API**, no un `filter` sobre lo
 * cargado: el libro se pagina por cursor y filtrar en el navegador daría «la
 * primera página filtrada» con cara de ser el libro entero.
 *
 * **Y EL ESTADO VACÍO VA DEBAJO DE LOS FILTROS, NO EN SU LUGAR** (`vacio:
 * 'nunca'`): el vacío de esta pantalla casi siempre lo causa un filtro, y
 * reemplazar la pantalla entera se llevaría por delante el control que hay que
 * tocar para salir de ahí.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { FiltrosDelLibro, FILTROS_VACIOS } from '../../../componentes/inventario/FiltrosDelLibro';
import { consultaDelLibro, useLibro, type Filtros } from '../../../componentes/inventario/libro';
import { TablaDelLibro } from '../../../componentes/inventario/TablaDelLibro';
import { Marco } from '../../../componentes/Marco';
import { Vacio } from '../../../componentes/ui/Estados';
import { Vista } from '../../../componentes/ui/Vista';
import { useSucursal } from '../../../lib/sesion';
import { TEXTOS } from '../../../textos/es';

export default function LibroDeMovimientos(): ReactNode {
  const { sucursal } = useSucursal();
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const lectura = useLibro(sucursal, filtros);
  const texto = TEXTOS.movimientos;

  return (
    <Marco titulo={texto.titulo} ayuda={texto.ayuda}>
      <Vista lectura={lectura} vacio="nunca">
        {(leido) => {
          const consulta = sucursal === null ? '' : consultaDelLibro(sucursal, filtros);
          return (
            <div className="pila">
              <FiltrosDelLibro filtros={filtros} insumos={[...leido.insumos.values()]} cambiar={setFiltros} />
              {leido.pagina.movimientos.length === 0 ? (
                <Vacio titulo={texto.vacio} ayuda={texto.vacioAyuda} />
              ) : (
                // Una consulta nueva es una tabla nueva: sin la clave, las páginas
                // que «Ver más» añadió con el filtro anterior se quedarían debajo.
                <TablaDelLibro key={consulta} leido={leido} consulta={consulta} />
              )}
            </div>
          );
        }}
      </Vista>
    </Marco>
  );
}
