'use client';

/**
 * Pantalla 6 — la ficha de un insumo: sus datos, lo que cuesta, sus
 * presentaciones de compra y la historia de su precio.
 *
 * **CADA NÚMERO VIENE DE LA API.** El costo de uso es la cadena de SPEC §12 que
 * calcula `GET /precios/costo/:itemId`; qué precio está vigente lo dice `vigente`
 * en el historial (P16-B). La pantalla no elige ni divide nada.
 *
 * **ARCHIVAR ES UN `PUT` CON `estado: INACTIVE`**, con la versión que se leyó:
 * no hay borrado (CLAUDE.md §5), y si otra persona guardó entre medias la API
 * responde 409 y la ficha se vuelve a leer.
 */

import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { cambioDe, guardarItem, useInsumo, type Articulo, type FichaDeItem, type Precios } from '../../../../componentes/insumos/ficha';
import { Marco } from '../../../../componentes/Marco';
import { Confirmar } from '../../../../componentes/ui/Confirmar';
import { Pildora } from '../../../../componentes/ui/Pildora';
import { Tabla } from '../../../../componentes/ui/Tabla';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { comoCostoDeUso, comoImporte, comoPorcentaje, sinCerosDeSobra } from '../../../../lib/decimales';
import { comoFecha } from '../../../../lib/fechas';
import { usePermisos } from '../../../../lib/permisos';
import { useEnvio } from '../../../../lib/useEnvio';
import { TEXTOS } from '../../../../textos/es';

export default function FichaDelInsumo(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { tiene } = usePermisos();
  const lectura = useInsumo(id, tiene('pricing.read'));
  const ficha = lectura.datos?.ficha;

  return (
    <Marco
      titulo={ficha?.nombre ?? TEXTOS.insumo.fichaTitulo}
      ayuda={ficha === undefined ? '' : resumenDe(ficha)}
      acciones={<AccionesDeLaFicha id={id} puedeEditar={tiene('catalog.update')} />}
    >
      <Vista lectura={lectura} vacio="nunca">
        {(leido) => (
          <div className="pila">
            <DatosDelInsumo ficha={leido.ficha} />
            {leido.precios !== null && <CostoDelInsumo ficha={leido.ficha} precios={leido.precios} />}
            <ArticulosDelInsumo
              ficha={leido.ficha}
              puedeCrear={tiene('catalog.create')}
              puedeEditar={tiene('catalog.update')}
            />
            {leido.precios !== null && <HistorialDePrecios precios={leido.precios} />}
            {tiene('catalog.update') && <ArchivarInsumo ficha={leido.ficha} recargar={lectura.recargar} />}
          </div>
        )}
      </Vista>
    </Marco>
  );
}

function resumenDe(ficha: FichaDeItem): string {
  const partes = [TEXTOS.insumos.tipos[ficha.tipo], ficha.unidadDeUso];
  return ficha.estado === 'INACTIVE' ? [...partes, TEXTOS.insumos.archivado].join(' · ') : partes.join(' · ');
}

function AccionesDeLaFicha({ id, puedeEditar }: { readonly id: string; readonly puedeEditar: boolean }): ReactNode {
  return (
    <div className="linea">
      <Volver href="/insumos" />
      {puedeEditar && (
        <Link href={`/insumos/${id}/editar`} className="boton">
          {TEXTOS.insumo.editar}
        </Link>
      )}
    </div>
  );
}

function DatosDelInsumo({ ficha }: { readonly ficha: FichaDeItem }): ReactNode {
  const { insumo } = TEXTOS;
  const ivaDelGrupo = ficha.grupo?.ivaTarifa ?? null;

  return (
    <section className="panel panel--relleno">
      <dl className="datos">
        <Dato etiqueta={TEXTOS.insumos.rendimiento} valor={comoPorcentaje(ficha.rendimiento)} />
        <Dato etiqueta={insumo.grupo} valor={ficha.grupo?.nombre ?? insumo.sinGrupo} />
        <Dato
          etiqueta={insumo.ivaDelGrupo}
          valor={ivaDelGrupo === null ? TEXTOS.comun.sinDato : comoPorcentaje(ivaDelGrupo)}
        />
        <Dato etiqueta={insumo.confianza} valor={insumo.confianzas[ficha.confianzaDePrecio]} />
        {ficha.llevaStock !== null && (
          <Dato etiqueta={insumo.llevaStock} valor={ficha.llevaStock ? insumo.llevaStockSi : insumo.llevaStockNo} />
        )}
      </dl>
    </section>
  );
}

