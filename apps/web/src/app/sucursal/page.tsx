'use client';

/**
 * Pantalla 1 (segunda mitad) — elegir sucursal.
 *
 * **LA LISTA LA DECIDE LA API, NO ESTA PANTALLA.** `GET /ubicaciones` devuelve
 * solo las que el usuario puede ver: un `GERENTE_LOCAL` recibe la suya y nada
 * más. Aquí no hay ningún filtro por rol — reimplementarlo sería tener la
 * autorización en dos sitios, y el día que difieran gana el que no está probado
 * (CLAUDE.md §10).
 *
 * **UNA SESIÓN QUE NO VALE MANDA A ENTRAR.** Esta pantalla vive fuera del armazón
 * —se elige sucursal antes de entrar en él—, así que registra por su cuenta lo
 * mismo que el armazón (`useEntrarAlCaducar`): si la cookie no llegó, el fallo se
 * ve de inmediato y no tres pantallas después.
 */

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Vista } from '../../componentes/ui/Vista';
import { useEntrarAlCaducar } from '../../lib/permisos';
import { useSucursal, type Sucursal } from '../../lib/sesion';
import { useLectura } from '../../lib/useLectura';
import { TEXTOS } from '../../textos/es';

export default function ElegirSucursal(): ReactNode {
  useEntrarAlCaducar();
  const lectura = useLectura<readonly Sucursal[]>('/ubicaciones');

  return (
    <main className="pantalla pila">
      <div className="pila pila--minima">
        <h1 className="titulo">{TEXTOS.sucursal.titulo}</h1>
        <p className="subtitulo">{TEXTOS.sucursal.ayuda}</p>
      </div>

      <Vista
        lectura={lectura}
        vacio={{
          esVacio: (sucursales) => sucursales.length === 0,
          titulo: TEXTOS.sucursal.ninguna,
          ayuda: TEXTOS.sucursal.ningunaAyuda,
        }}
      >
        {(sucursales) => <ListaDeSucursales sucursales={sucursales} />}
      </Vista>
    </main>
  );
}

function ListaDeSucursales({ sucursales }: { readonly sucursales: readonly Sucursal[] }): ReactNode {
  const router = useRouter();
  const { elegir } = useSucursal();

  return (
    <ul className="lista-limpia pila pila--minima">
      {sucursales.map((sucursal) => (
        <li key={sucursal.id}>
          <button
            type="button"
            className="opcion"
            onClick={() => {
              elegir(sucursal.id);
              router.replace('/inicio');
            }}
          >
            <span>{sucursal.nombre}</span>
            <span className="etiqueta">{sucursal.tipo}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
