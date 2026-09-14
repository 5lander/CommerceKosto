'use client';

/**
 * Pantalla 4 — carga de unidades vendidas.
 *
 * **ES LA PANTALLA QUE DECIDE SI EL CLIENTE SIGUE USANDO EL SISTEMA EL MES DOS.**
 * De estas cifras dependen tres de las seis vistas, y digitar 48 productos con
 * un formulario por producto es donde un sistema de costeo se abandona. Por eso
 * es una REJILLA y no un formulario, y por eso se recorre entera sin tocar el
 * ratón (`lib/rejilla.ts`).
 *
 * **EL MES ANTERIOR VIENE PRECARGADO COMO REFERENCIA, NO COMO VALOR.** Se enseña
 * al lado, en gris, y **no se copia al campo**: rellenar la casilla con la cifra
 * del mes pasado convierte «no me acuerdo» en un dato que parece capturado. El
 * campo empieza vacío a propósito, y vacío significa vacío.
 *
 * **LAS UNIDADES VIAJAN COMO CADENA**, igual que todo lo numérico: la API las
 * valida como `Count` entero y rechaza cualquier otra cosa con su motivo.
 *
 * **NO HAY GUARDADO AUTOMÁTICO.** Se guarda al pulsar, y el botón dice cuántas
 * filas cambiaron. Un guardado silencioso en una pantalla de captura hace
 * imposible saber si lo último que se escribió llegó.
 *
 * **SE GUARDA SOBRE LA VERSIÓN QUE SE LEYÓ** (P16-C, D-16.121). Si otra persona
 * guardó la carga de este mes mientras tanto, la API responde 409 y el mensaje
 * pide recargar: guardar encima borraría lo suyo sin que nadie se enterara.
 *
 * **EL MES ES EL DE LA URL** (D-16.5), elegido en la cabecera. Hasta el armazón se
 * fijaba al montar con el mes UTC, que a partir de las 19:00 del último día abría
 * en Guayaquil el mes siguiente (`lib/fechas.ts`).
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { CeldaEditable } from '../../../componentes/ui/CeldaEditable';
import { Error as Fallo } from '../../../componentes/ui/Estados';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { llamar } from '../../../lib/api';
import { sinCerosDeSobra } from '../../../lib/decimales';
import { consultaDelMes, mesAnterior, type Mes } from '../../../lib/fechas';
import { usePeriodo } from '../../../lib/periodo';
import { useRejilla, type CeldaDeRejilla } from '../../../lib/rejilla';
import { useSucursal } from '../../../lib/sesion';
import { useEnvio } from '../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

/** Solo dígitos: las unidades vendidas son un entero (`Count`, ADR-011 §39). */
const SOLO_DIGITOS = /^\d*$/u;

interface Venta {
  readonly productId: string;
  readonly unidades: string;
}

/** `version` es la de la carga del mes: la que el guardado manda de vuelta (D-16.123). */
interface VentasDelMes {
  readonly version: number;
  readonly ventas: readonly Venta[];
}

interface Producto {
  readonly productId: string;
  readonly nombre: string;
  readonly categoria: string | null;
  readonly activo: boolean;
}

interface Carta {
  readonly productos: readonly Producto[];
}

/** Lo que la rejilla necesita, ya leído: con esto se monta y no vuelve a leer. */
interface DatosDeVentas {
  readonly activos: readonly Producto[];
  readonly version: number;
  readonly actuales: ReadonlyMap<string, string>;
  readonly anteriores: ReadonlyMap<string, string>;
}

/** A dónde va el guardado: la sucursal y el mes que se leyeron. */
interface Destino extends Mes {
  readonly locationId: string;
}

function porProducto(ventas: readonly Venta[]): ReadonlyMap<string, string> {
  return new Map(ventas.map((venta) => [venta.productId, sinCerosDeSobra(venta.unidades)]));
}

/**
 * La carta, las ventas del mes y las del anterior, en paralelo.
 *
 * **SIN `catch` DE 404, Y ESO ES UN ARREGLO** (P16-A2). Había uno que tragaba
 * *cualquier* 404 y lo convertía en lista vacía; era código muerto —esta carga
 * devuelve `[]` para un mes sin fila de período, nunca 404— y además escondía
 * enlaces rotos. El 404 de «mes sin abrir» es de las **seis vistas** de
 * analítica y llega con `code: 'PERIODO_SIN_DATOS'` (D-16.2).
 */
function useVentasDelMes(sucursal: string | null, periodo: Mes): Lectura<DatosDeVentas> {
  const leer = useMemo(() => {
    if (sucursal === null) return null;
    const ventasDe = (mes: Mes): Promise<VentasDelMes> =>
      llamar<VentasDelMes>({ ruta: `/analitica/ventas?locationId=${sucursal}&${consultaDelMes(mes)}` });

    return async (): Promise<DatosDeVentas> => {
      const [carta, delMes, previo] = await Promise.all([
        llamar<Carta>({ ruta: `/costeo?locationId=${sucursal}` }),
        ventasDe(periodo),
        ventasDe(mesAnterior(periodo)),
      ]);
      return {
        activos: carta.productos.filter((producto) => producto.activo),
        version: delMes.version,
        actuales: porProducto(delMes.ventas),
        anteriores: porProducto(previo.ventas),
      };
    };
  }, [sucursal, periodo]);

  return useCarga(leer);
}

