'use client';

/**
 * Pantalla 16 — propagar la receta de un producto a otras sucursales, y revertirlo.
 *
 * **PIDE `recipe.propagate`**, que es permiso de nivel company (R11): un gerente
 * de local no decide la receta de los demás locales. La API lo vuelve a exigir en
 * los tres endpoints; esto solo evita enseñar una pantalla que va a dar 403.
 */

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../componentes/armazon/Permitido';
import { Marco } from '../../../../../componentes/Marco';
import { FormularioDePropagacion } from '../../../../../componentes/recetas/FormularioDePropagacion';
import { HistorialDePropagaciones } from '../../../../../componentes/recetas/HistorialDePropagaciones';
import { useParaPropagar } from '../../../../../componentes/recetas/propagacion';
import { Vista } from '../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../componentes/ui/Volver';
import { useSucursal } from '../../../../../lib/sesion';
import { TEXTOS } from '../../../../../textos/es';

export default function PropagarLaReceta(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { sucursal } = useSucursal();
  const lectura = useParaPropagar(id, sucursal);
  const texto = TEXTOS.propagacion;
  const datos = lectura.datos;

  return (
    <Permitido permiso="recipe.propagate">
      <Marco
        titulo={datos === null ? texto.titulo : `${texto.titulo} · ${datos.nombre}`}
        ayuda={datos === null ? texto.ayuda : `${texto.desde} ${datos.sucursal}. ${texto.ayuda}`}
        acciones={<Volver href={`/productos/${id}`} />}
      >
        <Vista lectura={lectura} vacio="nunca">
          {(leidos) => (
            <div className="pila">
              {sucursal !== null && (
                <FormularioDePropagacion
                  key={`propagar-${sucursal}-${String(leidos.propagaciones.length)}`}
                  productId={id}
                  datos={leidos}
                  sucursal={sucursal}
                  recargar={lectura.recargar}
                />
              )}
              <HistorialDePropagaciones datos={leidos} recargar={lectura.recargar} />
            </div>
          )}
        </Vista>
      </Marco>
    </Permitido>
  );
}
