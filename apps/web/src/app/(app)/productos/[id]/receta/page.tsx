'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { PaginaDeReceta } from '../../../../../componentes/recetas/PaginaDeReceta';
import { Volver } from '../../../../../componentes/ui/Volver';
import { TEXTOS } from '../../../../../textos/es';

/** Pantalla 14 — la receta de un producto en la sucursal elegida; al guardar, vuelve a su ficha y su costo. */
export default function RecetaDelProducto(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <PaginaDeReceta
      clase="producto"
      id={id}
      volver={
        <div className="linea">
          <Volver href={`/productos/${id}`} />
          {/* Sin gatear: esto ya vive dentro del `recipe.write` de `PaginaDeReceta`, y los
              dos roles que escriben receta —DUEÑA y GERENTE_LOCAL— también la leen (P4). */}
          <Link href={`/productos/${id}/receta/versiones`} className="boton">
            {TEXTOS.versionesDeReceta.enlace}
          </Link>
        </div>
      }
      alGuardar={() => {
        router.push(`/productos/${id}`);
      }}
    />
  );
}