function Dato({ etiqueta, valor }: { readonly etiqueta: string; readonly valor: string }): ReactNode {
  return (
    <div className="dato">
      <dt className="etiqueta">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function CostoDelInsumo({ ficha, precios }: { readonly ficha: FichaDeItem; readonly precios: Precios }): ReactNode {
  const { insumo } = TEXTOS;
  const { costo } = precios;
  const porUnidad = (valor: string): string => `${comoCostoDeUso(valor)} / ${ficha.unidadDeUso}`;

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{insumo.costo}</h2>
      {costo === null ? (
        <p className="panel panel--relleno atencion">{insumo.sinPrecioConfirmado}</p>
      ) : (
        <div className="panel panel--relleno">
          <dl className="datos">
            <Dato etiqueta={insumo.costoNeto} valor={porUnidad(costo.costoNetoDeUso)} />
            <Dato etiqueta={insumo.costoBruto} valor={porUnidad(costo.costoBrutoDeUso)} />
            <Dato etiqueta={insumo.sobrecostoDeMerma} valor={porUnidad(costo.sobrecostoDeMerma)} />
            <Dato etiqueta={insumo.vigenteDesde} valor={comoFecha(costo.vigenteDesde)} />
          </dl>
        </div>
      )}
    </section>
  );
}

function ArticulosDelInsumo({
  ficha,
  puedeCrear,
  puedeEditar,
}: {
  readonly ficha: FichaDeItem;
  readonly puedeCrear: boolean;
  readonly puedeEditar: boolean;
}): ReactNode {
  const { insumo } = TEXTOS;
  const { articulos } = ficha;

  return (
    <section className="pila pila--apretada">
      <TituloConAccion
        titulo={insumo.articulos}
        accion={TEXTOS.articulo.nuevo}
        href={puedeCrear ? `/insumos/${ficha.id}/articulos/nuevo` : null}
      />
      {articulos.length === 0 ? (
        <p className="nota">{insumo.sinArticulos}</p>
      ) : (
        <Tabla compacta>
          <thead>
            <tr>
              <th>{insumo.articulo}</th>
              <th>{insumo.presentacion}</th>
              <th>{insumo.ivaDeCompra}</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map((articulo) => (
              <FilaDeArticulo key={articulo.id} itemId={ficha.id} articulo={articulo} editable={puedeEditar} />
            ))}
          </tbody>
        </Tabla>
      )}
    </section>
  );
}

/** Un título de sección con su acción al lado, si la sesión puede hacerla. */
function TituloConAccion<T extends string>({
  titulo,
  accion,
  href,
}: {
  readonly titulo: string;
  readonly accion: string;
  readonly href: Route<T> | null;
}): ReactNode {
  return (
    <div className="linea linea--separada">
      <h2 className="subtitulo">{titulo}</h2>
      {href !== null && (
        <Link href={href} className="boton">
          {accion}
        </Link>
      )}
    </div>
  );
}

function FilaDeArticulo({
  itemId,
  articulo,
  editable,
}: {
  readonly itemId: string;
  readonly articulo: Articulo;
  readonly editable: boolean;
}): ReactNode {
  const detalle = [articulo.marca, articulo.proveedor, articulo.estado === 'INACTIVE' ? TEXTOS.articulo.archivado : null];

  return (
    <tr>
      <td>
        {editable ? (
          <Link href={`/insumos/${itemId}/articulos/${articulo.id}/editar`} className="enlace-de-fila">
            {articulo.nombre}
          </Link>
        ) : (
          articulo.nombre
        )}
        <span className="bloque tenue">{detalle.filter(Boolean).join(' · ')}</span>
      </td>
      <td className="numero">{`${sinCerosDeSobra(articulo.presentacion)} ${articulo.unidadDePresentacion}`}</td>
      <td className="numero">{comoPorcentaje(articulo.ivaTarifa)}</td>
    </tr>
  );
}

const TONO_DEL_PRECIO = { SUGGESTED: 'atencion', CONFIRMED: 'neutro', REJECTED: 'mal' } as const;

function HistorialDePrecios({ precios }: { readonly precios: Precios }): ReactNode {
  const { insumo } = TEXTOS;
  if (precios.historial.length === 0) return <p className="nota">{insumo.sinHistorial}</p>;

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{insumo.historial}</h2>
      <Tabla compacta>
        <thead>
          <tr>
            <th>{insumo.vigenteDesde}</th>
            <th>{insumo.precio}</th>
            <th>{insumo.estadoDelPrecio}</th>
          </tr>
        </thead>
        <tbody>
          {precios.historial.map((precio) => (
            <tr key={precio.id}>
              <td>{comoFecha(precio.validFrom)}</td>
              <td className="numero">{comoImporte(precio.precio)}</td>
              <td>
                {precio.vigente ? (
                  <Pildora tono="bien" texto={insumo.vigente} />
                ) : (
                  <Pildora tono={TONO_DEL_PRECIO[precio.estado]} texto={insumo.estadosDelPrecio[precio.estado]} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </section>
  );
}

function ArchivarInsumo({ ficha, recargar }: { readonly ficha: FichaDeItem; readonly recargar: () => void }): ReactNode {
  const [preguntando, setPreguntando] = useState(false);
  const envio = useEnvio();
  const archivar = ficha.estado === 'ACTIVE';
  const { insumo } = TEXTOS;

  async function confirmar(): Promise<void> {
    const salio = await envio.enviar(async () => {
      await guardarItem(ficha, { ...cambioDe(ficha), estado: archivar ? 'INACTIVE' : 'ACTIVE' });
    });
    if (!salio) return;
    setPreguntando(false);
    recargar();
  }

  if (!preguntando) {
    const preguntar = (): void => {
      setPreguntando(true);
    };
    return (
      <div>
        <button type="button" onClick={preguntar}>
          {archivar ? insumo.archivar : insumo.reactivar}
        </button>
      </div>
    );
  }
  return (
    <Confirmar
      pregunta={archivar ? insumo.archivarPregunta : insumo.reactivarPregunta}
      textoConfirmar={archivar ? insumo.archivarSi : insumo.reactivarSi}
      envio={envio}
      alConfirmar={() => {
        void confirmar();
      }}
      alCancelar={() => {
        setPreguntando(false);
      }}
    />
  );
}
