'use client';

/**
 * Pantalla 1 (segunda mitad) — elegir sucursal.
 *
 * **LA LISTA LA DECIDE LA API, NO ESTA PANTALLA.** `GET /ubicaciones` devuelve
 * solo las que el usuario puede ver: un `GERENTE_LOCAL` recibe la suya y nada
 * más. Aquí no hay ningún filtro por rol — reimplementarlo sería tener la
 * autorización en dos sitios, y el día que difieran gana el que no está probado
 * (CLAUDE.md §10).
 *
 * **UN 401 MANDA A ENTRAR.** Es la única navegación por error de toda la
 * aplicación, y va aquí porque es la primera pantalla tras el login: si la
 * cookie no llegó, el fallo se ve de inmediato y no tres pantallas después.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/Estados';
import { ErrorDeApi, llamar } from '../../lib/api';
import { useSucursal, type Sucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';

const NO_AUTENTICADO = 401;

export default function ElegirSucursal(): ReactNode {
  const router = useRouter();
  const { elegir } = useSucursal();

  const [sucursales, setSucursales] = useState<readonly Sucursal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setSucursales(await llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }));
    } catch (fallo) {
      if (fallo instanceof ErrorDeApi && fallo.estado === NO_AUTENTICADO) {
        router.replace('/entrar');
        return;
      }
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    }
  }, [router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function seleccionar(id: string): void {
    elegir(id);
    router.replace('/costeo');
  }

  if (error !== null) {
    return (
      <Pantalla>
        <Fallo
          mensaje={error}
          reintentar={() => {
            void cargar();
          }}
        />
      </Pantalla>
    );
  }

  if (sucursales === null) {
    return (
      <Pantalla>
        <Cargando />
      </Pantalla>
    );
  }

  if (sucursales.length === 0) {
    return (
      <Pantalla>
        <Vacio titulo={TEXTOS.sucursal.ninguna} ayuda={TEXTOS.sucursal.ningunaAyuda} />
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--espacio-2)' }}>
        {sucursales.map((sucursal) => (
          <li key={sucursal.id}>
            <button
              type="button"
              onClick={() => {
                seleccionar(sucursal.id);
              }}
              style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
            >
              <span style={{ fontSize: 'var(--texto-lg)' }}>{sucursal.nombre}</span>
              <span
                style={{
                  marginLeft: 'var(--espacio-2)',
                  color: 'var(--color-texto-tenue)',
                  fontSize: 'var(--texto-sm)',
                }}
              >
                {sucursal.tipo}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Pantalla>
  );
}

function Pantalla({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <main
      style={{ maxWidth: '32rem', margin: '0 auto', padding: 'var(--espacio-8) var(--espacio-4)' }}
    >
      <h1 style={{ fontSize: 'var(--texto-xl)' }}>{TEXTOS.sucursal.titulo}</h1>
      <p style={{ color: 'var(--color-texto-suave)', marginBottom: 'var(--espacio-6)' }}>
        {TEXTOS.sucursal.ayuda}
      </p>
      {children}
    </main>
  );
}
