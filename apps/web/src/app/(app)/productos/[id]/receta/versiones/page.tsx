'use client';

/**
 * Pantalla 15 — el historial de la receta de un producto en la sucursal elegida.
 *
 * **PIDE `recipe.read`, NO `recipe.write`** (P16-B): leer por qué un plato costaba
 * lo que costaba no es poder cambiarlo. `BODEGA` no tiene ninguno de los dos: la
 * receta es el secreto del cliente (§4.3).
 */

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../../componentes/armazon/Permitido';
import { Marco } from '../../../../../../componentes/Marco';
import { HistorialDeReceta } from '../../../../../../componentes/recetas/HistorialDeReceta';
import { useVersionesDeReceta } from '../../../../../../componentes/recetas/versiones';
import { Vista } from '../../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../../componentes/ui/Volver';
import { useSucursal } from '../../../../../../lib/sesion';
import { TEXTOS } from '../../../../../../textos/es';

export default function VersionesDeLaReceta(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { sucursal } = useSucursal();
  const lectura = useVersionesDeReceta(id, sucursal);
  const texto = TEXTOS.versionesDeReceta;
  const datos = lectura.datos;

  return (
    <Permitido permiso="recipe.read">
      <Marco
        titulo={datos === null ? texto.titulo : `${texto.titulo} · ${datos.nombre}`}
        ayuda={datos === null ? texto.ayuda : `${texto.en} ${datos.sucursal}. ${texto.ayuda}`}
        acciones={<Volver href={`/productos/${id}`} />}
      >
        <Vista
          lectura={lectura}
          vacio={{ esVacio: (leidos) => leidos.versiones.length === 0, titulo: texto.vacio, ayuda: texto.vacioAyuda }}
        >
          {(leidos) => <HistorialDeReceta datos={leidos} />}
        </Vista>
      </Marco>
    </Permitido>
  );
}
