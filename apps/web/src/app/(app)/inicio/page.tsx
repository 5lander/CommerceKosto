'use client';

/**
 * Pantalla 2 — Inicio: el mes de la sucursal de un vistazo (U2).
 *
 * **DOS PANTALLAS SEGÚN LO QUE LA SESIÓN PUEDE LEER, Y LA FRONTERA ES LA API.**
 * Quien tiene `analytics.read` ve el resumen del mes: venta, food cost, varianza,
 * utilidad, prime cost. `BODEGA` no lo tiene —el resumen se construye con el
 * consumo teórico, que despeja la receta (CLAUDE.md §4.3)— y ve lo único de las
 * vistas que le corresponde: qué reponer, sin la cantidad que lo origina. Aquí
 * no se deduce del rol: se pregunta por el permiso, y si alguien llegara al
 * resumen sin tenerlo, la API contestaría 403.
 *
 * **NI UN CÁLCULO.** Cada cifra y cada color vienen de `GET /analitica/resumen`;
 * esta pantalla redondea para enseñar (`lib/decimales`) y pone la etiqueta.
 *
 * **EL SEMÁFORO DEL FOOD COST ES EL DEL REAL**, no el del teórico: es el que la
 * API juzga contra los umbrales de la company, y por eso el color va en esa
 * tarjeta y no en la otra.
 */

