'use client';

/**
 * El libro en una tabla, con «Ver más» por cursor.
 *
 * **UN IMPORTE VACÍO NO ES CERO.** Una transferencia no lleva dinero y una
 * compra vieja no sabe su desglose de IVA (D-16.18): las dos se enseñan como
 * falta de dato, nunca como `0,00`. Un cero en la columna de dinero es una
 * afirmación, y aquí sería falsa.
 *
 * **LA CANTIDAD LLEVA SU SIGNO Y EL IMPORTE NO**, porque así vive en el libro
 * (ADR-009 §2): el signo está en `quantity` y `total_cost` es una magnitud. En
 * pantalla eso hace que una corrección de `−100 kg` enseñe `115,00` en positivo,
 * y quien sume la columna a ojo se equivoque. **Aquí no se corrige calculando**
 * —`signo(cantidad) × importe` es una regla del dominio, y hacerla también en el
 * navegador es exactamente cómo nació INC-029—: se dice, y el importe con signo
 * lo tiene que dar la API (pendiente, anotado en `ESTADO.md`).
 */

import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { comoImporte, sinCerosDeSobra } from '../../lib/decimales';
import { comoFecha } from '../../lib/fechas';
import { usePermisos } from '../../lib/permisos';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { Error as Fallo } from '../ui/Estados';
import { Pildora } from '../ui/Pildora';
import { Tabla } from '../ui/Tabla';
import type { InsumoDelLibro, LibroLeido, MovimientoLeido, PaginaDelLibro } from './libro';

const SIN_DESGLOSE = 'SIN_DESGLOSE';

function useMasPaginas(primera: PaginaDelLibro, consulta: string) {
  const [extra, setExtra] = useState<readonly MovimientoLeido[]>([]);
  const [siguiente, setSiguiente] = useState(primera.siguiente);
  const envio = useEnvio();

  async function verMas(): Promise<void> {
    if (siguiente === null) return;
    await envio.enviar(async () => {
      const pagina = await llamar<PaginaDelLibro>({
        ruta: `/inventario/movimientos?${consulta}&cursor=${siguiente}`,
      });
      setExtra((anteriores) => [...anteriores, ...pagina.movimientos]);
      setSiguiente(pagina.siguiente);
    });
  }

  return { todos: [...primera.movimientos, ...extra], siguiente, envio, verMas };
}

export function TablaDelLibro({ leido, consulta }: { readonly leido: LibroLeido; readonly consulta: string }): ReactNode {
  const texto = TEXTOS.movimientos;
  const { todos, siguiente, envio, verMas } = useMasPaginas(leido.pagina, consulta);

  return (
    <div className="pila pila--apretada">
      <Tabla>
        <thead>
          <tr>
            <th>{texto.fecha}</th>
            <th className="izquierda">{texto.tipo}</th>
            <th>{texto.insumo}</th>
            <th className="numero">{texto.cantidad}</th>
            <th className="numero">{texto.importe}</th>
            <th className="izquierda">{texto.estado}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {todos.map((movimiento) => (
            <FilaDelLibro key={movimiento.id} movimiento={movimiento} insumo={leido.insumos.get(movimiento.itemId)} />
          ))}
        </tbody>
      </Tabla>
      <p className="nota">{texto.importeSinSigno}</p>
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      {siguiente !== null && (
        <div>
          <button type="button" disabled={envio.ocupado} onClick={() => void verMas()}>
            {texto.verMas}
          </button>
        </div>
      )}
    </div>
  );
}

function FilaDelLibro({
  movimiento,
  insumo,
}: {
  readonly movimiento: MovimientoLeido;
  readonly insumo: InsumoDelLibro | undefined;
}): ReactNode {
  const texto = TEXTOS.movimientos;
  const unidad = insumo === undefined ? '' : ` ${insumo.unidadDeUso}`;

  return (
    <tr>
      <td>{comoFecha(movimiento.occurredAt)}</td>
      <td className="izquierda">{texto.tipos[movimiento.tipo] ?? movimiento.tipo}</td>
      <td>
        {insumo?.nombre ?? TEXTOS.comun.sinDato}
        {movimiento.note !== null && <span className="nota"> · {movimiento.note}</span>}
      </td>
      <td className="numero">{`${sinCerosDeSobra(movimiento.cantidad)}${unidad}`}</td>
      <td className="numero">{movimiento.costoTotal === null ? TEXTOS.comun.sinDato : comoImporte(movimiento.costoTotal)}</td>
      <td className="izquierda">
        <EstadoDelMovimiento movimiento={movimiento} />
      </td>
      <td className="izquierda">
        <Corregir movimiento={movimiento} />
      </td>
    </tr>
  );
}

/**
 * El enlace a corregir, solo donde tiene sentido: ni sobre una fila ya
 * corregida ni sobre una corrección (la API lanza `CorreccionDeCorreccionError`
 * en el segundo caso). **Esto es cortesía, no la regla**: la regla está allá.
 */
function Corregir({ movimiento }: { readonly movimiento: MovimientoLeido }): ReactNode {
  const { tiene } = usePermisos();
  const corregible = movimiento.corregidoPor === null && movimiento.corrigeA === null;
  if (!corregible || !tiene('inventory.write')) return null;

  return (
    <Link href={`/movimientos/${movimiento.id}/corregir`} className="boton">
      {TEXTOS.correccion.enlace}
    </Link>
  );
}

function EstadoDelMovimiento({ movimiento }: { readonly movimiento: MovimientoLeido }): ReactNode {
  const texto = TEXTOS.movimientos;

  return (
    <div className="linea">
      {movimiento.corregidoPor !== null && <Pildora tono="neutro" texto={texto.corregido} />}
      {movimiento.corrigeA !== null && <Pildora tono="atencion" texto={texto.correccion} />}
      {movimiento.desglose === SIN_DESGLOSE && movimiento.tipo === 'COMPRA' && (
        <Pildora tono="neutro" texto={texto.sinDesglose} />
      )}
    </div>
  );
}
