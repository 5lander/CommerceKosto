'use client';

/**
 * El encabezado de una sección, y la guardia de sucursal.
 *
 * **DESDE EL ARMAZÓN, YA NO ES LA BARRA.** La cabecera, la navegación y «salir»
 * viven en `componentes/armazon/`; aquí queda lo que es de cada pantalla: su
 * título, su ayuda, sus acciones, y que no se pinte nada sin sucursal.
 *
 * **LA GUARDIA NO ES DECORACIÓN**: si no hay sucursal elegida, manda a elegirla.
 * Sin eso, cada pantalla tendría que comprobarlo y la que se olvidara llamaría a
 * la API con `locationId=null`, que la API rechaza con un mensaje sobre un
 * parámetro y no sobre lo que la persona tiene que hacer.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useSucursal } from '../lib/sesion';

export function Marco({
  titulo,
  ayuda,
  acciones,
  children,
}: {
  readonly titulo: string;
  readonly ayuda: string;
  readonly acciones?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const router = useRouter();
  const { sucursal } = useSucursal();

  // `sucursal` es `null` en el primer render —se lee tras montar— y también
  // cuando de verdad no hay ninguna. Se lee el almacenamiento directamente para
  // distinguirlas: redirigir en el primer render haría parpadear la pantalla
  // hacia el selector en cada recarga.
  useEffect(() => {
    const guardada = (() => {
      try {
        return window.localStorage.getItem('costeo.sucursal');
      } catch {
        return null;
      }
    })();

    if (guardada === null) router.replace('/sucursal');
  }, [router]);

  return (
    <>
      <div className="encabezado">
        <div className="pila pila--minima">
          <h1 className="titulo">{titulo}</h1>
          <p className="subtitulo">{ayuda}</p>
        </div>
        {acciones}
      </div>

      {sucursal === null ? null : children}
    </>
  );
}
