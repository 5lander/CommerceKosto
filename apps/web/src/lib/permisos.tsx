'use client';

/**
 * Los permisos de la sesión, leídos UNA vez por carga del armazón.
 *
 * **SALEN DE `GET /auth/sesion`, NO DE UNA SUPOSICIÓN POR ROL.** El frontend no
 * sabe qué puede hacer un `GERENTE_LOCAL`: sabe qué capacidades trae la sesión, y
 * pinta con eso (SPEC §4). Si mañana cambia la matriz de roles, esta pantalla no
 * se entera ni hace falta.
 *
 * **FAIL-CLOSED** (D-16.6). Mientras no han llegado, `tiene()` responde que no:
 * la barra lateral empieza vacía y se llena, nunca empieza llena y se recorta.
 *
 * **Y ESTO REFLEJA LA AUTORIZACIÓN, NO LA IMPLEMENTA** (CLAUDE.md §10). Esconder
 * un enlace no protege nada: la frontera es el 403 de la API, y la sección sin
 * permiso se ve igual aunque alguien escriba la URL a mano.
 *
 * **EN MEMORIA, NUNCA EN `localStorage`**: no son secretos, pero se quedan
 * rancios, y la única fuente de verdad es la sesión del servidor.
 */

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { alCaducarSesion, llamar, mensajeDe } from './api';
import { guardarCsrf } from './csrf';

/** Lo que el armazón usa de `GET /auth/sesion`. El alcance lo aplica la API. */
interface SesionDeLaApi {
  readonly permisos: readonly string[];
  readonly csrf: string;
}

export type EstadoDeLaSesion = 'cargando' | 'lista' | 'fallida';

interface Contexto {
  readonly estado: EstadoDeLaSesion;
  readonly error: string | null;
  readonly tiene: (permiso: string) => boolean;
  readonly reintentar: () => void;
}

const PermisosContexto = createContext<Contexto | null>(null);

function estadoDe(permisos: ReadonlySet<string> | null, error: string | null): EstadoDeLaSesion {
  if (permisos !== null) return 'lista';
  return error === null ? 'cargando' : 'fallida';
}

/**
 * Si la sesión se cae a mitad de uso, a entrar — mientras la pantalla que lo
 * pide esté montada. Lo usan el armazón y `/sucursal`, que vive fuera de él.
 */
export function useEntrarAlCaducar(): void {
  const router = useRouter();

  useEffect(
    () =>
      alCaducarSesion(() => {
        router.replace('/entrar');
      }),
    [router],
  );
}

export function ProveedorDePermisos({ children }: { readonly children: ReactNode }): ReactNode {
  const [permisos, setPermisos] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const sesion = await llamar<SesionDeLaApi>({ ruta: '/auth/sesion' });
      // Ya que llega, el token anti-CSRF: la primera mutación no tendrá que pedirlo.
      guardarCsrf(sesion.csrf);
      setPermisos(new Set(sesion.permisos));
    } catch (fallo) {
      setError(mensajeDe(fallo));
    }
  }, []);

  useEntrarAlCaducar();

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const valor = useMemo<Contexto>(
    () => ({
      estado: estadoDe(permisos, error),
      error,
      tiene: (permiso) => permisos?.has(permiso) ?? false,
      reintentar: () => {
        void cargar();
      },
    }),
    [permisos, error, cargar],
  );

  return <PermisosContexto.Provider value={valor}>{children}</PermisosContexto.Provider>;
}

export function usePermisos(): Contexto {
  const contexto = useContext(PermisosContexto);
  if (contexto === null) {
    throw new Error('usePermisos se usó fuera de ProveedorDePermisos.');
  }
  return contexto;
}
