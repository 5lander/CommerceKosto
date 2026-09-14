'use client';

import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { PaginaDeReceta } from '../../../../../componentes/recetas/PaginaDeReceta';
import { Volver } from '../../../../../componentes/ui/Volver';

/** Pantalla 14 — la receta de un producto en la sucursal elegida; al guardar, vuelve a su ficha y su costo. */
export default function RecetaDelProducto(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <PaginaDeReceta
      clase="producto"
      id={id}
      volver={<Volver href={`/productos/${id}`} />}
      alGuardar={() => {
        router.push(`/productos/${id}`);
      }}
    />
  );
}
