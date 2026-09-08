'use client';

/**
 * Pantalla 5 — inventario y conteo físico.
 *
 * **SON DOS PANTALLAS EN UNA, Y LA SEPARACIÓN NO ES ESTÉTICA: ES LA REGLA R8.**
 *
 *   la HOJA          lo que ve quien cuenta. Ítem, unidad y una casilla. **Sin
 *                    stock teórico, sin diferencia y sin semáforo.** El conteo
 *                    es a ciegas (SPEC §4): si la hoja dijera «deberían quedar
 *                    12», nadie contaría, escribiría 12
 *   la CONCILIACIÓN  lo que ve quien decide. Teórico, contado, diferencia y su
 *                    valor
 *
 * **Y LA FRONTERA LA PONE LA API, NO ESTA PANTALLA.** Son dos permisos
 * distintos: `count.write` para la hoja y `count.read` para la conciliación.
 * `BODEGA` tiene el primero y **no** el segundo, así que al pedir la
 * conciliación recibe un 403 y aquí no llega ni un número prohibido. El
 * frontend no esconde campos: no los recibe (CLAUDE.md §4.3).
 *
 * **UN ÍTEM SIN CONTAR VALE SU TEÓRICO, NO CERO** (D7, ADR-010 §5). Valorarlo en
 * cero equivale a declararlo consumido entero, e inflaría el consumo real de
 * todo conteo parcial. Por eso «sin contar» se enseña como tal y no como 0.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/ui/Estados';
import { Marco } from '../../componentes/Marco';
import { Tabla } from '../../componentes/ui/Tabla';
import { ErrorDeApi, llamar } from '../../lib/api';
import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';

const PROHIBIDO = 403;

/** Cantidad no negativa con hasta tres decimales: lo que se anota contando. */
const CANTIDAD = /^\d*(?:[.,]\d{0,3})?$/u;

interface Conteo {
  readonly id: string;
  readonly anio: number;
  readonly mes: number;
  readonly etiqueta: string;
  readonly estado: string;
  readonly confirmadoEn: string | null;
}

interface FilaDeHoja {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly cantidad: string | null;
}

interface Hoja {
  readonly conteo: Conteo;
  readonly filas: readonly FilaDeHoja[];
}

interface FilaConciliada {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly contado: string | null;
  readonly teorico: string;
  readonly diferencia: string | null;
  readonly valorDeDiferencia: string | null;
}

interface Conciliacion {
  readonly filas: readonly FilaConciliada[];
  readonly cobertura: string | null;
}

function mesActual(): { readonly anio: number; readonly mes: number } {
  const ahora = new Date();
  return { anio: ahora.getUTCFullYear(), mes: ahora.getUTCMonth() + 1 };
}

/** El punto decimal es el que la API entiende; la coma es la que se teclea. */
function conPunto(valor: string): string {
  return valor.replace(',', '.');
}

