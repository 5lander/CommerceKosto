'use client';

/**
 * Pantalla 3 — ingeniería de menú (Kasavana-Smith).
 *
 * **EL MC DE REFERENCIA ESTÁ A LA VISTA, Y CON SUS DOS OPERANDOS.** Es lo que
 * A.7 dejó servido y la razón por la que existe: el Excel del que viene este
 * modelo usa `AVERAGE`, que es la media simple, mientras que aquí el promedio es
 * **ponderado por unidades** (SPEC §15, Kasavana-Smith canónico). Un cliente que
 * compare las dos hojas verá dos números distintos, y con `mcTotal` y
 * `unidadesConMargen` delante puede rehacer la división y ver por qué **sin
 * llamar a nadie**.
 *
 * Y la trampa que hay que decir en voz alta: **`unidadesConMargen` NO es
 * `unidadesTotales`**. Un producto sin PVP no entra ni en el numerador ni en el
 * denominador, así que quien divida por el total obtendrá otro número — y
 * tendrá razón. Por eso los dos se enseñan por separado.
 *
 * **SE PIDEN DOS RECURSOS Y SE UNEN POR `productId`.** El DTO de menu
 * engineering no trae el nombre del producto, y unir por clave no es lógica de
 * negocio: no se calcula nada, se busca. Queda anotado que lo limpio sería que
 * la API publicara el nombre.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/Estados';
import { Marco } from '../../componentes/Marco';
import { llamar } from '../../lib/api';
import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';

type Cuadrante = keyof typeof TEXTOS.menu.cuadrantes;

interface ProductoDelMenu {
  readonly productId: string;
  readonly unidades: string;
  readonly indicePopularidad: string | null;
  readonly margenContribucion: string | null;
  readonly cuadrante: string;
}

interface Menu {
  readonly productos: readonly ProductoDelMenu[];
  readonly mcPromedio: string | null;
  readonly mcTotal: string | null;
  readonly unidadesConMargen: string;
  readonly metodoMcPromedio: string;
  readonly unidadesTotales: string;
  readonly productosActivos: number;
}

interface Carta {
  readonly productos: readonly { readonly productId: string; readonly nombre: string }[];
}

/** El orden en que se leen: primero lo que sostiene el negocio. */
const ORDEN: readonly Cuadrante[] = [
  'ESTRELLA',
  'CABALLO',
  'ROMPECABEZAS',
  'PERRO',
  'SIN_DATOS',
  'INACTIVO',
];

const COLOR: Readonly<Record<Cuadrante, string>> = {
  ESTRELLA: 'var(--color-bien)',
  CABALLO: 'var(--color-atencion)',
  ROMPECABEZAS: 'var(--color-atencion)',
  PERRO: 'var(--color-mal)',
  SIN_DATOS: 'var(--color-texto-tenue)',
  INACTIVO: 'var(--color-texto-tenue)',
};

function mesActual(): { readonly anio: number; readonly mes: number } {
  const ahora = new Date();
  return { anio: ahora.getUTCFullYear(), mes: ahora.getUTCMonth() + 1 };
}

export default function MenuEngineering(): ReactNode {
  const { sucursal } = useSucursal();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [nombres, setNombres] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    if (sucursal === null) return;
    setError(null);
    setMenu(null);

    const { anio, mes } = mesActual();
    const periodo = `locationId=${sucursal}&anio=${String(anio)}&mes=${String(mes)}`;

    try {
      const [vista, carta] = await Promise.all([
        llamar<Menu>({ ruta: `/analitica/menu-engineering?${periodo}` }),
        llamar<Carta>({ ruta: `/costeo?locationId=${sucursal}` }),
      ]);

      setNombres(new Map(carta.productos.map((p) => [p.productId, p.nombre])));
      setMenu(vista);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    }
  }, [sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const conVentas = menu?.productos.filter((p) => p.cuadrante !== 'INACTIVO') ?? [];

  return (
    <Marco titulo={TEXTOS.menu.titulo} ayuda={TEXTOS.menu.ayuda}>
      {error !== null && (
        <Fallo
          mensaje={error}
          reintentar={() => {
            void cargar();
          }}
        />
      )}

      {error === null && menu === null && <Cargando />}

      {menu !== null && conVentas.length === 0 && (
        <Vacio titulo={TEXTOS.menu.vacio} ayuda={TEXTOS.menu.vacioAyuda} />
      )}

      {menu !== null && conVentas.length > 0 && (
        <>
          <Referencia menu={menu} />
          <Matriz menu={menu} nombres={nombres} />
        </>
      )}
    </Marco>
  );
}

