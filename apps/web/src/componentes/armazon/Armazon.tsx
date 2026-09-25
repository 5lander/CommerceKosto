'use client';

/**
 * El armazón de toda la aplicación autenticada — U1, «como Commerce».
 *
 * Cabecera arriba, barra lateral por grupos a la izquierda y la lámina de la
 * sección. **En un teléfono la barra se esconde** detrás del botón «Menú»: la hoja
 * de conteo y la rejilla de ventas se usan de pie, y ahí el ancho es de la tabla.
 * Se cierra sola al navegar.
 *
 * **SI LA SESIÓN NO SE PUDO LEER**, la lámina enseña el error con «volver a
 * intentar» en lugar de la sección. Un 401 no llega aquí: `ProveedorDePermisos`
 * ya ha mandado a entrar.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { usePermisos } from '../../lib/permisos';
import { Error as Fallo } from '../ui/Estados';
import { BarraLateral } from './BarraLateral';
import { Cabecera } from './Cabecera';

export function Armazon({ children }: { readonly children: ReactNode }): ReactNode {
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);
  const { estado, error, reintentar } = usePermisos();

  useEffect(() => {
    setAbierta(false);
  }, [ruta]);

  return (
    <div className="aplicacion">
      <Cabecera
        abierta={abierta}
        alternar={() => {
          setAbierta((anterior) => !anterior);
        }}
      />
      <div className="armazon">
        <BarraLateral abierta={abierta} />
        <main className="lamina">
          {estado === 'fallida' ? <Fallo mensaje={error ?? ''} reintentar={reintentar} /> : children}
        </main>
      </div>
    </div>
  );
}
