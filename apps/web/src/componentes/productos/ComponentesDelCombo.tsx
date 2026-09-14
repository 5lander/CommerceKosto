'use client';

/**
 * Los componentes de un combo, en su ficha — `GET /productos/:id/componentes`.
 *
 * **UN COMBO NO TIENE RECETA: SE ARMA CON PRODUCTOS QUE LA TIENEN** (SPEC §8). Su
 * costo es el de sus componentes en la sucursal, y lo calcula la API; aquí se
 * enseña de qué está hecho y, con `product.write`, se lleva a editarlo.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { sinCerosDeSobra } from '../../lib/decimales';
import { usePermisos } from '../../lib/permisos';
import { useLectura } from '../../lib/useLectura';
import { TEXTOS } from '../../textos/es';
import { Tabla } from '../ui/Tabla';
import { Vista } from '../ui/Vista';

export interface ComponentesLeidos {
  readonly version: number;
  readonly componentes: readonly {
    readonly productId: string;
    readonly nombre: string;
    readonly cantidad: string;
  }[];
}

export function ComponentesDelCombo({ productId }: { readonly productId: string }): ReactNode {
  const { tiene } = usePermisos();
  const lectura = useLectura<ComponentesLeidos>(`/productos/${productId}/componentes`);
  const texto = TEXTOS.componentes;

  return (
    <section className="pila pila--apretada">
      <div className="linea linea--separada">
        <h2 className="subtitulo">{texto.titulo}</h2>
        {tiene('product.write') && (
          <Link href={`/productos/${productId}/componentes`} className="boton">
            {texto.editar}
          </Link>
        )}
      </div>
      <Vista
        lectura={lectura}
        vacio={{ esVacio: (leidos) => leidos.componentes.length === 0, titulo: texto.vacio, ayuda: texto.vacioAyuda }}
      >
        {(leidos) => <TablaDeComponentes leidos={leidos} />}
      </Vista>
    </section>
  );
}

function TablaDeComponentes({ leidos }: { readonly leidos: ComponentesLeidos }): ReactNode {
  const texto = TEXTOS.componentes;

  return (
    <Tabla compacta>
      <thead>
        <tr>
          <th>{texto.producto}</th>
          <th>{texto.cantidad}</th>
        </tr>
      </thead>
      <tbody>
        {leidos.componentes.map((componente) => (
          <tr key={componente.productId}>
            <td>
              <Link href={`/productos/${componente.productId}`} className="enlace-de-fila">
                {componente.nombre}
              </Link>
            </td>
            <td className="numero">{sinCerosDeSobra(componente.cantidad)}</td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}