/**
 * El MC de referencia, con la frase que explica por qué su Excel da otro número.
 *
 * **La frase la escribe el frontend, no la API** (D11): el backend da números, y
 * la capa que habla con la persona decide cómo se dicen.
 */
function Referencia({ menu }: { readonly menu: Menu }): ReactNode {
  if (menu.mcPromedio === null || menu.mcTotal === null) return null;

  return (
    <section
      style={{
        background: 'var(--color-superficie)',
        border: '1px solid var(--color-borde)',
        borderRadius: 'var(--radio-lg)',
        padding: 'var(--espacio-4)',
        marginBottom: 'var(--espacio-6)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--espacio-3)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--color-texto-suave)' }}>{TEXTOS.menu.referencia}</span>
        <strong className="numero" style={{ fontSize: 'var(--texto-xl)' }}>
          {menu.mcPromedio}
        </strong>
      </div>

      <p style={{ margin: 'var(--espacio-3) 0 0', color: 'var(--color-texto-suave)', fontSize: 'var(--texto-sm)' }}>
        Es el <strong>promedio ponderado por unidades vendidas</strong>, no el promedio simple de los
        platos: <span className="numero">{menu.mcTotal}</span> de margen total entre{' '}
        <span className="numero">{menu.unidadesConMargen}</span> unidades. Un plato caro que se vende
        una vez al mes no cuenta lo mismo que uno que se vende cien veces.
      </p>

      <p style={{ margin: 'var(--espacio-2) 0 0', color: 'var(--color-texto-suave)', fontSize: 'var(--texto-sm)' }}>
        <strong>Si divides por las {menu.unidadesTotales} unidades totales no te va a dar.</strong>{' '}
        Un producto sin precio de venta no entra ni en el margen total ni en las unidades del
        promedio, y por eso los dos números se enseñan por separado.
      </p>
    </section>
  );
}

function Matriz({
  menu,
  nombres,
}: {
  readonly menu: Menu;
  readonly nombres: ReadonlyMap<string, string>;
}): ReactNode {
  return (
    <div style={{ display: 'grid', gap: 'var(--espacio-4)' }}>
      {ORDEN.map((cuadrante) => {
        const productos = menu.productos.filter((p) => p.cuadrante === cuadrante);
        if (productos.length === 0) return null;

        return (
          <section
            key={cuadrante}
            style={{
              background: 'var(--color-superficie)',
              border: '1px solid var(--color-borde)',
              borderLeft: `4px solid ${COLOR[cuadrante]}`,
              borderRadius: 'var(--radio-lg)',
              padding: 'var(--espacio-4)',
            }}
          >
            <h2 style={{ fontSize: 'var(--texto-lg)', color: COLOR[cuadrante] }}>
              {TEXTOS.menu.cuadrantes[cuadrante]}
            </h2>
            <p style={{ margin: 'var(--espacio-1) 0 var(--espacio-3)', color: 'var(--color-texto-suave)', fontSize: 'var(--texto-sm)' }}>
              {TEXTOS.menu.explicaCuadrante[cuadrante]}
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--texto-sm)' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 'var(--espacio-2)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.costeo.producto}
                  </th>
                  <th style={{ textAlign: 'right', padding: 'var(--espacio-2)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.menu.unidades}
                  </th>
                  <th style={{ textAlign: 'right', padding: 'var(--espacio-2)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.costeo.margen}
                  </th>
                  <th style={{ textAlign: 'right', padding: 'var(--espacio-2)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.menu.indice}
                  </th>
                </tr>
              </thead>
              <tbody>
                {productos.map((producto) => (
                  <tr key={producto.productId} style={{ borderTop: '1px solid var(--color-borde)' }}>
                    <td style={{ padding: 'var(--espacio-2)' }}>
                      {nombres.get(producto.productId) ?? producto.productId}
                    </td>
                    <td className="numero" style={{ padding: 'var(--espacio-2)' }}>
                      {producto.unidades}
                    </td>
                    <td className="numero" style={{ padding: 'var(--espacio-2)' }}>
                      {producto.margenContribucion ?? '—'}
                    </td>
                    <td className="numero" style={{ padding: 'var(--espacio-2)' }}>
                      {producto.indicePopularidad ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
