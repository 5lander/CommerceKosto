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
 *
 * **EL MES ES EL DE LA URL** (D-16.5), como en ventas.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { CeldaEditable } from '../../../componentes/ui/CeldaEditable';
import { Error as Fallo } from '../../../componentes/ui/Estados';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { ErrorDeApi, llamar } from '../../../lib/api';
import { conPuntoDecimal, sinCerosDeSobra } from '../../../lib/decimales';
import type { Mes } from '../../../lib/fechas';
import { usePeriodo } from '../../../lib/periodo';
import { useRejilla, type CeldaDeRejilla } from '../../../lib/rejilla';
import { useSucursal } from '../../../lib/sesion';
import { useEnvio } from '../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

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

/** La hoja y, si la sesión puede verla, la conciliación. */
interface ConteoLeido {
  readonly hoja: Hoja;
  readonly conciliacion: Conciliacion | null;
}

/** El conteo del mes; si no hay, se crea. Crearlo no cuenta nada: es abrir la hoja. */
async function conteoDelMes(sucursal: string, periodo: Mes): Promise<string> {
  const conteos = await llamar<readonly Conteo[]>({ ruta: `/conteos?locationId=${sucursal}` });
  const delMes = conteos.find((conteo) => conteo.anio === periodo.anio && conteo.mes === periodo.mes);
  if (delMes !== undefined) return delMes.id;

  const creado = await llamar<{ readonly id: string }>({
    ruta: '/conteos',
    metodo: 'POST',
    cuerpo: { locationId: sucursal, anio: periodo.anio, mes: periodo.mes, note: null },
  });
  return creado.id;
}

/**
 * La conciliación es OTRO permiso. Un 403 aquí no es un fallo: es BODEGA
 * haciendo su trabajo sin ver lo que no le toca.
 */
async function conciliacionSiSePuede(id: string): Promise<Conciliacion | null> {
  try {
    return await llamar<Conciliacion>({ ruta: `/conteos/${id}` });
  } catch (fallo) {
    if (fallo instanceof ErrorDeApi && fallo.estado === PROHIBIDO) return null;
    throw fallo;
  }
}

function useConteoDelMes(sucursal: string | null, periodo: Mes): Lectura<ConteoLeido> {
  const leer = useMemo(() => {
    if (sucursal === null) return null;
    return async (): Promise<ConteoLeido> => {
      const id = await conteoDelMes(sucursal, periodo);
      const hoja = await llamar<Hoja>({ ruta: `/conteos/${id}/hoja` });
      return { hoja, conciliacion: await conciliacionSiSePuede(id) };
    };
  }, [sucursal, periodo]);

  return useCarga(leer);
}

export default function Inventario(): ReactNode {
  const { sucursal } = useSucursal();
  const { periodo } = usePeriodo();
  const lectura = useConteoDelMes(sucursal, periodo);

  return (
    <Marco titulo={TEXTOS.inventario.titulo} ayuda={TEXTOS.inventario.ayuda}>
      <Vista
        lectura={lectura}
        vacio={{
          esVacio: (leido) => leido.hoja.filas.length === 0,
          titulo: TEXTOS.inventario.vacio,
          ayuda: TEXTOS.inventario.vacioAyuda,
        }}
      >
        {(leido) => <ConteoAbierto leido={leido} recargar={lectura.recargar} />}
      </Vista>
    </Marco>
  );
}

function contadas(filas: readonly FilaDeHoja[]): ReadonlyMap<string, string> {
  return new Map(
    filas.flatMap((fila) => (fila.cantidad === null ? [] : [[fila.itemId, sinCerosDeSobra(fila.cantidad)]])),
  );
}

/**
 * Se manda la hoja ENTERA porque el endpoint la reescribe: lo que se ve al
 * guardar es exactamente lo que queda. Una casilla vacía es «nadie miró», y por
 * eso no se manda como cero.
 */
function lineasDe(valores: ReadonlyMap<string, string>): readonly { itemId: string; cantidad: string }[] {
  return [...valores]
    .filter(([, cantidad]) => cantidad.trim() !== '')
    .map(([itemId, cantidad]) => ({ itemId, cantidad: conPuntoDecimal(cantidad) }));
}

