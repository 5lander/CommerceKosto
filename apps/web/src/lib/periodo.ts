'use client';

/**
 * El mes que se está mirando — D-16.5: **vive en la URL**.
 *
 * `?anio=2026&mes=8` y no `localStorage`: un enlace a «la ingeniería de menú de
 * agosto» se comparte, se guarda en marcadores y vuelve atrás con el navegador,
 * y dos pestañas pueden mirar meses distintos sin pisarse. Sin parámetros —o con
 * unos que no tienen forma de mes— es el mes en curso en Ecuador (`lib/fechas.ts`).
 *
 * **EL CLIENTE NO LIMITA EL RANGO.** Un mes que nadie ha trabajado no es un error
 * de la URL: la API responde `PERIODO_SIN_DATOS` (D-16.2) y la pantalla lo pinta
 * como un mes sin abrir.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { Route } from 'next';

import { consultaDelMes, mesDeHoy, mesDeTexto, type Mes } from './fechas';

export interface Periodo {
  readonly periodo: Mes;
  readonly elegir: (mes: Mes) => void;
}

export function usePeriodo(): Periodo {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const anio = parametros.get('anio');
  const mes = parametros.get('mes');
  const periodo = useMemo(() => mesDeTexto(anio, mes) ?? mesDeHoy(), [anio, mes]);

  // `replace` y no `push`: cambiar de mes en el selector no es una navegación
  // a la que haga falta volver con «atrás» doce veces.
  const elegir = useCallback(
    (elegido: Mes) => {
      router.replace(`${ruta}?${consultaDelMes(elegido)}` as Route);
    },
    [router, ruta],
  );

  return { periodo, elegir };
}
