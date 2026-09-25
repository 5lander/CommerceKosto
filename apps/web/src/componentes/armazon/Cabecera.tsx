'use client';

/**
 * La cabecera del armazón: marca, sucursal, mes y salir.
 *
 * **EL SELECTOR DE MES SOLO EN LAS SECCIONES QUE TIENEN MES** (`conMes` del
 * registro): en el costeo o en el catálogo no significaría nada, y un control que
 * no hace nada confunde.
 *
 * **SALIR LIMPIA PASE LO QUE PASE CON LA LLAMADA**: si el servidor no contestó,
 * dejar a alguien dentro de una sesión que cree cerrada es peor que cerrarla solo
 * en este navegador.
 */

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { guardarCsrf } from '../../lib/csrf';
import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';
import { Isotipo } from '../ui/Marca';
import { entradaDe } from './navegacion';
import { SelectorDeMes } from './SelectorDeMes';
import { SelectorDeSucursal } from './SelectorDeSucursal';

export function Cabecera({
  abierta,
  alternar,
}: {
  readonly abierta: boolean;
  readonly alternar: () => void;
}): ReactNode {
  const conMes = entradaDe(usePathname())?.conMes ?? false;

  return (
    <header className="barra">
      <div className="barra__interior barra__interior--ancha">
        <div className="barra__grupo">
          <button type="button" className="alternador" aria-expanded={abierta} aria-controls="navegacion" onClick={alternar}>
            {TEXTOS.navegacion.menu}
          </button>
          <Isotipo />
          <span className="marca-nombre">{TEXTOS.producto}</span>
        </div>

        <div className="barra__grupo barra__contexto">
          <SelectorDeSucursal />
          {conMes && <SelectorDeMes />}
        </div>

        <BotonDeSalir />
      </div>
      {/* La «regla rota» del manual (p. 27): cintas y encabezados. */}
      <hr className="regla-rota" />
    </header>
  );
}

function BotonDeSalir(): ReactNode {
  const router = useRouter();
  const { olvidar } = useSucursal();

  async function salir(): Promise<void> {
    try {
      await llamar({ ruta: '/auth/logout', metodo: 'POST' });
    } finally {
      olvidar();
      guardarCsrf(null);
      router.replace('/entrar');
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void salir();
      }}
    >
      {TEXTOS.acceso.salir}
    </button>
  );
}