export default function Inventario(): ReactNode {
  const { sucursal } = useSucursal();
  const [periodo] = useState(mesActual);

  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [valores, setValores] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const campos = useRef<(HTMLInputElement | null)[]>([]);

  const cargar = useCallback(async (): Promise<void> => {
    if (sucursal === null) return;
    setError(null);
    setHoja(null);
    setConciliacion(null);

    try {
      // Se busca el conteo del mes; si no hay, se crea. Crearlo no cuenta nada:
      // es abrir la hoja.
      const conteos = await llamar<readonly Conteo[]>({
        ruta: `/conteos?locationId=${sucursal}`,
      });
      const delMes = conteos.find((c) => c.anio === periodo.anio && c.mes === periodo.mes);

      const id =
        delMes?.id ??
        (
          await llamar<{ readonly id: string }>({
            ruta: '/conteos',
            metodo: 'POST',
            cuerpo: { locationId: sucursal, anio: periodo.anio, mes: periodo.mes, note: null },
          })
        ).id;

      const leida = await llamar<Hoja>({ ruta: `/conteos/${id}/hoja` });
      setValores(new Map(leida.filas.flatMap((f) => (f.cantidad === null ? [] : [[f.itemId, f.cantidad]]))));
      setHoja(leida);

      // La conciliación es OTRO permiso. Un 403 aquí no es un fallo: es BODEGA
      // haciendo su trabajo sin ver lo que no le toca.
      try {
        setConciliacion(await llamar<Conciliacion>({ ruta: `/conteos/${id}` }));
      } catch (fallo) {
        if (!(fallo instanceof ErrorDeApi) || fallo.estado !== PROHIBIDO) throw fallo;
      }
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    }
  }, [sucursal, periodo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function escribir(itemId: string, crudo: string): void {
    if (!CANTIDAD.test(crudo)) return;
    setValores((previos) => new Map(previos).set(itemId, crudo));
  }

  function teclas(evento: KeyboardEvent<HTMLInputElement>, indice: number): void {
    const salto = evento.key === 'ArrowUp' ? -1 : 1;
    if (evento.key !== 'Enter' && evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;

    evento.preventDefault();
    campos.current[indice + salto]?.focus();
  }

  async function guardar(): Promise<void> {
    if (hoja === null) return;
    setOcupado(true);
    setError(null);

    // Se manda la hoja ENTERA porque el endpoint la reescribe: lo que se ve al
    // guardar es exactamente lo que queda. Una casilla vacía es «nadie miró», y
    // por eso no se manda como cero.
    const lineas = [...valores.entries()]
      .filter(([, cantidad]) => cantidad.trim() !== '')
      .map(([itemId, cantidad]) => ({ itemId, cantidad: conPunto(cantidad) }));

    try {
      await llamar({ ruta: `/conteos/${hoja.conteo.id}/lineas`, metodo: 'PUT', cuerpo: { lineas } });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (hoja === null) return;
    setOcupado(true);
    setError(null);

    try {
      await llamar({ ruta: `/conteos/${hoja.conteo.id}/confirmacion`, metodo: 'POST' });
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    } finally {
      setOcupado(false);
    }
  }

  const confirmado = hoja?.conteo.confirmadoEn !== null && hoja !== null;

  return (
    <Marco
      titulo={TEXTOS.inventario.titulo}
      ayuda={TEXTOS.inventario.ayuda}
      acciones={
        hoja === null ? null : (
          <div className="barra__grupo">
            <button
              type="button"
              disabled={ocupado || confirmado}
              onClick={() => {
                void guardar();
              }}
            >
              {TEXTOS.inventario.contar}
            </button>
            <button
              type="button"
              data-variante="primario"
              disabled={ocupado || confirmado}
              onClick={() => {
                void confirmar();
              }}
            >
              {ocupado ? TEXTOS.inventario.confirmando : TEXTOS.inventario.confirmar}
            </button>
          </div>
        )
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

      {error === null && hoja === null && <Cargando />}

      {hoja !== null && hoja.filas.length === 0 && (
        <Vacio titulo={TEXTOS.inventario.vacio} ayuda={TEXTOS.inventario.vacioAyuda} />
      )}

      {hoja !== null && hoja.filas.length > 0 && (
        <div className="pila">
          <HojaDeConteo
            filas={hoja.filas}
            valores={valores}
            bloqueada={confirmado}
            campos={campos}
            escribir={escribir}
            teclas={teclas}
          />
          {conciliacion !== null && <Conciliada conciliacion={conciliacion} />}
        </div>
      )}
    </Marco>
  );
}

/** La hoja: a ciegas. Ni teórico, ni diferencia, ni semáforo. */
function HojaDeConteo({
  filas,
  valores,
  bloqueada,
  campos,
  escribir,
  teclas,
}: {
  readonly filas: readonly FilaDeHoja[];
  readonly valores: ReadonlyMap<string, string>;
  readonly bloqueada: boolean;
  readonly campos: React.RefObject<(HTMLInputElement | null)[]>;
  readonly escribir: (itemId: string, crudo: string) => void;
  readonly teclas: (evento: KeyboardEvent<HTMLInputElement>, indice: number) => void;
}): ReactNode {
  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{TEXTOS.inventario.contar}</h2>

      <Tabla>
        <thead>
          <tr>
            <th>{TEXTOS.inventario.item}</th>
            <th className="izquierda">{TEXTOS.inventario.unidad}</th>
            <th>{TEXTOS.inventario.contado}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, indice) => (
            <tr key={fila.itemId}>
              <td>{fila.nombre}</td>
              <td className="izquierda tenue">{fila.unidadDeUso}</td>
              <td className="numero">
                <input
                  ref={(elemento) => {
                    campos.current[indice] = elemento;
                  }}
                  className="celda-editable"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={bloqueada}
                  aria-label={`${TEXTOS.inventario.contado} · ${fila.nombre}`}
                  value={valores.get(fila.itemId) ?? ''}
                  onChange={(e) => {
                    escribir(fila.itemId, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    teclas(e, indice);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </section>
  );
}

/** La conciliación: solo llega a quien tiene `count.read`. */
function Conciliada({ conciliacion }: { readonly conciliacion: Conciliacion }): ReactNode {
  return (
    <section className="pila pila--apretada">
      <h2 className="subtitulo">{TEXTOS.inventario.diferencia}</h2>

      {/*
        La cobertura con el patrón de cifra del manual: etiqueta en versalita
        encima y el número en Plex Mono debajo. Es el dato del que depende leer
        bien todo lo demás de esta tabla (D7), así que se lee de un vistazo y no
        dentro de una frase.
      */}
      {conciliacion.cobertura !== null && (
        <div className="dato">
          <span className="etiqueta">{TEXTOS.inventario.cobertura}</span>
          <strong className="cifra cifra--menor">{conciliacion.cobertura}</strong>
        </div>
      )}

      <Tabla compacta>
        <thead>
          <tr>
            <th>{TEXTOS.inventario.item}</th>
            <th>{TEXTOS.inventario.teorico}</th>
            <th>{TEXTOS.inventario.contado}</th>
            <th>{TEXTOS.inventario.diferencia}</th>
            <th>{TEXTOS.inventario.valorizada}</th>
          </tr>
        </thead>
        <tbody>
          {conciliacion.filas.map((fila) => (
            <tr key={fila.itemId}>
              <td>{fila.nombre}</td>
              <td className="numero">{fila.teorico}</td>
              <td className={fila.contado === null ? 'numero tenue' : 'numero'}>
                {fila.contado ?? TEXTOS.inventario.sinContar}
              </td>
              <td className="numero">{fila.diferencia ?? TEXTOS.comun.sinDato}</td>
              <td className="numero">{fila.valorDeDiferencia ?? TEXTOS.comun.sinDato}</td>
            </tr>
          ))}
        </tbody>
      </Tabla>

      <p className="nota">{TEXTOS.inventario.notaSinContar}</p>
    </section>
  );
}
