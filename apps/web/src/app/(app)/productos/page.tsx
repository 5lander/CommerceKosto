'use client';

/**
 * Pantalla 11 — productos: la carta de la empresa y cómo está en la sucursal elegida.
 *
 * **EL PRODUCTO ES DE LA EMPRESA; SI SE VENDE Y A CUÁNTO, DE CADA SUCURSAL**
 * (SPEC §8). Por eso son dos lecturas: `GET /productos`, el maestro, y
 * `GET /productos/ubicaciones` de la sucursal del selector. Un producto que no
 * sale en la segunda **no está configurado ahí**, que no es lo mismo que «no se
 * vende»: la lista lo dice con otra palabra.
 *
 * **LOS FILTROS VAN SOBRE LA LISTA YA LEÍDA**, como en insumos: son decenas de
 * filas, y buscar en ellas no decide nada.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { CampoDeTexto } from '../../../componentes/ui/Campo';
import { Casilla } from '../../../componentes/ui/Casilla';
import { Vacio } from '../../../componentes/ui/Estados';
import { Pildora } from '../../../componentes/ui/Pildora';
import { Selector } from '../../../componentes/ui/Selector';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { llamar } from '../../../lib/api';
import { coincide } from '../../../lib/busqueda';
import { comoImporte } from '../../../lib/decimales';
import { usePermisos } from '../../../lib/permisos';
import { useSucursal } from '../../../lib/sesion';
import { useCarga, type Lectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

interface Producto {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: 'SIMPLE' | 'COMBO';
  readonly categoria: string | null;
  readonly estado: 'ACTIVE' | 'INACTIVE';
}

interface EnLaSucursal {
  readonly productId: string;
  readonly activo: boolean;
  readonly pvp: string | null;
}

interface Carta {
  readonly productos: readonly Producto[];
  /** `null` sin sucursal elegida: las columnas de la sucursal no existen. */
  readonly enLaSucursal: ReadonlyMap<string, EnLaSucursal> | null;
}

interface Filtro {
  readonly texto: string;
  readonly categoria: string;
  readonly conArchivados: boolean;
}

/** Todas las categorías, en el filtro: el valor vacío no filtra. */
const TODAS = '';

function useCarta(sucursal: string | null): Lectura<Carta> {
  const leer = useMemo(
    () => async (): Promise<Carta> => {
      const [productos, configurados] = await Promise.all([
        llamar<readonly Producto[]>({ ruta: '/productos' }),
        sucursal === null
          ? Promise.resolve(null)
          : llamar<readonly EnLaSucursal[]>({ ruta: `/productos/ubicaciones?locationId=${sucursal}` }),
      ]);
      const enLaSucursal = configurados === null ? null : new Map(configurados.map((c) => [c.productId, c]));
      return { productos, enLaSucursal };
    },
    [sucursal],
  );
  return useCarga(leer);
}

export default function Productos(): ReactNode {
  const { tiene } = usePermisos();
  const { sucursal } = useSucursal();
  const lectura = useCarta(sucursal);
  const { productos } = TEXTOS;

  return (
    <Marco
      titulo={productos.titulo}
      ayuda={productos.ayuda}
      acciones={
        tiene('product.write') && (
          <Link href="/productos/nuevo" className="boton" data-variante="primario">
            {TEXTOS.productoDeVenta.nuevo}
          </Link>
        )
      }
    >
      <Vista
        lectura={lectura}
        vacio={{ esVacio: (carta) => carta.productos.length === 0, titulo: productos.vacio, ayuda: productos.vacioAyuda }}
      >
        {(carta) => <CartaFiltrada carta={carta} />}
      </Vista>
    </Marco>
  );
}

function filtrar(lista: readonly Producto[], filtro: Filtro): readonly Producto[] {
  return lista.filter(
    (producto) =>
      coincide(producto.nombre, filtro.texto) &&
      (filtro.categoria === TODAS || producto.categoria === filtro.categoria) &&
      (filtro.conArchivados || producto.estado === 'ACTIVE'),
  );
}

