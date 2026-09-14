'use client';

/**
 * Pantallas 11 y 12 — la ficha de un producto: sus datos, lo que cuesta y deja en
 * la sucursal elegida, su configuración ahí, su empaque y dónde se vende.
 *
 * **LA CONFIGURACIÓN POR SUCURSAL LA FILTRA LA API POR ALCANCE** (D-16.113): un
 * gerente ve solo la suya, la dueña todas. La ficha no filtra nada; pinta lo que
 * llega, con el nombre de cada sucursal de `GET /ubicaciones`.
 *
 * **CADA BLOQUE APARECE CON SU PERMISO**: el costo con `costing.read`, los dos
 * formularios con `product.write`. La frontera sigue siendo el 403 de la API.
 *
 * **TRAS GUARDAR, LA FICHA SE VUELVE A LEER**, y lo que depende de ella se monta
 * otra vez con la `version` nueva como clave: el costo se recalcula con el PVP y
 * el empaque que se acaban de guardar, y un formulario no se queda con la versión
 * vieja para la siguiente escritura.
 */

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Marco } from '../../../../componentes/Marco';
import { ComponentesDelCombo } from '../../../../componentes/productos/ComponentesDelCombo';
import { ConfiguracionEnSucursal } from '../../../../componentes/productos/ConfiguracionEnSucursal';
import { CostoDelProducto } from '../../../../componentes/productos/CostoDelProducto';
import { EmpaqueDelProducto } from '../../../../componentes/productos/EmpaqueDelProducto';
import {
  useProducto,
  type Configuracion,
  type FichaDeProducto,
  type ProductoLeido,
} from '../../../../componentes/productos/ficha';
import { Dato } from '../../../../componentes/ui/Dato';
import { Pildora } from '../../../../componentes/ui/Pildora';
import { Tabla } from '../../../../componentes/ui/Tabla';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { comoImporte, sinCerosDeSobra } from '../../../../lib/decimales';
import { usePermisos } from '../../../../lib/permisos';
import { useSucursal } from '../../../../lib/sesion';
import { TEXTOS } from '../../../../textos/es';

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
        {(leido) => <Bloques leido={leido} recargar={lectura.recargar} />}
      </Vista>
    </Marco>
  );
}

function Bloques({ leido, recargar }: { readonly leido: ProductoLeido; readonly recargar: () => void }): ReactNode {
  const { tiene } = usePermisos();
  const { sucursal } = useSucursal();
  // Una clave por bloque: con la misma en los tres hermanos, React no desmonta los
  // viejos y la ficha acaba con dos costos, uno con la versión anterior.
  const clave = `${sucursal ?? ''}-${String(leido.ficha.version)}`;
  const escribe = tiene('product.write');
  const combo = leido.ficha.tipo === 'COMBO';

  return (
    <div className="pila">
      <DatosDelProducto leido={leido} />
      {combo && <ComponentesDelCombo key={`componentes-${clave}`} productId={leido.ficha.id} />}
      {sucursal !== null && tiene('costing.read') && (
        <CostoDelProducto
          key={`costo-${clave}`}
          productId={leido.ficha.id}
          combo={combo}
          sucursal={sucursal}
          insumos={leido.insumos}
        />
      )}
      {sucursal !== null && escribe && (
        <ConfiguracionEnSucursal key={`configuracion-${clave}`} leido={leido} sucursal={sucursal} recargar={recargar} />
      )}
      {escribe && <EmpaqueDelProducto key={`empaque-${clave}`} leido={leido} recargar={recargar} />}
      <DondeSeVende leido={leido} />
    </div>
  );
}

function resumenDe(ficha: FichaDeProducto): string {
  const { productos } = TEXTOS;
  const partes = [productos.tipos[ficha.tipo], ficha.categoria ?? productos.sinCategoria];
  return ficha.estado === 'INACTIVE' ? [...partes, productos.archivado].join(' · ') : partes.join(' · ');
}

function DatosDelProducto({ leido }: { readonly leido: ProductoLeido }): ReactNode {
  const { productoDeVenta: producto, productos } = TEXTOS;
  const empaque = leido.insumos.find((insumo) => insumo.id === leido.ficha.empaqueItemId);

  return (
    <section className="panel panel--relleno">
      <dl className="datos">
        <Dato etiqueta={producto.tipo} valor={productos.tipos[leido.ficha.tipo]} />
        <Dato etiqueta={producto.categoria} valor={leido.ficha.categoria ?? productos.sinCategoria} />
        <Dato etiqueta={producto.empaque} valor={empaque?.nombre ?? producto.sinEmpaque} />
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
