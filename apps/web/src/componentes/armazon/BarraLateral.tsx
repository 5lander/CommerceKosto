'use client';

/**
 * La barra lateral por grupos — U1, como Commerce.
 *
 * **SOLO LO QUE LA SESIÓN PUEDE LEER**, y un grupo sin ninguna entrada visible no
 * se pinta: un título sin enlaces debajo es ruido. Mientras los permisos no han
 * llegado, la barra está vacía (fail-closed, D-16.6).
 *
 * **EL MES VIAJA EN EL ENLACE** de las secciones que trabajan sobre un mes: quien
 * mira agosto en la ingeniería de menú y pasa a ventas sigue en agosto (D-16.5).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { usePeriodo } from '../../lib/periodo';
import { usePermisos } from '../../lib/permisos';
import { TEXTOS } from '../../textos/es';
import { NAVEGACION, type EntradaDeNavegacion } from './navegacion';

export function BarraLateral({ abierta }: { readonly abierta: boolean }): ReactNode {
  const { tiene } = usePermisos();
  const grupos = NAVEGACION.map((grupo) => ({
    ...grupo,
    entradas: grupo.entradas.filter((entrada) => tiene(entrada.permiso)),
  })).filter((grupo) => grupo.entradas.length > 0);

  return (
    <nav id="navegacion" aria-label={TEXTOS.navegacion.etiqueta} className="lateral" data-abierta={abierta}>
      {grupos.map((grupo) => (
        <div key={grupo.titulo} className="lateral__grupo">
          <p className="etiqueta">{grupo.titulo}</p>
          <ul className="lista-limpia pila pila--minima">
            {grupo.entradas.map((entrada) => (
              <EnlaceLateral key={entrada.href} entrada={entrada} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function EnlaceLateral({ entrada }: { readonly entrada: EntradaDeNavegacion }): ReactNode {
  const ruta = usePathname();
  const { periodo } = usePeriodo();
  const activa = ruta === entrada.href || ruta.startsWith(`${entrada.href}/`);
  const destino = entrada.conMes
    ? { pathname: entrada.href, query: { anio: String(periodo.anio), mes: String(periodo.mes) } }
    : entrada.href;

  return (
    <li>
      <Link href={destino} className="nav-enlace lateral__enlace" aria-current={activa ? 'page' : undefined}>
        {entrada.texto}
      </Link>
    </li>
  );
}
