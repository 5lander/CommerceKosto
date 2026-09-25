'use client';

/**
 * Pantalla 4 — insumos: el catálogo, con lo que cuesta cada uno por unidad de uso.
 *
 * **EL COSTO SOLO SE PIDE SI LA SESIÓN PUEDE LEERLO** (`pricing.read`). `BODEGA`
 * lee el catálogo para contar y no ve la columna, porque la página ni siquiera
 * llama a `GET /precios/costos`: un dato que no se pide no viaja.
 *
 * **SIN PRECIO NO ES CERO** (P16-B). La API manda aparte los insumos sin precio
 * confirmado, y aquí se enseñan como tales: un insumo a cero abarata el plato
 * sin avisar.
 *
 * **LOS FILTROS DE NOMBRE Y GRUPO VAN SOBRE LA LISTA YA LEÍDA**: es una lista de
 * decenas de filas y buscar en ella no decide nada. «Incluir archivados» sí va a
 * la API, que es quien sabe qué está archivado.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { CampoDeTexto } from '../../../componentes/ui/Campo';
import { Casilla } from '../../../componentes/ui/Casilla';
import { Vacio } from '../../../componentes/ui/Estados';
import { Selector } from '../../../componentes/ui/Selector';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { llamar } from '../../../lib/api';
import { coincide } from '../../../lib/busqueda';
import { comoCostoDeUso, comoPorcentaje } from '../../../lib/decimales';
import { usePermisos } from '../../../lib/permisos';
import { useCarga, type Lectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

interface Item {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: 'COMPRADO' | 'PRODUCIDO';
  readonly unidadDeUso: string;
  readonly rendimiento: string;
  readonly grupoId: string | null;
  readonly estado: 'ACTIVE' | 'INACTIVE';
}

interface Grupo {
  readonly id: string;
  readonly nombre: string;
}

interface CostoDeItem {
  readonly itemId: string;
  readonly costoNetoDeUso: string;
}

interface Costos {
  readonly costos: readonly CostoDeItem[];
}

interface Catalogo {
  readonly items: readonly Item[];
  readonly grupos: readonly Grupo[];
  /** `null` cuando la sesión no lee precios: la columna no existe. */
  readonly costos: ReadonlyMap<string, string> | null;
}

/** Todos los grupos, en el filtro: el valor vacío no filtra. */
const TODOS = '';

function useCatalogo(incluirInactivos: boolean, conCostos: boolean): Lectura<Catalogo> {
  const leer = useMemo(
    () => async (): Promise<Catalogo> => {
      const [items, grupos, costos] = await Promise.all([
        llamar<readonly Item[]>({ ruta: `/catalogo/items?incluirInactivos=${String(incluirInactivos)}` }),
        llamar<readonly Grupo[]>({ ruta: '/catalogo/grupos' }),
        conCostos ? llamar<Costos>({ ruta: '/precios/costos' }) : Promise.resolve(null),
      ]);
      const porItem = costos === null ? null : new Map(costos.costos.map((c) => [c.itemId, c.costoNetoDeUso]));
      return { items, grupos, costos: porItem };
    },
    [incluirInactivos, conCostos],
  );
  return useCarga(leer);
}

export default function Insumos(): ReactNode {
  const { tiene } = usePermisos();
  const conCostos = tiene('pricing.read');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const lectura = useCatalogo(incluirInactivos, conCostos);

  return (
    <Marco
      titulo={TEXTOS.insumos.titulo}
      ayuda={conCostos ? TEXTOS.insumos.ayuda : TEXTOS.insumos.ayudaSinCosto}
      acciones={
        tiene('catalog.create') && (
          <Link href="/insumos/nuevo" className="boton" data-variante="primario">
            {TEXTOS.insumo.nuevo}
          </Link>
        )
      }
    >
      <div className="pila">
        <Casilla texto={TEXTOS.insumos.incluirArchivados} marcada={incluirInactivos} cambiar={setIncluirInactivos} />
        <Vista
          lectura={lectura}
          vacio={{
            esVacio: (catalogo) => catalogo.items.length === 0,
            titulo: TEXTOS.insumos.vacio,
            ayuda: TEXTOS.insumos.vacioAyuda,
          }}
        >
          {(catalogo) => <CatalogoFiltrado catalogo={catalogo} />}
        </Vista>
      </div>
    </Marco>
  );
}

function CatalogoFiltrado({ catalogo }: { readonly catalogo: Catalogo }): ReactNode {
  const [texto, setTexto] = useState('');
  const [grupo, setGrupo] = useState(TODOS);
  const visibles = catalogo.items.filter(
    (item) => coincide(item.nombre, texto) && (grupo === TODOS || item.grupoId === grupo),
  );
  const opciones = [
    { valor: TODOS, texto: TEXTOS.insumos.todosLosGrupos },
    ...catalogo.grupos.map((g) => ({ valor: g.id, texto: g.nombre })),
  ];

  return (
    <div className="pila pila--apretada">
      <div className="filtros">
        <CampoDeTexto etiqueta={TEXTOS.insumos.buscar} tipo="search" nombre="buscar" valor={texto} cambiar={setTexto} />
        <Selector etiqueta={TEXTOS.insumos.grupo} valor={grupo} opciones={opciones} cambiar={setGrupo} />
      </div>
      {visibles.length === 0 ? (
        <Vacio titulo={TEXTOS.insumos.sinCoincidencias} ayuda={TEXTOS.insumos.sinCoincidenciasAyuda} />
      ) : (
        <TablaDeInsumos items={visibles} catalogo={catalogo} />
      )}
    </div>
  );
}

function TablaDeInsumos({
  items,
  catalogo,
}: {
  readonly items: readonly Item[];
  readonly catalogo: Catalogo;
}): ReactNode {
  const nombres = new Map(catalogo.grupos.map((g) => [g.id, g.nombre]));

  return (
    <Tabla>
      <thead>
        <tr>
          <th>{TEXTOS.insumos.insumo}</th>
          <th className="izquierda">{TEXTOS.insumos.grupo}</th>
          <th>{TEXTOS.insumos.rendimiento}</th>
          {catalogo.costos !== null && <th>{TEXTOS.insumos.costoDeUso}</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <FilaDeInsumo
            key={item.id}
            item={item}
            grupo={item.grupoId === null ? null : (nombres.get(item.grupoId) ?? null)}
            costos={catalogo.costos}
          />
        ))}
      </tbody>
    </Tabla>
  );
}

function FilaDeInsumo({
  item,
  grupo,
  costos,
}: {
  readonly item: Item;
  readonly grupo: string | null;
  readonly costos: ReadonlyMap<string, string> | null;
}): ReactNode {
  const costo = costos?.get(item.id);

  return (
    <tr>
      <td>
        <Link href={`/insumos/${item.id}`} className="enlace-de-fila">
          {item.nombre}
        </Link>
        <span className="bloque tenue">
          {TEXTOS.insumos.tipos[item.tipo]} · {item.unidadDeUso}
          {item.estado === 'INACTIVE' && ` · ${TEXTOS.insumos.archivado}`}
        </span>
      </td>
      <td className="izquierda">{grupo ?? TEXTOS.comun.sinDato}</td>
      <td className="numero">{comoPorcentaje(item.rendimiento)}</td>
      {costos !== null && (
        <td className={costo === undefined ? 'numero atencion' : 'numero'}>
          {costo === undefined ? TEXTOS.insumos.sinPrecio : `${comoCostoDeUso(costo)} / ${item.unidadDeUso}`}
        </td>
      )}
    </tr>
  );
}
