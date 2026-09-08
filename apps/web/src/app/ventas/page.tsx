'use client';

/**
 * Pantalla 4 — carga de unidades vendidas.
 *
 * **ES LA PANTALLA QUE DECIDE SI EL CLIENTE SIGUE USANDO EL SISTEMA EL MES DOS.**
 * De estas cifras dependen tres de las seis vistas, y digitar 48 productos con
 * un formulario por producto es donde un sistema de costeo se abandona. Por eso
 * es una REJILLA y no un formulario, y por eso se recorre entera sin tocar el
 * ratón.
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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/Estados';
import { Marco } from '../../componentes/Marco';
import { llamar } from '../../lib/api';
import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';

const NO_ENCONTRADO = 404;
const PRIMER_MES = 1;
const ULTIMO_MES = 12;

/** Solo dígitos: las unidades vendidas son un entero (`Count`, ADR-011 §39). */
const SOLO_DIGITOS = /^\d*$/u;

interface Venta {
  readonly productId: string;
  readonly unidades: string;
}

interface Carta {
  readonly productos: readonly {
    readonly productId: string;
    readonly nombre: string;
    readonly categoria: string | null;
    readonly activo: boolean;
  }[];
}

interface Mes {
  readonly anio: number;
  readonly mes: number;
}

function mesActual(): Mes {
  const ahora = new Date();
  return { anio: ahora.getUTCFullYear(), mes: ahora.getUTCMonth() + 1 };
}

function mesAnterior({ anio, mes }: Mes): Mes {
  return mes === PRIMER_MES ? { anio: anio - 1, mes: ULTIMO_MES } : { anio, mes: mes - 1 };
}

/**
 * Lee las ventas de un mes. Un 404 es «ese mes no tiene nada», que para esta
 * pantalla no es un error: es la lista vacía.
 */
async function ventasDe(sucursal: string, periodo: Mes): Promise<readonly Venta[]> {
  const consulta = `locationId=${sucursal}&anio=${String(periodo.anio)}&mes=${String(periodo.mes)}`;

  try {
    return await llamar<readonly Venta[]>({ ruta: `/analitica/ventas?${consulta}` });
  } catch (fallo) {
    const vacio =
      typeof fallo === 'object' && fallo !== null && 'estado' in fallo && fallo.estado === NO_ENCONTRADO;
    if (vacio) return [];
    throw fallo;
  }
}

