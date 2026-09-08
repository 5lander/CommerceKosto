import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ProveedorDeSucursal } from '../lib/sesion';
import { TEXTOS } from '../textos/es';
import '../styles/global.css';

export const metadata: Metadata = {
  title: TEXTOS.producto,
  description: 'Costeo de alimentos, inventario por sucursal y analítica de menú.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="es-EC">
      <body>
        <ProveedorDeSucursal>{children}</ProveedorDeSucursal>
      </body>
    </html>
  );
}