function opcionesDeCategoria(lista: readonly Producto[]) {
  const categorias = [...new Set(lista.map((p) => p.categoria).filter((c) => c !== null))];
  const ordenadas = categorias.sort((a, b) => a.localeCompare(b, 'es'));
  return [{ valor: TODAS, texto: TEXTOS.productos.todasLasCategorias }, ...ordenadas.map((c) => ({ valor: c, texto: c }))];
}

function CartaFiltrada({ carta }: { readonly carta: Carta }): ReactNode {
  const [filtro, setFiltro] = useState<Filtro>({ texto: '', categoria: TODAS, conArchivados: false });
  const visibles = filtrar(carta.productos, filtro);
  const { productos } = TEXTOS;

  function cambiar<K extends keyof Filtro>(campo: K): (valor: Filtro[K]) => void {
    return (valor) => {
      setFiltro((anterior) => ({ ...anterior, [campo]: valor }));
    };
  }

  return (
    <div className="pila pila--apretada">
      <div className="filtros">
        <CampoDeTexto etiqueta={productos.buscar} tipo="search" nombre="buscar" valor={filtro.texto} cambiar={cambiar('texto')} />
        <Selector
          etiqueta={productos.categoria}
          valor={filtro.categoria}
          opciones={opcionesDeCategoria(carta.productos)}
          cambiar={cambiar('categoria')}
        />
      </div>
      <Casilla texto={productos.incluirArchivados} marcada={filtro.conArchivados} cambiar={cambiar('conArchivados')} />
      {visibles.length === 0 ? (
        <Vacio titulo={productos.sinCoincidencias} ayuda={productos.sinCoincidenciasAyuda} />
      ) : (
        <TablaDeProductos lista={visibles} enLaSucursal={carta.enLaSucursal} />
      )}
    </div>
  );
}

function TablaDeProductos({
  lista,
  enLaSucursal,
}: {
  readonly lista: readonly Producto[];
  readonly enLaSucursal: ReadonlyMap<string, EnLaSucursal> | null;
}): ReactNode {
  const { productos } = TEXTOS;

  return (
    <Tabla>
      <thead>
        <tr>
          <th>{productos.producto}</th>
          {enLaSucursal !== null && <th className="izquierda">{productos.enLaSucursal}</th>}
          {enLaSucursal !== null && <th>{productos.pvp}</th>}
        </tr>
      </thead>
      <tbody>
        {lista.map((producto) => (
          <FilaDeProducto key={producto.id} producto={producto} enLaSucursal={enLaSucursal} />
        ))}
      </tbody>
    </Tabla>
  );
}

function FilaDeProducto({
  producto,
  enLaSucursal,
}: {
  readonly producto: Producto;
  readonly enLaSucursal: ReadonlyMap<string, EnLaSucursal> | null;
}): ReactNode {
  const { productos } = TEXTOS;
  const detalle = [
    productos.tipos[producto.tipo],
    producto.categoria ?? productos.sinCategoria,
    producto.estado === 'INACTIVE' ? productos.archivado : null,
  ];

  return (
    <tr>
      <td>
        <Link href={`/productos/${producto.id}`} className="enlace-de-fila">
          {producto.nombre}
        </Link>
        <span className="bloque tenue">{detalle.filter(Boolean).join(' · ')}</span>
      </td>
      {enLaSucursal !== null && <EnEstaSucursal configuracion={enLaSucursal.get(producto.id)} />}
    </tr>
  );
}

/** «Sin configurar» no es «no se vende»: ahí nadie ha decidido todavía. */
function EnEstaSucursal({ configuracion }: { readonly configuracion: EnLaSucursal | undefined }): ReactNode {
  const { productos } = TEXTOS;
  if (configuracion === undefined) {
    return (
      <>
        <td className="izquierda">
          <Pildora tono="atencion" texto={productos.sinConfigurar} />
        </td>
        <td className="numero">{TEXTOS.comun.sinDato}</td>
      </>
    );
  }

  return (
    <>
      <td className="izquierda">
        <Pildora
          tono={configuracion.activo ? 'bien' : 'neutro'}
          texto={configuracion.activo ? productos.seVende : productos.noSeVende}
        />
      </td>
      <td className="numero">{configuracion.pvp === null ? TEXTOS.comun.sinDato : comoImporte(configuracion.pvp)}</td>
    </>
  );
}
