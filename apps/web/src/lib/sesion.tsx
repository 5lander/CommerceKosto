'use client';

/**
 * La sucursal elegida, compartida por las cinco pantallas.
 *
 * **NO ES UN GESTOR DE ESTADO.** Es un contexto de React con dos valores, que es
 * lo que trae el framework. No hay librería de estado y no hace falta: lo único
 * que cruza pantallas es qué sucursal se está mirando.
 *
 * **LO QUE SE GUARDA ES EL ID DE LA SUCURSAL, Y NADA MÁS.** El token de sesión
 * vive en una cookie `HttpOnly` que JavaScript no puede leer — si pudiera, un
 * XSS la robaría. Aquí solo hay una preferencia de navegación.
 *
 * **Y LA SUCURSAL NO DECIDE PERMISOS.** La API resuelve el alcance desde la
 * sesión: si alguien cambia este valor a mano por una sucursal que no es suya,
 * la API contesta 403. Esto refleja la autorización, no la implementa
 * (CLAUDE.md §10).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** Preferencia de navegación, no un dato sensible (CLAUDE.md §10). */
const CLAVE = 'costeo.sucursal';

export interface Sucursal {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly estado: string;
}

interface Contexto {
  readonly sucursal: string | null;
  readonly elegir: (id: string) => void;
  readonly olvidar: () => void;
}

const SucursalContexto = createContext<Contexto | null>(null);

export function ProveedorDeSucursal({ children }: { readonly children: ReactNode }): ReactNode {
  const [sucursal, setSucursal] = useState<string | null>(null);

  // Se lee DESPUÉS del primer render, no durante: en el servidor no hay
  // `localStorage`, y leerlo al construir el estado haría que el HTML del
  // servidor y el del cliente no coincidieran.
  useEffect(() => {
    try {
      setSucursal(window.localStorage.getItem(CLAVE));
    } catch {
      // Navegador con el almacenamiento bloqueado: se elige sucursal cada vez.
      // Es peor experiencia, no un fallo.
    }
  }, []);

  const elegir = useCallback((id: string) => {
    setSucursal(id);
    try {
      window.localStorage.setItem(CLAVE, id);
    } catch {
      // Igual que arriba: la pantalla funciona, solo no lo recuerda.
    }
  }, []);

  const olvidar = useCallback(() => {
    setSucursal(null);
    try {
      window.localStorage.removeItem(CLAVE);
    } catch {
      // Igual.
    }
  }, []);

  const valor = useMemo(() => ({ sucursal, elegir, olvidar }), [sucursal, elegir, olvidar]);

  return <SucursalContexto.Provider value={valor}>{children}</SucursalContexto.Provider>;
}

export function useSucursal(): Contexto {
  const contexto = useContext(SucursalContexto);
  if (contexto === null) {
    throw new Error('useSucursal se usó fuera de ProveedorDeSucursal.');
  }
  return contexto;
}
