'use client';

/**
 * Pantalla 10 — sugerir un precio de referencia (`POST /precios`).
 *
 * **SUGERIR NO MUEVE NINGÚN COSTO** (R5): el precio nace `SUGGESTED` y espera en
 * la bandeja a quien tenga `pricing.confirm`. Por eso, al terminar, la pantalla
 * lleva a la bandeja y no a la ficha: es donde se ve que falta decidirlo.
 *
 * **EL ORIGEN ES SIEMPRE `MANUAL`.** `ULTIMA_COMPRA` lo pone el sistema al
 * registrar una compra y `EXTERNO` queda fuera de alcance (D8): ninguno de los
 * dos es algo que una persona elija escribiendo un número.
 *
 * **COMPRADO O PRODUCIDO CAMBIAN LO QUE SE PIDE**, y lo decide el `tipo` de la
 * ficha que devuelve la API. Un insumo comprado necesita su presentación —«2.30»
 * solo dice algo junto a «el saco de 2 kg»— y admite la tarifa de la factura;
 * una preparación lleva su costo estándar por unidad de uso, sin presentación ni
 * IVA (R10, D-16.51). Si la combinación no vale, el 400 de la API dice por qué.
 *
 * **EL IVA VACÍO VIAJA COMO `null`** y la API toma el de la presentación o el del
 * grupo; `0` declara una compra exenta. No es lo mismo, y la pantalla no los
 * confunde.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { useInsumo, type FichaDeItem, type InsumoLeido } from '../../../../componentes/insumos/ficha';
import { Marco } from '../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../componentes/ui/Campo';
import { CampoDeCantidad, CampoDePorcentaje } from '../../../../componentes/ui/CampoNumerico';
import { Cargando } from '../../../../componentes/ui/Estados';
import { Formulario } from '../../../../componentes/ui/Formulario';
import { Selector } from '../../../../componentes/ui/Selector';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { llamar } from '../../../../lib/api';
import { textoOpcional } from '../../../../lib/campos';
import { comoCostoDeUso, comoPorcentaje, conPuntoDecimal, fraccionDePorcentaje, sinCerosDeSobra } from '../../../../lib/decimales';
import { comoFecha, diaDeHoy, instanteDelDia } from '../../../../lib/fechas';
import { usePermisos } from '../../../../lib/permisos';
import { useEnvio } from '../../../../lib/useEnvio';
import { useLectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

interface ItemDelCatalogo {
  readonly id: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
}

interface Borrador {
  readonly articuloId: string;
  readonly precio: string;
  readonly iva: string;
  readonly desde: string;
  readonly nota: string;
}

/** El valor del selector de insumo mientras no se ha elegido ninguno. */
const SIN_INSUMO = '';

export default function NuevoPrecio(): ReactNode {
  return (
    <Permitido permiso="pricing.suggest">
      <Suspense fallback={<Cargando />}>
        <SugerirPrecio />
      </Suspense>
    </Permitido>
  );
}

function SugerirPrecio(): ReactNode {
  const desdeLaFicha = useSearchParams().get('itemId');
  const [itemId, setItemId] = useState(desdeLaFicha ?? SIN_INSUMO);
  const items = useLectura<readonly ItemDelCatalogo[]>('/catalogo/items');
  const { precioNuevo } = TEXTOS;

  return (
    <Marco
      titulo={precioNuevo.titulo}
      ayuda={precioNuevo.ayuda}
      acciones={desdeLaFicha === null ? <Volver href="/precios" /> : <Volver href={`/insumos/${desdeLaFicha}`} />}
    >
      <Vista
        lectura={items}
        vacio={{ esVacio: (lista) => lista.length === 0, titulo: precioNuevo.sinInsumos, ayuda: precioNuevo.sinInsumosAyuda }}
      >
        {(lista) => (
          <div className="pila">
            <div className="formulario">
              <Selector etiqueta={precioNuevo.insumo} valor={itemId} opciones={opcionesDeInsumos(lista)} cambiar={setItemId} />
            </div>
            {itemId !== SIN_INSUMO && <ParaElInsumo key={itemId} itemId={itemId} />}
          </div>
        )}
      </Vista>
    </Marco>
  );
}

function opcionesDeInsumos(lista: readonly ItemDelCatalogo[]) {
  return [
    { valor: SIN_INSUMO, texto: TEXTOS.precioNuevo.eligeInsumo },
    ...lista.map((item) => ({ valor: item.id, texto: `${item.nombre} (${item.unidadDeUso})` })),
  ];
}

function ParaElInsumo({ itemId }: { readonly itemId: string }): ReactNode {
  const lectura = useInsumo(itemId, true);

  return (
    <Vista lectura={lectura} vacio="nunca">
      {(leido) => (
        <div className="pila pila--apretada">
          <PrecioVigente leido={leido} />
          {leido.ficha.tipo === 'COMPRADO' && sinPresentaciones(leido.ficha) ? (
            <SinPresentaciones ficha={leido.ficha} />
          ) : (
            <FormularioDePrecio ficha={leido.ficha} />
          )}
        </div>
      )}
    </Vista>
  );
}