import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { Indicador } from '../../../componentes/ui/Indicador';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { comoImporte, comoPorcentaje, enPuntos } from '../../../lib/decimales';
import { consultaDelMes } from '../../../lib/fechas';
import { usePeriodo } from '../../../lib/periodo';
import { usePermisos } from '../../../lib/permisos';
import { useSucursal } from '../../../lib/sesion';
import { useLectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

type Semaforo = 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';

interface Resumen {
  readonly ventaNetaMes: string;
  readonly foodCostTeoricoPct: string | null;
  readonly foodCostRealPct: string | null;
  readonly brechaEnPuntos: string | null;
  readonly varianzaUsd: string;
  readonly varianzaPct: string | null;
  readonly utilidadOperativa: string;
  readonly primeCostPct: string | null;
  readonly margenDeSeguridad: string | null;
  readonly coberturaDelConteo: string | null;
  readonly itemsPorReponer: number;
  readonly itemsSinCosto: number;
  readonly semaforoFoodCost: Semaforo;
  readonly semaforoVarianza: Semaforo;
  readonly semaforoPrimeCost: Semaforo;
  readonly semaforoUtilidad: Semaforo;
}

interface FilaDeReposicion {
  readonly itemId: string;
  readonly nombre: string;
  readonly semaforo: 'REPONER' | 'OK';
}

/** Un porcentaje de la API, o la raya si no se puede medir (venta cero, sin conteo). */
function porcentajeOSinDato(valor: string | null): string {
  return valor === null ? TEXTOS.comun.sinDato : comoPorcentaje(valor);
}

/** La ruta de una vista del mes para la sucursal, o `null` mientras no hay sucursal. */
function useRutaDelMes(vista: string): string | null {
  const { sucursal } = useSucursal();
  const { periodo } = usePeriodo();
  return sucursal === null ? null : `/analitica/${vista}?locationId=${sucursal}&${consultaDelMes(periodo)}`;
}

export default function Inicio(): ReactNode {
  const { tiene } = usePermisos();

  return (
    <Marco titulo={TEXTOS.inicio.titulo} ayuda={TEXTOS.inicio.ayuda}>
      {tiene('analytics.read') ? <ResumenDelMes /> : <ReposicionDelMes />}
    </Marco>
  );
}

function ResumenDelMes(): ReactNode {
  const lectura = useLectura<Resumen>(useRutaDelMes('resumen'));

  return (
    // Sin estado vacío propio: un mes sin nada es `PERIODO_SIN_DATOS`, y `Vista` lo pinta.
    <Vista lectura={lectura} vacio="nunca">
      {(resumen) => (
        <div className="pila">
          <IndicadoresDeVenta resumen={resumen} />
          <IndicadoresDeOperacion resumen={resumen} />
        </div>
      )}
    </Vista>
  );
}

function IndicadoresDeVenta({ resumen }: { readonly resumen: Resumen }): ReactNode {
  const { inicio } = TEXTOS;

  return (
    <section className="indicadores" aria-label={inicio.venta}>
      <Indicador etiqueta={inicio.ventaNeta} valor={comoImporte(resumen.ventaNetaMes)} />
      <Indicador
        etiqueta={inicio.foodCostReal}
        valor={porcentajeOSinDato(resumen.foodCostRealPct)}
        semaforo={resumen.semaforoFoodCost}
        detalle={`${inicio.teorico} ${porcentajeOSinDato(resumen.foodCostTeoricoPct)}`}
      />
      <Indicador
        etiqueta={inicio.brecha}
        valor={resumen.brechaEnPuntos === null ? TEXTOS.comun.sinDato : enPuntos(resumen.brechaEnPuntos)}
      />
      <Indicador
        etiqueta={inicio.utilidad}
        valor={comoImporte(resumen.utilidadOperativa)}
        semaforo={resumen.semaforoUtilidad}
        detalle={`${inicio.margenDeSeguridad} ${porcentajeOSinDato(resumen.margenDeSeguridad)}`}
      />
      <Indicador
        etiqueta={inicio.primeCost}
        valor={porcentajeOSinDato(resumen.primeCostPct)}
        semaforo={resumen.semaforoPrimeCost}
      />
    </section>
  );
}

function IndicadoresDeOperacion({ resumen }: { readonly resumen: Resumen }): ReactNode {
  const { inicio } = TEXTOS;

  return (
    <section className="indicadores" aria-label={inicio.operacion}>
      <Indicador
        etiqueta={inicio.varianza}
        valor={comoImporte(resumen.varianzaUsd)}
        semaforo={resumen.semaforoVarianza}
        detalle={porcentajeOSinDato(resumen.varianzaPct)}
      />
      <Indicador
        etiqueta={inicio.cobertura}
        valor={porcentajeOSinDato(resumen.coberturaDelConteo)}
        {...(resumen.coberturaDelConteo === null && { detalle: inicio.sinConteo })}
      />
      <Indicador etiqueta={inicio.porReponer} valor={String(resumen.itemsPorReponer)} />
      <Indicador etiqueta={inicio.sinCosto} valor={String(resumen.itemsSinCosto)} />
    </section>
  );
}

function ReposicionDelMes(): ReactNode {
  const lectura = useLectura<readonly FilaDeReposicion[]>(useRutaDelMes('reposicion'));

  return (
    <Vista
      lectura={lectura}
      vacio={{
        esVacio: (filas) => filas.length === 0,
        titulo: TEXTOS.inicio.sinItems,
        ayuda: TEXTOS.inicio.sinItemsAyuda,
      }}
    >
      {(filas) => <TablaDeReposicion filas={filas} />}
    </Vista>
  );
}

/** Primero lo que hay que reponer: es lo que se viene a mirar. */
function TablaDeReposicion({ filas }: { readonly filas: readonly FilaDeReposicion[] }): ReactNode {
  const ordenadas = [
    ...filas.filter((fila) => fila.semaforo === 'REPONER'),
    ...filas.filter((fila) => fila.semaforo !== 'REPONER'),
  ];

  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{TEXTOS.inicio.reposicion}</h2>
      <Tabla>
        <thead>
          <tr>
            <th>{TEXTOS.inventario.item}</th>
            <th>{TEXTOS.inicio.estado}</th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((fila) => (
            <tr key={fila.itemId}>
              <td>{fila.nombre}</td>
              <td className={fila.semaforo === 'REPONER' ? 'atencion' : 'bien'}>
                {TEXTOS.inicio.semaforos[fila.semaforo]}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </section>
  );
}
