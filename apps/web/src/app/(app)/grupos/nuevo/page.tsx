'use client';

import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { FormularioDeGrupo } from '../../../../componentes/grupos/FormularioDeGrupo';
import { Marco } from '../../../../componentes/Marco';
import { Volver } from '../../../../componentes/ui/Volver';
import { TEXTOS } from '../../../../textos/es';

/** Pantalla 7 (alta) — un grupo nuevo, con su tarifa de IVA si la define. */
export default function NuevoGrupo(): ReactNode {
  return (
    <Permitido permiso="catalog.create">
      <Marco titulo={TEXTOS.grupos.nuevo} ayuda={TEXTOS.grupos.ayuda} acciones={<Volver href="/grupos" />}>
        <FormularioDeGrupo grupo={null} />
      </Marco>
    </Permitido>
  );
}