/** Contra qué se compara lo que se va a escribir: el precio que manda hoy. */
function PrecioVigente({ leido }: { readonly leido: InsumoLeido }): ReactNode {
  const vigente = leido.precios?.historial.find((precio) => precio.vigente);
  const { precioNuevo } = TEXTOS;
  if (vigente === undefined) return <p className="nota">{precioNuevo.sinVigente}</p>;

  return (
    <p className="nota">
      {`${precioNuevo.vigente} ${comoCostoDeUso(vigente.precio)} · ${TEXTOS.precios.desde} ${comoFecha(vigente.validFrom)}`}
    </p>
  );
}

function activasDe(ficha: FichaDeItem) {
  return ficha.articulos.filter((articulo) => articulo.estado === 'ACTIVE');
}

function sinPresentaciones(ficha: FichaDeItem): boolean {
  return activasDe(ficha).length === 0;
}

function SinPresentaciones({ ficha }: { readonly ficha: FichaDeItem }): ReactNode {
  const { tiene } = usePermisos();

  return (
    <div className="pila pila--apretada">
      <p className="panel panel--relleno atencion">{TEXTOS.precioNuevo.sinPresentaciones}</p>
      {tiene('catalog.create') && (
        <div>
          <Link href={`/insumos/${ficha.id}/articulos/nuevo`} className="boton">
            {TEXTOS.precioNuevo.crearPresentacion}
          </Link>
        </div>
      )}
    </div>
  );
}

/** El cuerpo de `POST /precios`. Una preparación va sin presentación y sin tarifa. */
function cuerpoDe(ficha: FichaDeItem, borrador: Borrador) {
  const comprado = ficha.tipo === 'COMPRADO';
  const conIva = comprado && borrador.iva.trim() !== '';
  return {
    itemId: ficha.id,
    purchaseArticleId: comprado ? borrador.articuloId : null,
    precio: conPuntoDecimal(borrador.precio),
    ivaCompra: conIva ? fraccionDePorcentaje(borrador.iva) : null,
    origen: 'MANUAL',
    validFrom: instanteDelDia(borrador.desde),
    nota: textoOpcional(borrador.nota),
  };
}

function useSugerencia(ficha: FichaDeItem) {
  const router = useRouter();
  const envio = useEnvio();
  const [borrador, setBorrador] = useState<Borrador>(() => ({
    articuloId: activasDe(ficha)[0]?.id ?? '',
    precio: '',
    iva: '',
    desde: diaDeHoy(),
    nota: '',
  }));

  function cambiar(campo: keyof Borrador): (valor: string) => void {
    return (valor) => {
      setBorrador((anterior) => ({ ...anterior, [campo]: valor }));
    };
  }

  async function guardar(): Promise<void> {
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/precios', metodo: 'POST', cuerpo: cuerpoDe(ficha, borrador) });
    });
    if (salio) router.push('/precios');
  }

  return { borrador, cambiar, envio, guardar };
}

function FormularioDePrecio({ ficha }: { readonly ficha: FichaDeItem }): ReactNode {
  const { borrador, cambiar, envio, guardar } = useSugerencia(ficha);
  const { precioNuevo } = TEXTOS;

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={precioNuevo.crear} textoEnviando={precioNuevo.creando}>
      {ficha.tipo === 'COMPRADO' ? (
        <CamposDeCompra ficha={ficha} borrador={borrador} cambiar={cambiar} />
      ) : (
        <>
          <CampoDeCantidad
            etiqueta={`${precioNuevo.costoEstandar} ${ficha.unidadDeUso}`}
            nombre="precio"
            requerido
            valor={borrador.precio}
            cambiar={cambiar('precio')}
          />
          <p className="nota">{precioNuevo.costoEstandarAyuda}</p>
        </>
      )}
      <CampoDeTexto etiqueta={precioNuevo.desde} nombre="desde" tipo="date" requerido valor={borrador.desde} cambiar={cambiar('desde')} />
      <CampoDeTexto etiqueta={precioNuevo.nota} nombre="nota" valor={borrador.nota} cambiar={cambiar('nota')} />
    </Formulario>
  );
}

function CamposDeCompra({
  ficha,
  borrador,
  cambiar,
}: {
  readonly ficha: FichaDeItem;
  readonly borrador: Borrador;
  readonly cambiar: (campo: keyof Borrador) => (valor: string) => void;
}): ReactNode {
  const { precioNuevo } = TEXTOS;
  const presentaciones = activasDe(ficha).map((articulo) => ({
    valor: articulo.id,
    texto: `${articulo.nombre} — ${sinCerosDeSobra(articulo.presentacion)} ${articulo.unidadDePresentacion} · ${TEXTOS.precios.iva} ${comoPorcentaje(articulo.ivaTarifa)}`,
  }));

  return (
    <>
      <Selector etiqueta={precioNuevo.presentacion} valor={borrador.articuloId} opciones={presentaciones} cambiar={cambiar('articuloId')} />
      <CampoDeCantidad etiqueta={precioNuevo.precio} nombre="precio" requerido valor={borrador.precio} cambiar={cambiar('precio')} />
      <CampoDePorcentaje etiqueta={precioNuevo.iva} nombre="iva" valor={borrador.iva} cambiar={cambiar('iva')} />
      <p className="nota">{precioNuevo.ivaAyuda}</p>
    </>
  );
}
