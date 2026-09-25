'use client';

/**
 * Lo que cuesta y deja el producto en la sucursal elegida, el simulador de PVP y
 * el desglose de su costo — `GET /costeo/:productId`.
 *
 * **NI UN CÁLCULO AQUÍ**, igual que en la tabla de costeo: los costos, la venta
 * neta, el margen, el food cost, el multiplicador y su semáforo vienen hechos.
 *
 * **SIMULAR ES LA MISMA LECTURA CON `?pvp=`** (D-16.107): la API recalcula el lado
 * de la venta con la función del costeo real y no escribe nada. Por eso la
 * simulación se enseña al lado de lo real, no en su lugar.
 *
 * **SIN RECETA NO HAY COSTO** (P16-D): los ceros de la API se dicen como lo que
 * son, y no se ofrece simular un food cost sobre nada.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { comoImporte, comoPorcentaje, conPuntoDecimal } from '../../lib/decimales';
import { useEnvio } from '../../lib/useEnvio';
import { useLectura } from '../../lib/useLectura';
import { TEXTOS } from '../../textos/es';
import type { ProductoCosteado, Semaforo, Venta } from '../costeo/tipos';
import { CampoDeCantidad } from '../ui/CampoNumerico';
import { Formulario } from '../ui/Formulario';
import { Indicador } from '../ui/Indicador';
import { Vista } from '../ui/Vista';
import { DesgloseDelCosto } from './DesgloseDelCosto';
import type { InsumoDelCatalogo } from './ficha';

interface CosteoDeProducto extends ProductoCosteado {
  readonly pvpSimulado: string | null;
}

export function CostoDelProducto({
  productId,
  combo,
  sucursal,
  insumos,
}: {
  readonly productId: string;
  /** Un combo sin nada que costear no tiene receta que escribir: le faltan componentes. */
  readonly combo: boolean;
  readonly sucursal: string;
  readonly insumos: readonly InsumoDelCatalogo[];
}): ReactNode {
  const lectura = useLectura<CosteoDeProducto>(`/costeo/${productId}?locationId=${sucursal}`);

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{TEXTOS.productoDeVenta.costoTitulo}</h2>
      <Vista lectura={lectura} vacio="nunca">
        {(costeo) =>
          costeo.sinReceta ? (
            <p className="panel panel--relleno atencion">
              {combo ? TEXTOS.componentes.sinComponentes : TEXTOS.costeo.sinReceta}
            </p>
          ) : (
            <div className="pila">
              <CostoYVenta costeo={costeo} />
              <Simulador productId={productId} sucursal={sucursal} />
              {costeo.costos.lineas !== null && <DesgloseDelCosto lineas={costeo.costos.lineas} insumos={insumos} />}
            </div>
          )
        }
      </Vista>
    </section>
  );
}

function CostoYVenta({ costeo }: { readonly costeo: CosteoDeProducto }): ReactNode {
  const { costeo: texto, productoDeVenta } = TEXTOS;
  const { costos } = costeo;

  return (
    <div className="pila pila--apretada">
      <div className="indicadores">
        <Indicador etiqueta={productoDeVenta.costoPorPorcion} valor={costos.costoPorPorcion.mostrar} />
        {/* Sin este paso, «porción + empaque» no da el total a la vista: la provisión de merma va en medio (§14). */}
        <Indicador etiqueta={productoDeVenta.costoConMerma} valor={costos.costoConMerma.mostrar} />
        <Indicador etiqueta={productoDeVenta.empaque} valor={costos.empaqueNeto.mostrar} />
        <Indicador etiqueta={texto.costoTotal} valor={costos.costoTotalUnidad.mostrar} />
      </div>
      {costeo.itemsSinCosto.length > 0 && (
        <p className="nota atencion">{`${texto.sinPrecio} ${costeo.itemsSinCosto.join(', ')}`}</p>
      )}
      <IndicadoresDeVenta venta={costeo.venta} semaforo={costeo.semaforoFoodCost} />
    </div>
  );
}

function IndicadoresDeVenta({ venta, semaforo }: { readonly venta: Venta; readonly semaforo: Semaforo }): ReactNode {
  const texto = TEXTOS.costeo;
  if (!venta.vendible) return <p className="nota">{venta.motivo}</p>;

  return (
    <div className="indicadores">
      <Indicador etiqueta={texto.ventaNeta} valor={venta.ventaNeta.mostrar} />
      <Indicador etiqueta={texto.margen} valor={venta.margenContribucion.mostrar} />
      <Indicador etiqueta={texto.foodCost} valor={comoPorcentaje(venta.foodCostPct)} semaforo={semaforo} />
      <Indicador
        etiqueta={texto.multiplicador}
        valor={venta.multiplicador === null ? TEXTOS.comun.sinDato : comoImporte(venta.multiplicador)}
      />
    </div>
  );
}

function Simulador({ productId, sucursal }: { readonly productId: string; readonly sucursal: string }): ReactNode {
  const envio = useEnvio();
  const [pvp, setPvp] = useState('');
  const [simulado, setSimulado] = useState<CosteoDeProducto | null>(null);
  const texto = TEXTOS.productoDeVenta;
  const pvpSimulado = simulado?.pvpSimulado ?? null;

  async function simular(): Promise<void> {
    setSimulado(null);
    await envio.enviar(async () => {
      const ruta = `/costeo/${productId}?locationId=${sucursal}&pvp=${encodeURIComponent(conPuntoDecimal(pvp))}`;
      setSimulado(await llamar<CosteoDeProducto>({ ruta }));
    });
  }

  return (
    <div className="pila pila--apretada">
      <h3 className="subtitulo">{texto.simuladorTitulo}</h3>
      <Formulario envio={envio} alEnviar={simular} textoDelBoton={texto.simular} textoEnviando={texto.simulando}>
        <CampoDeCantidad etiqueta={texto.pvpASimular} nombre="pvpSimulado" requerido valor={pvp} cambiar={setPvp} />
        <p className="nota">{texto.simuladorAyuda}</p>
      </Formulario>
      {simulado !== null && pvpSimulado !== null && (
        <div className="pila pila--minima">
          <p className="etiqueta">{`${texto.conPvp} ${comoImporte(pvpSimulado)}`}</p>
          <IndicadoresDeVenta venta={simulado.venta} semaforo={simulado.semaforoFoodCost} />
        </div>
      )}
    </div>
  );
}