function ConteoAbierto({ leido, recargar }: { readonly leido: ConteoLeido; readonly recargar: () => void }): ReactNode {
  const { hoja, conciliacion } = leido;
  const [valores, setValores] = useState(() => contadas(hoja.filas));
  const envio = useEnvio();
  const bloqueada = hoja.conteo.confirmadoEn !== null;
  const ruta = `/conteos/${hoja.conteo.id}`;

  function escribir(itemId: string, crudo: string): void {
    if (!CANTIDAD.test(crudo)) return;
    setValores((previos) => new Map(previos).set(itemId, crudo));
  }

  // Tras escribir se vuelve a leer: la hoja confirmada se bloquea y la
  // conciliación trae la diferencia nueva, y las dos cosas las decide la API.
  async function mandar(accion: () => Promise<unknown>): Promise<void> {
    const salio = await envio.enviar(async () => {
      await accion();
    });
    if (salio) recargar();
  }

  return (
    <div className="pila">
      <AccionesDelConteo
        ocupado={envio.ocupado}
        bloqueada={bloqueada}
        guardar={() =>
          mandar(() => llamar({ ruta: `${ruta}/lineas`, metodo: 'PUT', cuerpo: { lineas: lineasDe(valores) } }))
        }
        confirmar={() => mandar(() => llamar({ ruta: `${ruta}/confirmacion`, metodo: 'POST' }))}
      />
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      <HojaDeConteo filas={hoja.filas} valores={valores} bloqueada={bloqueada} escribir={escribir} />
      {conciliacion !== null && <Conciliada conciliacion={conciliacion} />}
    </div>
  );
}

function AccionesDelConteo({
  ocupado,
  bloqueada,
  guardar,
  confirmar,
}: {
  readonly ocupado: boolean;
  readonly bloqueada: boolean;
  readonly guardar: () => Promise<void>;
  readonly confirmar: () => Promise<void>;
}): ReactNode {
  return (
    <div className="barra__grupo">
      <button
        type="button"
        disabled={ocupado || bloqueada}
        onClick={() => {
          void guardar();
        }}
      >
        {TEXTOS.inventario.contar}
      </button>
      <button
        type="button"
        data-variante="primario"
        disabled={ocupado || bloqueada}
        onClick={() => {
          void confirmar();
        }}
      >
        {ocupado ? TEXTOS.inventario.confirmando : TEXTOS.inventario.confirmar}
      </button>
    </div>
  );
}

/** La hoja: a ciegas. Ni teórico, ni diferencia, ni semáforo. */
function HojaDeConteo({
  filas,
  valores,
  bloqueada,
  escribir,
}: {
  readonly filas: readonly FilaDeHoja[];
  readonly valores: ReadonlyMap<string, string>;
  readonly bloqueada: boolean;
  readonly escribir: (itemId: string, crudo: string) => void;
}): ReactNode {
  const celda = useRejilla();

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
            <FilaParaContar
              key={fila.itemId}
              fila={fila}
              celda={celda(indice)}
              bloqueada={bloqueada}
              valor={valores.get(fila.itemId) ?? ''}
              escribir={escribir}
            />
          ))}
        </tbody>
      </Tabla>
    </section>
  );
}

function FilaParaContar({
  fila,
  celda,
  bloqueada,
  valor,
  escribir,
}: {
  readonly fila: FilaDeHoja;
  readonly celda: CeldaDeRejilla;
  readonly bloqueada: boolean;
  readonly valor: string;
  readonly escribir: (itemId: string, crudo: string) => void;
}): ReactNode {
  return (
    <tr>
      <td>{fila.nombre}</td>
      <td className="izquierda tenue">{fila.unidadDeUso}</td>
      <td className="numero">
        <CeldaEditable
          celda={celda}
          modo="decimal"
          bloqueada={bloqueada}
          etiqueta={`${TEXTOS.inventario.contado} · ${fila.nombre}`}
          valor={valor}
          escribir={(crudo) => {
            escribir(fila.itemId, crudo);
          }}
        />
      </td>
    </tr>
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
            <FilaConciliadaDeLaTabla key={fila.itemId} fila={fila} />
          ))}
        </tbody>
      </Tabla>

      <p className="nota">{TEXTOS.inventario.notaSinContar}</p>
    </section>
  );
}

function FilaConciliadaDeLaTabla({ fila }: { readonly fila: FilaConciliada }): ReactNode {
  return (
    <tr>
      <td>{fila.nombre}</td>
      <td className="numero">{fila.teorico}</td>
      <td className={fila.contado === null ? 'numero tenue' : 'numero'}>{fila.contado ?? TEXTOS.inventario.sinContar}</td>
      <td className="numero">{fila.diferencia ?? TEXTOS.comun.sinDato}</td>
      <td className="numero">{fila.valorDeDiferencia ?? TEXTOS.comun.sinDato}</td>
    </tr>
  );
}
