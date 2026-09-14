'use client';

import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { PaginaDeReceta } from '../../../../../componentes/recetas/PaginaDeReceta';
import { Volver } from '../../../../../componentes/ui/Volver';

/** Pantalla 14 — la receta de una preparación (un insumo producido) en la sucursal elegida. */
export default function RecetaDeLaPreparacion(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <PaginaDeReceta
      clase="item"
      id={id}
      volver={<Volver href={`/insumos/${id}`} />}
      alGuardar={() => {
        router.push(`/insumos/${id}`);
      }}
    />
  );
}
