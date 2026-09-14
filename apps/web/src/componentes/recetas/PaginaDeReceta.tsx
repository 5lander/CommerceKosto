'use client';

/**
 * La página de la receta de un destino, la misma para un producto y para una
 * preparación: título, sucursal, y el editor —o por qué no hay receta que editar—.
 *
 * **LA SUCURSAL ES LA DEL SELECTOR**: la receta es de un par (destino, sucursal)
 * (SPEC §9). Un gerente edita la de su local; la de otro es 403 en la API.
 */

import type { ReactNode } from 'react';

import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';
import { Permitido } from '../armazon/Permitido';
import { Marco } from '../Marco';
import { Vista } from '../ui/Vista';
import { EditorDeReceta } from './EditorDeReceta';
import { admiteReceta, useParaEditarReceta, type ClaseDeDestino, type ParaEditarReceta } from './receta';

export function PaginaDeReceta({
  clase,
  id,
  volver,
  alGuardar,
}: {
  readonly clase: ClaseDeDestino;
  readonly id: string;
  readonly volver: ReactNode;
  readonly alGuardar: () => void;
}): ReactNode {
  const { sucursal } = useSucursal();
  const lectura = useParaEditarReceta(clase, id, sucursal);
  const { titulo, ayuda } = encabezadoDe(lectura.datos);

  return (
    <Permitido permiso="recipe.write">
      <Marco titulo={titulo} ayuda={ayuda} acciones={volver}>
        <Vista lectura={lectura} vacio="nunca">
          {(leidos) =>
            admiteReceta(clase, leidos.tipo) && sucursal !== null ? (
              <EditorDeReceta
                key={`receta-${sucursal}-${leidos.ultimaVersionId ?? 'ninguna'}`}
                datos={leidos}
                destino={{ clase, id, sucursal }}
                alGuardar={alGuardar}
                recargar={lectura.recargar}
              />
            ) : (
              <SinReceta clase={clase} />
            )
          }
        </Vista>
      </Marco>
    </Permitido>
  );
}

function encabezadoDe(datos: ParaEditarReceta | null): { readonly titulo: string; readonly ayuda: string } {
  const texto = TEXTOS.receta;
  if (datos === null) return { titulo: texto.titulo, ayuda: '' };
  return { titulo: `${texto.titulo} · ${datos.nombre}`, ayuda: `${texto.en} ${datos.sucursal}. ${texto.ayuda}` };
}

function SinReceta({ clase }: { readonly clase: ClaseDeDestino }): ReactNode {
  const texto = TEXTOS.receta;
  return <p className="panel panel--relleno atencion">{clase === 'producto' ? texto.comboSinReceta : texto.compradoSinReceta}</p>;
}
