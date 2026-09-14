'use client';

/**
 * Una lectura de la API con sus tres estados — cargando, error y datos.
 *
 * **EXISTE PARA NO COPIAR LO MISMO EN CADA PANTALLA.** Hasta el armazón, cada
 * página repetía `useCallback` + `useEffect` + tres `useState`, y solo no lo
 * cazaba `audit:duplication` porque los nombres cambiaban. Con treinta pantallas
 * por delante, era un clon seguro.
 *
 * **`null` no lee nada**: es «todavía no se sabe qué pedir» —la sucursal aún no
 * se ha leído—, no un error.
 *
 * **UNA RESPUESTA DE OTRA LECTURA NO SE ENSEÑA.** El resultado recuerda qué
 * lectura lo produjo; si la sucursal o el mes cambiaron mientras tanto, la
 * pantalla vuelve a «cargando» en el mismo render en que cambian, y la respuesta
 * que llegue tarde se descarta. Sin eso, la pantalla podría quedarse con los
 * números de agosto debajo del selector en septiembre.
 *
 * **VOLVER A LEER NO BORRA LO QUE SE VE**: tras guardar, la pantalla sigue con los
 * datos anteriores hasta que llegan los nuevos, en lugar de parpadear a
 * «cargando» y perder la posición en la hoja.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { codigoDe, llamar, mensajeDe } from './api';

export interface Lectura<T> {
  readonly datos: T | null;
  readonly error: string | null;
  /** El código de dominio del fallo (`PERIODO_SIN_DATOS`, …), o `null`. */
  readonly codigo: string | null;
  readonly recargar: () => void;
}

interface Resultado<T> {
  readonly origen: unknown;
  readonly datos: T | null;
  readonly error: string | null;
  readonly codigo: string | null;
}

const SIN_RESULTADO = { origen: null, datos: null, error: null, codigo: null } as const;

/**
 * La lectura de algo que no es una sola ruta —varias en paralelo, o una que
 * depende de otra—. **`leer` tiene que ser estable** (`useMemo`/`useCallback`):
 * cada función nueva es una lectura nueva.
 */
export function useCarga<T>(leer: (() => Promise<T>) | null): Lectura<T> {
  const [resultado, setResultado] = useState<Resultado<T>>(SIN_RESULTADO);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (leer === null) return undefined;
    let vigente = true;

    leer().then(
      (datos) => {
        if (vigente) setResultado({ origen: leer, datos, error: null, codigo: null });
      },
      (fallo: unknown) => {
        if (vigente) setResultado({ origen: leer, datos: null, error: mensajeDe(fallo), codigo: codigoDe(fallo) });
      },
    );
    return () => {
      vigente = false;
    };
  }, [leer, vuelta]);

  const recargar = useCallback(() => {
    setResultado((anterior) => ({ ...anterior, error: null, codigo: null }));
    setVuelta((anterior) => anterior + 1);
  }, []);

  const { datos, error, codigo } = resultado.origen === leer ? resultado : SIN_RESULTADO;
  return { datos, error, codigo, recargar };
}

/** La lectura de una sola ruta de la API. */
export function useLectura<T>(ruta: string | null): Lectura<T> {
  const leer = useMemo(() => (ruta === null ? null : () => llamar<T>({ ruta })), [ruta]);
  return useCarga(leer);
}
