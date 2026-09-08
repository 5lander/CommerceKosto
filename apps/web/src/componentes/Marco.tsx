'use client';

/**
 * El marco de las cuatro pantallas con datos: cabecera, navegación y sucursal.
 *
 * **SE ENCARGA DE UNA COSA QUE NO ES DECORACIÓN**: si no hay sucursal elegida,
 * manda a elegirla. Sin eso, cada pantalla tendría que comprobarlo y la que se
 * olvidara llamaría a la API con `locationId=null` — que la API rechaza, pero
 * con un mensaje sobre un parámetro, no sobre lo que la persona tiene que hacer.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../lib/api';
import { useSucursal } from '../lib/sesion';
import { TEXTOS } from '../textos/es';

const SECCIONES = [
  { href: '/costeo', texto: TEXTOS.costeo.titulo },
  { href: '/menu', texto: TEXTOS.menu.titulo },
  { href: '/ventas', texto: TEXTOS.ventas.titulo },
  { href: '/inventario', texto: TEXTOS.inventario.titulo },
] as const;

export function Marco({
  titulo,
  ayuda,
  acciones,
  children,
}: {
  readonly titulo: string;
  readonly ayuda: string;
  readonly acciones?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const router = useRouter();
  const ruta = usePathname();
  const { sucursal, olvidar } = useSucursal();

  // `sucursal` es `null` durante el primer render —se lee tras montar— y
  // también cuando de verdad no hay ninguna. Se espera un ciclo para distinguir
  // las dos: redirigir en el primer render haría que la pantalla parpadeara
  // hacia el selector cada vez que se recarga.
  useEffect(() => {
    const guardada = (() => {
      try {
        return window.localStorage.getItem('costeo.sucursal');
      } catch {
        return null;
      }
    })();

    if (guardada === null) router.replace('/sucursal');
  }, [router]);

  async function salir(): Promise<void> {
    try {
      await llamar({ ruta: '/auth/logout', metodo: 'POST' });
    } finally {
      // Se limpia la preferencia y se sale PASE LO QUE PASE con la llamada: si
      // el servidor no contestó, dejar al usuario dentro de una sesión que él
      // cree cerrada es peor que cerrarla solo en este navegador.
      olvidar();
      router.replace('/entrar');
    }
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          background: 'var(--color-superficie)',
          borderBottom: '1px solid var(--color-borde)',
          padding: 'var(--espacio-3) var(--espacio-4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--espacio-4)',
            flexWrap: 'wrap',
            maxWidth: '76rem',
            margin: '0 auto',
          }}
        >
          <nav style={{ display: 'flex', gap: 'var(--espacio-1)', flexWrap: 'wrap' }}>
            {SECCIONES.map((seccion) => (
              <Link
                key={seccion.href}
                href={seccion.href}
                style={{
                  padding: 'var(--espacio-2) var(--espacio-3)',
                  borderRadius: 'var(--radio)',
                  textDecoration: 'none',
                  color: ruta === seccion.href ? 'var(--color-acento-texto)' : 'var(--color-texto)',
                  background: ruta === seccion.href ? 'var(--color-acento)' : 'transparent',
                }}
              >
                {seccion.texto}
              </Link>
            ))}
          </nav>

          <div style={{ display: 'flex', gap: 'var(--espacio-2)' }}>
            <button
              type="button"
              onClick={() => {
                router.push('/sucursal');
              }}
            >
              {TEXTOS.sucursal.cambiar}
            </button>
            <button
              type="button"
              onClick={() => {
                void salir();
              }}
            >
              {TEXTOS.acceso.salir}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '76rem', margin: '0 auto', padding: 'var(--espacio-6) var(--espacio-4)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 'var(--espacio-4)',
            flexWrap: 'wrap',
            marginBottom: 'var(--espacio-6)',
          }}
        >
          <div>
            <h1 style={{ fontSize: 'var(--texto-xl)' }}>{titulo}</h1>
            <p style={{ margin: 0, color: 'var(--color-texto-suave)' }}>{ayuda}</p>
          </div>
          {acciones}
        </div>

        {sucursal === null ? null : children}
      </main>
    </div>
  );
}
