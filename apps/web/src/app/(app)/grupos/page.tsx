'use client';

/**
 * Pantalla 7 — los grupos de insumos y la tarifa de IVA que heredan sus compras.
 *
 * **LA TARIFA DEL GRUPO ES EL ÚLTIMO ESCALÓN** (P16-A1, D-16.9): una compra toma
 * la del cuerpo, si no la del artículo, si no la del grupo; sin ninguna, la API la
 * rechaza. Por eso «no define» se enseña como tal y no como 0 %.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Grupo } from '../../../componentes/grupos/FormularioDeGrupo';
import { Marco } from '../../../componentes/Marco';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { comoPorcentaje } from '../../../lib/decimales';
import { usePermisos } from '../../../lib/permisos';
import { useLectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

export default function Grupos(): ReactNode {
  const { tiene } = usePermisos();
  const lectura = useLectura<readonly Grupo[]>('/catalogo/grupos');
  const { grupos } = TEXTOS;

  return (
    <Marco
      titulo={grupos.titulo}
      ayuda={grupos.ayuda}
      acciones={
        tiene('catalog.create') && (
          <Link href="/grupos/nuevo" className="boton" data-variante="primario">
            {grupos.nuevo}
          </Link>
        )
      }
    >
      <Vista lectura={lectura} vacio={{ esVacio: (lista) => lista.length === 0, titulo: grupos.vacio, ayuda: grupos.vacioAyuda }}>
        {(lista) => <TablaDeGrupos lista={lista} editable={tiene('catalog.update')} />}
      </Vista>
    </Marco>
  );
}

function TablaDeGrupos({ lista, editable }: { readonly lista: readonly Grupo[]; readonly editable: boolean }): ReactNode {
  const { grupos } = TEXTOS;

  return (
    <Tabla>
      <thead>
        <tr>
          <th>{grupos.nombre}</th>
          <th>{grupos.iva}</th>
        </tr>
      </thead>
      <tbody>
        {lista.map((grupo) => (
          <tr key={grupo.id}>
            <td>
              {editable ? (
                <Link href={`/grupos/${grupo.id}/editar`} className="enlace-de-fila">
                  {grupo.nombre}
                </Link>
              ) : (
                grupo.nombre
              )}
            </td>
            <td className={grupo.ivaTarifa === null ? 'numero tenue' : 'numero'}>
              {grupo.ivaTarifa === null ? grupos.noDefine : comoPorcentaje(grupo.ivaTarifa)}
            </td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}