export default function Ventas(): ReactNode {
  const { sucursal } = useSucursal();
  const { periodo } = usePeriodo();
  const lectura = useVentasDelMes(sucursal, periodo);

  return (
    <Marco titulo={TEXTOS.ventas.titulo} ayuda={TEXTOS.ventas.ayuda}>
      <Vista
        lectura={lectura}
        vacio={{
          esVacio: (datos) => datos.activos.length === 0,
          titulo: TEXTOS.ventas.vacio,
          ayuda: TEXTOS.ventas.vacioAyuda,
        }}
      >
        {(datos) =>
          sucursal !== null && <RejillaDeVentas datos={datos} destino={{ locationId: sucursal, ...periodo }} />
        }
      </Vista>
    </Marco>
  );
}

/** Lo que se está capturando, lo último guardado y la versión sobre la que se guarda. */
function useCapturaDeVentas(datos: DatosDeVentas, destino: Destino) {
  const [valores, setValores] = useState(datos.actuales);
  const [guardados, setGuardados] = useState(datos.actuales);
  const [version, setVersion] = useState(datos.version);
  const [confirmado, setConfirmado] = useState(false);
  const envio = useEnvio();

  const cambiadas = datos.activos.filter(
    ({ productId }) => (valores.get(productId) ?? '') !== (guardados.get(productId) ?? ''),
  ).length;

  function escribir(productId: string, crudo: string): void {
    if (!SOLO_DIGITOS.test(crudo)) return;
    setConfirmado(false);
    setValores((previos) => new Map(previos).set(productId, crudo));
  }

  // TODAS LAS FILAS CON VALOR, no solo las que cambiaron (P16-C, D-16.1). La
  // carga REEMPLAZA el mes entero: hasta P16-C esta pantalla mandaba solo lo
  // cambiado, y guardar tres casillas borraba las ventas de todas las demás.
  // `valores` trae también las de productos que ya no están activos, así que
  // sus ventas del mes se conservan aunque no se vean en la rejilla.
  async function guardar(): Promise<void> {
    const ventas = [...valores]
      .filter(([, unidades]) => unidades !== '')
      .map(([productId, unidades]) => ({ productId, unidades }));

    await envio.enviar(async () => {
      const guardada = await llamar<{ readonly version: number }>({
        ruta: '/analitica/ventas',
        metodo: 'POST',
        cuerpo: { ...destino, version, ventas },
      });
      setVersion(guardada.version);
      setGuardados(valores);
      setConfirmado(true);
    });
  }

  return { valores, cambiadas, confirmado, envio, escribir, guardar };
}

type Captura = ReturnType<typeof useCapturaDeVentas>;

function RejillaDeVentas({ datos, destino }: { readonly datos: DatosDeVentas; readonly destino: Destino }): ReactNode {
  const captura = useCapturaDeVentas(datos, destino);
  const celda = useRejilla();

  return (
    <div className="pila pila--apretada">
      <BarraDeGuardado captura={captura} />
      {captura.envio.error !== null && <Fallo mensaje={captura.envio.error} />}
      <p className="nota">{TEXTOS.ventas.atajos}</p>

      <Tabla>
        <thead>
          <tr>
            <th>{TEXTOS.costeo.producto}</th>
            <th>{TEXTOS.ventas.mesAnterior}</th>
            <th>{TEXTOS.ventas.unidades}</th>
          </tr>
        </thead>
        <tbody>
          {datos.activos.map((producto, indice) => (
            <FilaDeVenta
              key={producto.productId}
              producto={producto}
              anterior={datos.anteriores.get(producto.productId) ?? TEXTOS.comun.sinDato}
              valor={captura.valores.get(producto.productId) ?? ''}
              celda={celda(indice)}
              escribir={(crudo) => {
                captura.escribir(producto.productId, crudo);
              }}
            />
          ))}
        </tbody>
      </Tabla>
    </div>
  );
}

function etiquetaDeGuardado(ocupado: boolean, cambiadas: number): string {
  if (ocupado) return TEXTOS.ventas.guardando;
  if (cambiadas === 0) return TEXTOS.ventas.sinCambios;
  return `${TEXTOS.ventas.guardar} (${String(cambiadas)})`;
}

function BarraDeGuardado({ captura }: { readonly captura: Captura }): ReactNode {
  const { cambiadas, confirmado, envio } = captura;

  return (
    <div className="linea">
      {confirmado && cambiadas === 0 && (
        <span role="status" className="bien">
          {TEXTOS.ventas.guardado}
        </span>
      )}
      <button
        type="button"
        data-variante="primario"
        disabled={envio.ocupado || cambiadas === 0}
        onClick={() => {
          void captura.guardar();
        }}
      >
        {etiquetaDeGuardado(envio.ocupado, cambiadas)}
      </button>
    </div>
  );
}

function FilaDeVenta({
  producto,
  anterior,
  valor,
  celda,
  escribir,
}: {
  readonly producto: Producto;
  readonly anterior: string;
  readonly valor: string;
  readonly celda: CeldaDeRejilla;
  readonly escribir: (crudo: string) => void;
}): ReactNode {
  return (
    <tr>
      <td>
        {producto.nombre}
        {producto.categoria !== null && <span className="bloque tenue">{producto.categoria}</span>}
      </td>
      <td className="numero tenue">{anterior}</td>
      <td className="numero">
        <CeldaEditable
          celda={celda}
          modo="numeric"
          etiqueta={`${TEXTOS.ventas.unidades} · ${producto.nombre}`}
          valor={valor}
          escribir={escribir}
        />
      </td>
    </tr>
  );
}
