'use client';

/**
 * Pantalla 9 — la bandeja de precios sugeridos: R5, ningún precio se mueve solo.
 *
 * **SUGERIR Y CONFIRMAR SON DOS PERMISOS Y PUEDEN SER DOS PERSONAS.** Quien ve
 * la bandeja con `pricing.read` —un gerente que notó la subida— no tiene botones;
 * decide quien tiene `pricing.confirm`. La frontera es el 403 de la API.
 *
 * **CADA SUGERIDO VA JUNTO AL VIGENTE** (`precioVigente`, que decide la API): «2.45»
 * suelto no dice nada, «de 2.10 a 2.45» sí. La pantalla no calcula la variación:
 * pone los dos números uno al lado del otro.
 *
 * **SI OTRA PERSONA YA LO DECIDIÓ**, la API responde 409 y la fila lo dice con el
 * mensaje de la API, sin quitarse sola: dos administradores que confirman a la vez
 * no pueden quedarse creyendo los dos que decidieron. Lo que salió bien sí vuelve
 * a leer la bandeja.
 *
 * **LOS PRECIOS SE ENSEÑAN CON `comoCostoDeUso`, NO CON `comoImporte`.** El de una
 * preparación es su costo estándar por unidad de uso (R10) —`0.0045` el gramo—, y
 * a dos decimales saldría `0.00`. Con parte entera, el formato es el mismo.
 *
 * **POR CURSOR, NUNCA POR PÁGINA NUMERADA** (CLAUDE.md §5): «Ver más» pide la
 * siguiente con el `siguiente` que devolvió la anterior.
 */

import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { Error as Fallo } from '../../../componentes/ui/Estados';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { llamar } from '../../../lib/api';
import { comoCostoDeUso, comoPorcentaje } from '../../../lib/decimales';
import { comoFecha } from '../../../lib/fechas';
import { usePermisos } from '../../../lib/permisos';
import { useEnvio } from '../../../lib/useEnvio';
import { useLectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

interface Pendiente {
  readonly id: string;
  readonly itemId: string;
  readonly precio: string;
  readonly ivaCompra: string;
  readonly validFrom: string;
  readonly nota: string | null;
  readonly itemNombre: string;
  readonly articuloNombre: string | null;
  readonly precioVigente: string | null;
}

interface Pagina {
  readonly pendientes: readonly Pendiente[];
  readonly siguiente: string | null;
}

export default function Precios(): ReactNode {
  const { tiene } = usePermisos();
  const lectura = useLectura<Pagina>('/precios/pendientes');
  const { precios } = TEXTOS;

  return (
    <Marco
      titulo={precios.titulo}
      ayuda={precios.ayuda}
      acciones={
        tiene('pricing.suggest') && (
          <Link href="/precios/nuevo" className="boton">
            {precios.sugerir}
          </Link>
        )
      }
    >
      <Vista
        lectura={lectura}
        vacio={{ esVacio: (pagina) => pagina.pendientes.length === 0, titulo: precios.vacio, ayuda: precios.vacioAyuda }}
      >
        {(primera) => (
          // La clave es la primera página: al volver a leerla tras una decisión, las
          // páginas añadidas con «Ver más» se descartan en vez de enseñar lo ya decidido.
          <Bandeja
            key={primera.pendientes.map((p) => p.id).join()}
            primera={primera}
            decide={tiene('pricing.confirm')}
            recargar={lectura.recargar}
          />
        )}
      </Vista>
    </Marco>
  );
}

/** La primera página y las que se añadan con «Ver más». */
function useMasPaginas(primera: Pagina) {
  const [extra, setExtra] = useState<readonly Pendiente[]>([]);
  const [siguiente, setSiguiente] = useState(primera.siguiente);
  const envio = useEnvio();

  async function verMas(): Promise<void> {
    if (siguiente === null) return;
    await envio.enviar(async () => {
      const pagina = await llamar<Pagina>({ ruta: `/precios/pendientes?despuesDe=${encodeURIComponent(siguiente)}` });
      setExtra((anteriores) => [...anteriores, ...pagina.pendientes]);
      setSiguiente(pagina.siguiente);
    });
  }

  return { todas: [...primera.pendientes, ...extra], siguiente, envio, verMas };
}

function Bandeja({
  primera,
  decide,
  recargar,
}: {
  readonly primera: Pagina;
  readonly decide: boolean;
  readonly recargar: () => void;
}): ReactNode {
  const { todas, siguiente, envio, verMas } = useMasPaginas(primera);

  return (
    <div className="pila pila--apretada">
      <Tabla>
        <thead>
          <tr>
            <th>{TEXTOS.precios.insumo}</th>
            <th>{TEXTOS.precios.vigente}</th>
            <th>{TEXTOS.precios.sugerido}</th>
            {decide && <th>{TEXTOS.precios.decision}</th>}
          </tr>
        </thead>
        <tbody>
          {todas.map((pendiente) => (
            <FilaPendiente key={pendiente.id} pendiente={pendiente} decide={decide} alDecidir={recargar} />
          ))}
        </tbody>
      </Tabla>
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      {siguiente !== null && (
        <div>
          <button type="button" disabled={envio.ocupado} onClick={() => void verMas()}>
            {TEXTOS.precios.verMas}
          </button>
        </div>
      )}
    </div>
  );
}

function FilaPendiente({
  pendiente,
  decide,
  alDecidir,
}: {
  readonly pendiente: Pendiente;
  readonly decide: boolean;
  readonly alDecidir: () => void;
}): ReactNode {
  const { precios } = TEXTOS;
  const detalle = [pendiente.articuloNombre, `${precios.desde} ${comoFecha(pendiente.validFrom)}`, pendiente.nota];

  return (
    <tr>
      <td>
        <Link href={`/insumos/${pendiente.itemId}`} className="enlace-de-fila">
          {pendiente.itemNombre}
        </Link>
        <span className="bloque tenue">{detalle.filter(Boolean).join(' · ')}</span>
      </td>
      <td className="numero tenue">{pendiente.precioVigente === null ? precios.sinVigente : comoCostoDeUso(pendiente.precioVigente)}</td>
      <td className="numero">
        {comoCostoDeUso(pendiente.precio)}
        <span className="bloque tenue">{`${precios.iva} ${comoPorcentaje(pendiente.ivaCompra)}`}</span>
      </td>
      {decide && (
        <td>
          <Decision precioId={pendiente.id} alDecidir={alDecidir} />
        </td>
      )}
    </tr>
  );
}

/** Confirmar o rechazar: la API decide si todavía se puede (409 si ya se resolvió). */
function Decision({ precioId, alDecidir }: { readonly precioId: string; readonly alDecidir: () => void }): ReactNode {
  const envio = useEnvio();

  async function decidir(decision: 'CONFIRMED' | 'REJECTED'): Promise<void> {
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: `/precios/${precioId}/decision`, metodo: 'POST', cuerpo: { decision } });
    });
    if (salio) alDecidir();
  }

  return (
    <div className="pila pila--minima">
      <div className="linea">
        <button type="button" data-variante="primario" disabled={envio.ocupado} onClick={() => void decidir('CONFIRMED')}>
          {TEXTOS.precios.confirmar}
        </button>
        <button type="button" disabled={envio.ocupado} onClick={() => void decidir('REJECTED')}>
          {TEXTOS.precios.rechazar}
        </button>
      </div>
      {envio.error !== null && <span className="mal">{envio.error}</span>}
    </div>
  );
}
