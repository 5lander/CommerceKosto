import type { ReactNode } from 'react';

import { CampoDeTexto } from './Campo';

/** Un porcentaje: hasta tres cifras enteras y dos decimales, con coma o punto. */
const PORCENTAJE = /^\d{0,3}(?:[.,]\d{0,2})?$/u;

/** Una cantidad positiva con hasta seis decimales, con coma o punto. */
const CANTIDAD = /^\d{0,9}(?:[.,]\d{0,6})?$/u;

/**
 * La misma cantidad, admitiendo el menos delante — el `AJUSTE`, que es el único
 * tipo del libro donde el signo lo elige quien escribe (`movimiento.ts`).
 */
const CANTIDAD_CON_SIGNO = /^-?\d{0,9}(?:[.,]\d{0,6})?$/u;

/**
 * Un campo de texto que solo deja escribir la forma de un número —con la coma
 * de es-EC o con punto—, sin convertirlo a nada.
 *
 * **ES TEXTO HASTA LA API**: el valor viaja como cadena y quien lo manda lo pasa
 * por `fraccionDePorcentaje` o `conPuntoDecimal`. Lo que esto filtra es lo que no
 * tiene forma de número; si el número no tiene sentido —un 150 %, una
 * presentación de cero— lo dice la API con su motivo.
 */
function CampoConForma({
  forma,
  etiqueta,
  nombre,
  valor,
  cambiar,
  requerido = false,
}: {
  readonly forma: RegExp;
  readonly etiqueta: string;
  readonly nombre: string;
  readonly valor: string;
  readonly cambiar: (valor: string) => void;
  readonly requerido?: boolean;
}): ReactNode {
  return (
    <CampoDeTexto
      etiqueta={etiqueta}
      nombre={nombre}
      requerido={requerido}
      valor={valor}
      cambiar={(crudo) => {
        if (forma.test(crudo)) cambiar(crudo);
      }}
    />
  );
}

type PropiedadesDeCampo = Omit<Parameters<typeof CampoConForma>[0], 'forma'>;

export function CampoDePorcentaje(propiedades: PropiedadesDeCampo): ReactNode {
  return <CampoConForma forma={PORCENTAJE} {...propiedades} />;
}

export function CampoDeCantidad(propiedades: PropiedadesDeCampo): ReactNode {
  return <CampoConForma forma={CANTIDAD} {...propiedades} />;
}

export function CampoDeCantidadConSigno(propiedades: PropiedadesDeCampo): ReactNode {
  return <CampoConForma forma={CANTIDAD_CON_SIGNO} {...propiedades} />;
}
