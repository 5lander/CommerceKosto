'use client';

/**
 * Pantalla 7 (edición) — el nombre y la tarifa de IVA de un grupo.
 *
 * **NO HAY `GET` DE UN GRUPO SUELTO**, y no hace falta: la lista de la company
 * cabe en una respuesta y trae los tres campos. Si el id no está en ella —otro
 * company, o un enlace viejo— la pantalla lo dice en vez de enseñar un formulario
 * vacío que crearía algo al guardar.
 *
 * **SIN VERSIÓN** (D-16.13): la API no la pide en los grupos.
 */

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../componentes/armazon/Permitido';
import { FormularioDeGrupo, type Grupo } from '../../../../../componentes/grupos/FormularioDeGrupo';
import { Marco } from '../../../../../componentes/Marco';
import { Vacio } from '../../../../../componentes/ui/Estados';
import { Vista } from '../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../componentes/ui/Volver';
import { useLectura } from '../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../textos/es';

export default function EditarGrupo(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const lectura = useLectura<readonly Grupo[]>('/catalogo/grupos');
  const { grupos } = TEXTOS;

  return (
    <Permitido permiso="catalog.update">
      <Marco titulo={grupos.editar} ayuda={grupos.ayuda} acciones={<Volver href="/grupos" />}>
        <Vista lectura={lectura} vacio="nunca">
          {(lista) => {
            const grupo = lista.find((g) => g.id === id);
            return grupo === undefined ? (
              <Vacio titulo={grupos.noEncontrado} ayuda={grupos.noEncontradoAyuda} />
            ) : (
              <FormularioDeGrupo grupo={grupo} />
            );
          }}
        </Vista>
      </Marco>
    </Permitido>
  );
}
