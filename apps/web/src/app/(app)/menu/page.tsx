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
 * **UN SOLO RECURSO.** Hasta P16-A2 se pedían dos —el menú y `GET /costeo`—
 * y se unían por `productId`, porque el DTO no traía el nombre del producto:
 * costear la carta entera para pintar una columna de texto. La API lo publica
 * ahora en `nombre`, así que la segunda llamada y el `Map` se van.
 */

import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { Vista } from '../../../componentes/ui/Vista';
import { comoImporte } from '../../../lib/decimales';
import { consultaDelMes } from '../../../lib/fechas';
import { usePeriodo } from '../../../lib/periodo';
import { useSucursal } from '../../../lib/sesion';
import { useLectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

type Cuadrante = keyof typeof TEXTOS.menu.cuadrantes;

interface ProductoDelMenu {
  readonly productId: string;
  readonly nombre: string;
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

/** El orden en que se leen: primero lo que sostiene el negocio. */
const ORDEN: readonly Cuadrante[] = [
  'ESTRELLA',
  'CABALLO',
  'ROMPECABEZAS',
  'PERRO',
  'SIN_DATOS',
  'INACTIVO',
];

export default function MenuEngineering(): ReactNode {
  const { sucursal } = useSucursal();
  const { periodo } = usePeriodo();
  const lectura = useLectura<Menu>(
    sucursal === null ? null : `/analitica/menu-engineering?locationId=${sucursal}&${consultaDelMes(periodo)}`,
  );

  return (
    <Marco titulo={TEXTOS.menu.titulo} ayuda={TEXTOS.menu.ayuda}>
      <Vista
        lectura={lectura}
        vacio={{
          esVacio: (menu) => menu.productos.every((p) => p.cuadrante === 'INACTIVO'),
          titulo: TEXTOS.menu.vacio,
          ayuda: TEXTOS.menu.vacioAyuda,
        }}
      >
        {(menu) => (
          <div className="pila">
            <Referencia menu={menu} />
            <Matriz menu={menu} />
          </div>
        )}
      </Vista>
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
    <section className="panel panel--relleno pila pila--apretada">
      <div className="dato">
        <span className="etiqueta">{TEXTOS.menu.referencia}</span>
        <strong className="cifra cifra--menor">{comoImporte(menu.mcPromedio)}</strong>
      </div>

      <p className="nota">
        Es el <strong>promedio ponderado por unidades vendidas</strong>, no el promedio simple de los
        platos: <span className="numero">{comoImporte(menu.mcTotal)}</span> de margen total entre{' '}
        <span className="numero">{menu.unidadesConMargen}</span> unidades. Un plato caro que se vende
        una vez al mes no cuenta lo mismo que uno que se vende cien veces.
      </p>

      <p className="nota">
        <strong>Si divides por las {menu.unidadesTotales} unidades totales no te va a dar.</strong>{' '}
        Un producto sin precio de venta no entra ni en el margen total ni en las unidades del
        promedio, y por eso los dos números se enseñan por separado.
      </p>
    </section>
  );
}

function Matriz({ menu }: { readonly menu: Menu }): ReactNode {
  return (
    <div className="pila">
      {ORDEN.map((cuadrante) => {
        const productos = menu.productos.filter((p) => p.cuadrante === cuadrante);
        if (productos.length === 0) return null;

        return (
          <Cuadrante key={cuadrante} cuadrante={cuadrante} productos={productos} />
        );
      })}
    </div>
  );
}

function Cuadrante({
  cuadrante,
  productos,
}: {
  readonly cuadrante: Cuadrante;
  readonly productos: readonly ProductoDelMenu[];
}): ReactNode {
  return (
    <section
      className="panel panel--relleno cuadrante pila pila--apretada"
      data-cuadrante={cuadrante}
    >
      <div className="pila pila--minima">
        <h2 className="cuadrante__titulo">{TEXTOS.menu.cuadrantes[cuadrante]}</h2>
        <p className="nota">{TEXTOS.menu.explicaCuadrante[cuadrante]}</p>
      </div>

      <div className="tabla-marco">
        <table className="tabla tabla--compacta">
          <thead>
            <tr>
              <th>{TEXTOS.costeo.producto}</th>
              <th>{TEXTOS.menu.unidades}</th>
              <th>{TEXTOS.costeo.margen}</th>
              <th>{TEXTOS.menu.indice}</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((producto) => (
              <FilaDelMenu key={producto.productId} producto={producto} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Un decimal de la API a dos decimales, o la raya si no aplica. */
function importeOSinDato(valor: string | null): string {
  return valor === null ? TEXTOS.comun.sinDato : comoImporte(valor);
}

function FilaDelMenu({ producto }: { readonly producto: ProductoDelMenu }): ReactNode {
  return (
    <tr>
      <td>{producto.nombre === '' ? producto.productId : producto.nombre}</td>
      <td className="numero">{producto.unidades}</td>
      <td className="numero">{importeOSinDato(producto.margenContribucion)}</td>
      <td className="numero">{importeOSinDato(producto.indicePopularidad)}</td>
    </tr>
  );
}
