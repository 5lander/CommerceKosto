'use client';

/**
 * Pantalla 11 (ficha) — un producto: sus datos y dónde se vende.
 *
 * **LA CONFIGURACIÓN POR SUCURSAL LA FILTRA LA API POR ALCANCE** (D-16.113): un
 * gerente ve solo la suya, la dueña todas. La ficha no filtra nada; pinta lo que
 * llega, con el nombre de cada sucursal de `GET /ubicaciones`.
 *
 * **EL EMPAQUE ES UN INSUMO** (ADR-008): la ficha trae su id y el nombre sale de
 * su ficha de catálogo. Cambiarlo, el PVP y la activación llegan en la pantalla
 * 12; aquí se leen.
 */

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../../componentes/Marco';
import { Dato } from '../../../../componentes/ui/Dato';
import { Pildora } from '../../../../componentes/ui/Pildora';
import { Tabla } from '../../../../componentes/ui/Tabla';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { llamar } from '../../../../lib/api';
import { comoImporte, sinCerosDeSobra } from '../../../../lib/decimales';
import type { Sucursal } from '../../../../lib/sesion';
import { useCarga, type Lectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

interface FichaDeProducto {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: 'SIMPLE' | 'COMBO';
  readonly categoria: string | null;
  readonly estado: 'ACTIVE' | 'INACTIVE';
  readonly empaqueItemId: string | null;
}

interface Configuracion {
  readonly locationId: string;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

interface ProductoLeido {
  readonly ficha: FichaDeProducto;
  readonly configuraciones: readonly Configuracion[];
  readonly sucursales: ReadonlyMap<string, string>;
  /** El nombre del insumo de empaque, o `null` si no lleva. */
  readonly empaque: string | null;
}

async function nombreDelEmpaque(ficha: FichaDeProducto): Promise<string | null> {
  if (ficha.empaqueItemId === null) return null;
  return (await llamar<{ readonly nombre: string }>({ ruta: `/catalogo/items/${ficha.empaqueItemId}` })).nombre;
}

function useProducto(id: string): Lectura<ProductoLeido> {
  const leer = useMemo(
    () => async (): Promise<ProductoLeido> => {
      const [ficha, configuraciones, sucursales] = await Promise.all([
        llamar<FichaDeProducto>({ ruta: `/productos/${id}` }),
        llamar<readonly Configuracion[]>({ ruta: `/productos/${id}/ubicaciones` }),
        llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
      ]);
      const empaque = await nombreDelEmpaque(ficha);
      return { ficha, configuraciones, sucursales: new Map(sucursales.map((s) => [s.id, s.nombre])), empaque };
    },
    [id],
  );
  return useCarga(leer);
}

export default function FichaDelProducto(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const lectura = useProducto(id);
  const ficha = lectura.datos?.ficha;

  return (
    <Marco
      titulo={ficha?.nombre ?? TEXTOS.productoDeVenta.fichaTitulo}
      ayuda={ficha === undefined ? '' : resumenDe(ficha)}
      acciones={<Volver href="/productos" />}
    >
      <Vista lectura={lectura} vacio="nunca">
        {(leido) => (
          <div className="pila">
            <DatosDelProducto leido={leido} />
            <DondeSeVende leido={leido} />
          </div>
        )}
      </Vista>
    </Marco>
  );
}

function resumenDe(ficha: FichaDeProducto): string {
  const { productos } = TEXTOS;
  const partes = [productos.tipos[ficha.tipo], ficha.categoria ?? productos.sinCategoria];
  return ficha.estado === 'INACTIVE' ? [...partes, productos.archivado].join(' · ') : partes.join(' · ');
}

function DatosDelProducto({ leido }: { readonly leido: ProductoLeido }): ReactNode {
  const { productoDeVenta: producto, productos } = TEXTOS;

  return (
    <section className="panel panel--relleno">
      <dl className="datos">
        <Dato etiqueta={producto.tipo} valor={productos.tipos[leido.ficha.tipo]} />
        <Dato etiqueta={producto.categoria} valor={leido.ficha.categoria ?? productos.sinCategoria} />
        <Dato etiqueta={producto.empaque} valor={leido.empaque ?? producto.sinEmpaque} />
      </dl>
    </section>
  );
}

function DondeSeVende({ leido }: { readonly leido: ProductoLeido }): ReactNode {
  const producto = TEXTOS.productoDeVenta;

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{producto.sucursales}</h2>
      {leido.configuraciones.length === 0 ? (
        <p className="nota">{producto.sinSucursales}</p>
      ) : (
        <Tabla compacta>
          <thead>
            <tr>
              <th>{producto.sucursal}</th>
              <th className="izquierda">{producto.estado}</th>
              <th>{TEXTOS.productos.pvp}</th>
              <th>{producto.porciones}</th>
            </tr>
          </thead>
          <tbody>
            {leido.configuraciones.map((configuracion) => (
              <FilaDeSucursal
                key={configuracion.locationId}
                configuracion={configuracion}
                nombre={leido.sucursales.get(configuracion.locationId)}
              />
            ))}
          </tbody>
        </Tabla>
      )}
    </section>
  );
}

function FilaDeSucursal({
  configuracion,
  nombre,
}: {
  readonly configuracion: Configuracion;
  readonly nombre: string | undefined;
}): ReactNode {
  const { productoDeVenta: producto, productos, comun } = TEXTOS;

  return (
    <tr>
      <td>{nombre ?? comun.sinDato}</td>
      <td className="izquierda">
        <Pildora
          tono={configuracion.activo ? 'bien' : 'neutro'}
          texto={configuracion.activo ? productos.seVende : productos.noSeVende}
        />
      </td>
      <td className="numero">{configuracion.pvp === null ? comun.sinDato : comoImporte(configuracion.pvp)}</td>
      <td className="numero">
        {configuracion.rendimientoPorciones === null
          ? producto.sinCapturar
          : sinCerosDeSobra(configuracion.rendimientoPorciones)}
      </td>
    </tr>
  );
}
