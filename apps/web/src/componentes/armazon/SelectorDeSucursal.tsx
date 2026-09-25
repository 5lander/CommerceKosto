'use client';

/**
 * La sucursal, en la cabecera — U1.
 *
 * **LA LISTA LA DECIDE LA API**: `GET /ubicaciones` devuelve solo las que la
 * sesión puede ver, así que un `GERENTE_LOCAL` no tiene nada que elegir más allá
 * de la suya. Aquí no se filtra por rol.
 *
 * **CAMBIAR DE SUCURSAL NO NAVEGA.** Las pantallas leen con la sucursal como
 * dependencia y vuelven a leer solas; la URL sigue siendo la misma sección.
 */

import type { ReactNode } from 'react';

import { useSucursal, type Sucursal } from '../../lib/sesion';
import { useLectura } from '../../lib/useLectura';
import { TEXTOS } from '../../textos/es';

export function SelectorDeSucursal(): ReactNode {
  const { sucursal, elegir } = useSucursal();
  const { datos: sucursales } = useLectura<readonly Sucursal[]>('/ubicaciones');

  return (
    <label className="selector-compacto">
      <span className="etiqueta">{TEXTOS.sucursal.etiqueta}</span>
      <select
        value={sucursal ?? ''}
        disabled={sucursales === null}
        onChange={(evento) => {
          elegir(evento.target.value);
        }}
      >
        {sucursales === null && <option value={sucursal ?? ''}>{TEXTOS.comun.cargando}</option>}
        {sucursales?.map((opcion) => (
          <option key={opcion.id} value={opcion.id}>
            {opcion.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
