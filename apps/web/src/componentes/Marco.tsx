'use client';

/**
 * El marco de las cuatro pantallas con datos: cabecera, navegación y sucursal.
 *
 * **SE ENCARGA DE UNA COSA QUE NO ES DECORACIÓN**: si no hay sucursal elegida,
 * manda a elegirla. Sin eso, cada pantalla tendría que comprobarlo y la que se
 * olvidara llamaría a la API con `locationId=null` — que la API rechaza, pero
 * con un mensaje sobre un parámetro, no sobre lo que la persona tiene que hacer.
 *
 * **P14 no le cambió el comportamiento, solo el aspecto.** Lo que antes eran
 * diez bloques `style={{…}}` ahora son clases de `global.css`; el efecto que
 * redirige, la salida que limpia pase lo que pase y la espera de un ciclo para
 * distinguir «todavía no se leyó» de «no hay» están igual que en la Fase C.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../lib/api';
import { guardarCsrf } from '../lib/csrf';
import { useSucursal } from '../lib/sesion';
import { TEXTOS } from '../textos/es';
import { Isotipo } from './ui/Marca';

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
      guardarCsrf(null);
      router.replace('/entrar');
    }
  }

  return (
    <>
      <header className="barra">
        <div className="barra__interior">
          <nav className="barra__grupo">
            <Isotipo />
            <span className="marca-nombre">{TEXTOS.producto}</span>

            {SECCIONES.map((seccion) => (
              <Link
                key={seccion.href}
                href={seccion.href}
                className="nav-enlace"
                aria-current={ruta === seccion.href ? 'page' : undefined}
              >
                {seccion.texto}
              </Link>
            ))}
          </nav>

          <div className="barra__grupo">
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

        {/*
          La «regla rota» del manual (p. 27), que es el recurso que asigna a
          cintas y encabezados: la línea se parte en su sección áurea y el tramo
          menor —el margen— va en Persimmon.
        */}
        <hr className="regla-rota" />
      </header>

      <main className="lamina">
        <div className="encabezado">
          <div className="pila pila--minima">
            <h1 className="titulo">{titulo}</h1>
            <p className="subtitulo">{ayuda}</p>
          </div>
          {acciones}
        </div>

        {sucursal === null ? null : children}
      </main>
    </>
  );
}