export default function Ventas(): ReactNode {
  const { sucursal } = useSucursal();

  // El mes se fija UNA vez, al montar, y no se recalcula en cada render. Si se
  // recalculara, seria una dependencia nueva de `cargar` en cada pasada y la
  // pantalla se recargaria sin parar — y ademas la sesion de alguien que carga
  // ventas a las 23:59 del dia 30 no debe saltar de mes a mitad.
  const [periodo] = useState<Mes>(mesActual);

  const [carta, setCarta] = useState<Carta | null>(null);
  const [anteriores, setAnteriores] = useState<ReadonlyMap<string, string>>(new Map());
  const [valores, setValores] = useState<ReadonlyMap<string, string>>(new Map());
  const [guardados, setGuardados] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  const campos = useRef<(HTMLInputElement | null)[]>([]);

  const cargar = useCallback(async (): Promise<void> => {
    if (sucursal === null) return;
    setError(null);
    setCarta(null);

    try {
      const [cartaLeida, mes, previo] = await Promise.all([
        llamar<Carta>({ ruta: `/costeo?locationId=${sucursal}` }),
        ventasDe(sucursal, periodo),
        ventasDe(sucursal, mesAnterior(periodo)),
      ]);

      const actuales = new Map(mes.map((v) => [v.productId, v.unidades]));
      setAnteriores(new Map(previo.map((v) => [v.productId, v.unidades])));
      setValores(actuales);
      setGuardados(actuales);
      setCarta(cartaLeida);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    }
  }, [sucursal, periodo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = carta?.productos.filter((p) => p.activo) ?? [];

  const cambiadas = activos.filter(
    (p) => (valores.get(p.productId) ?? '') !== (guardados.get(p.productId) ?? ''),
  );

  function escribir(productId: string, crudo: string): void {
    if (!SOLO_DIGITOS.test(crudo)) return;
    setConfirmado(false);
    setValores((previos) => new Map(previos).set(productId, crudo));
  }

  /**
   * Enter y las flechas mueven de fila; Tab lo hace solo el navegador.
   *
   * Es lo que convierte la rejilla en algo que se llena de un tirón: la mano no
   * sale del teclado numérico.
   */
  function teclas(evento: KeyboardEvent<HTMLInputElement>, indice: number): void {
    const salto = evento.key === 'ArrowUp' ? -1 : 1;
    if (evento.key !== 'Enter' && evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;

    evento.preventDefault();
    campos.current[indice + salto]?.focus();
  }

  async function guardar(): Promise<void> {
    if (sucursal === null || cambiadas.length === 0) return;
    setGuardando(true);
    setError(null);

    // SOLO LO QUE CAMBIO. La carga es por reemplazo del lote, así que mandar la
    // rejilla entera reescribiría filas que nadie tocó — y con ellas su
    // `updated_at`, que es lo que después responde «¿quién cambió esto?».
    const ventas = cambiadas.map((p) => ({
      productId: p.productId,
      unidades: valores.get(p.productId) ?? '0',
    }));

    try {
      await llamar({
        ruta: '/analitica/ventas',
        metodo: 'POST',
        cuerpo: { locationId: sucursal, anio: periodo.anio, mes: periodo.mes, ventas },
      });
      setGuardados(new Map(valores));
      setConfirmado(true);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Marco
      titulo={TEXTOS.ventas.titulo}
      ayuda={TEXTOS.ventas.ayuda}
      acciones={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--espacio-3)' }}>
          {confirmado && cambiadas.length === 0 && (
            <span role="status" style={{ color: 'var(--color-bien)' }}>
              {TEXTOS.ventas.guardado}
            </span>
          )}
          <button
            type="button"
            data-variante="primario"
            disabled={guardando || cambiadas.length === 0}
            onClick={() => {
              void guardar();
            }}
          >
            {guardando
              ? TEXTOS.ventas.guardando
              : cambiadas.length === 0
                ? TEXTOS.ventas.sinCambios
                : `${TEXTOS.ventas.guardar} (${String(cambiadas.length)})`}
          </button>
        </div>
      }
    >
      {error !== null && (
        <Fallo
          mensaje={error}
          reintentar={() => {
            void cargar();
          }}
        />
      )}

      {error === null && carta === null && <Cargando />}

      {carta !== null && activos.length === 0 && (
        <Vacio titulo={TEXTOS.ventas.vacio} ayuda={TEXTOS.ventas.vacioAyuda} />
      )}

      {carta !== null && activos.length > 0 && (
        <>
          <p style={{ color: 'var(--color-texto-suave)', fontSize: 'var(--texto-sm)', marginTop: 0 }}>
            {TEXTOS.ventas.atajos}
          </p>

          <div style={{ background: 'var(--color-superficie)', border: '1px solid var(--color-borde)', borderRadius: 'var(--radio-lg)', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-borde)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--espacio-3)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.costeo.producto}
                  </th>
                  <th style={{ textAlign: 'right', padding: 'var(--espacio-3)', color: 'var(--color-texto-suave)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {TEXTOS.ventas.mesAnterior}
                  </th>
                  <th style={{ textAlign: 'right', padding: 'var(--espacio-3)', color: 'var(--color-texto-suave)', fontWeight: 600 }}>
                    {TEXTOS.ventas.unidades}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activos.map((producto, indice) => (
                  <tr key={producto.productId} style={{ borderBottom: '1px solid var(--color-borde)' }}>
                    <td style={{ padding: 'var(--espacio-2) var(--espacio-3)' }}>
                      {producto.nombre}
                      {producto.categoria !== null && (
                        <span style={{ display: 'block', color: 'var(--color-texto-tenue)', fontSize: 'var(--texto-xs)' }}>
                          {producto.categoria}
                        </span>
                      )}
                    </td>

                    <td className="numero" style={{ padding: 'var(--espacio-2) var(--espacio-3)', color: 'var(--color-texto-tenue)' }}>
                      {anteriores.get(producto.productId) ?? '—'}
                    </td>

                    <td style={{ padding: 'var(--espacio-2) var(--espacio-3)', textAlign: 'right' }}>
                      <input
                        ref={(elemento) => {
                          campos.current[indice] = elemento;
                        }}
                        className="numero"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label={`${TEXTOS.ventas.unidades} · ${producto.nombre}`}
                        value={valores.get(producto.productId) ?? ''}
                        onChange={(e) => {
                          escribir(producto.productId, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          teclas(e, indice);
                        }}
                        style={{ width: '7rem', textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Marco>
  );
}
