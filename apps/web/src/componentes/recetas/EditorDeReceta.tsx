'use client';

/**
 * El editor de una receta: sus líneas, desde cuándo vale y una nota — `PUT /recetas`.
 *
 * **GUARDAR NO EDITA: CREA UNA VERSIÓN** (SPEC §9) con su vigencia; la anterior
 * queda consultable y los costeos pasados no se recalculan. Por eso el editor
 * arranca de la vigente y se guarda entero.
 *
 * **AP O EP ES LA CONDICIONAL MÁS FRÁGIL DEL MODELO** (R4): en `EP` —ya limpio— la
 * API aplica el rendimiento del insumo; en `AP` —tal como se compra—, no. La
 * pantalla lo pregunta con palabras de cocina y no decide nada.
 *
 * **EXCLUIR NO ES QUITAR**: una línea excluida sigue en la receta, cuesta cero y
 * deja ver qué se sacó; una quitada no está en la versión nueva. Un ciclo (R9)
 * lo rechaza la API al guardar, con el camino en el mensaje.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { textoOpcional } from '../../lib/campos';
import { conPuntoDecimal, sinCerosDeSobra } from '../../lib/decimales';
import { comoFecha, diaDeHoy, instanteDelDia } from '../../lib/fechas';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { CampoDeTexto } from '../ui/Campo';
import { Formulario } from '../ui/Formulario';
import type { Opcion } from '../ui/Selector';
import { VolverACargar } from '../ui/VolverACargar';
import { FilaDeReceta, type Fila } from './FilaDeReceta';
import { destinoDe, type ClaseDeDestino, type ParaEditarReceta } from './receta';

interface Destino {
  readonly clase: ClaseDeDestino;
  readonly id: string;
  readonly sucursal: string;
}

function opcionesDe(datos: ParaEditarReceta, destino: Destino): readonly Opcion[] {
  const enLaReceta = new Set((datos.vigente?.lineas ?? []).map((l) => l.itemId));
  return datos.insumos
    .filter((i) => i.id !== destino.id && (i.estado === 'ACTIVE' || enLaReceta.has(i.id)))
    .map((i) => ({ valor: i.id, texto: `${i.nombre} (${i.unidadDeUso})` }));
}

function useFilas(datos: ParaEditarReceta, opciones: readonly Opcion[]) {
  const iniciales = (datos.vigente?.lineas ?? []).map((l, posicion) => ({
    clave: posicion,
    itemId: l.itemId,
    cantidad: sinCerosDeSobra(l.cantidad),
    base: l.base,
    excluida: l.estado === 'INACTIVA',
  }));
  const [filas, setFilas] = useState<readonly Fila[]>(iniciales);
  const [siguiente, setSiguiente] = useState(iniciales.length);

  function anadir(): void {
    const primera = opciones[0];
    if (primera === undefined) return;
    setFilas([...filas, { clave: siguiente, itemId: primera.valor, cantidad: '', base: 'AP', excluida: false }]);
    setSiguiente(siguiente + 1);
  }

  function cambiar(clave: number, cambio: Partial<Omit<Fila, 'clave'>>): void {
    setFilas(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  }

  const quitar = (clave: number): void => {
    setFilas(filas.filter((f) => f.clave !== clave));
  };
  return { filas, anadir, cambiar, quitar };
}

function useGuardado(datos: ParaEditarReceta, destino: Destino, alGuardar: () => void) {
  const envio = useEnvio();
  const [desde, setDesde] = useState(diaDeHoy());
  const [nota, setNota] = useState('');

  async function guardar(filas: readonly Fila[]): Promise<void> {
    const cuerpo = {
      basadaEn: datos.ultimaVersionId,
      destino: destinoDe(destino.clase, destino.id),
      locationId: destino.sucursal,
      validFrom: instanteDelDia(desde),
      nota: textoOpcional(nota),
      lineas: filas.map((f) => ({
        itemId: f.itemId,
        cantidad: conPuntoDecimal(f.cantidad),
        base: f.base,
        estado: f.excluida ? 'INACTIVA' : 'ACTIVA',
      })),
    };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/recetas', metodo: 'PUT', cuerpo });
    });
    if (salio) alGuardar();
  }

  return { envio, desde, setDesde, nota, setNota, guardar };
}

export function EditorDeReceta({
  datos,
  destino,
  alGuardar,
  recargar,
}: {
  readonly datos: ParaEditarReceta;
  readonly destino: Destino;
  readonly alGuardar: () => void;
  readonly recargar: () => void;
}): ReactNode {
  const opciones = opcionesDe(datos, destino);
  const lineas = useFilas(datos, opciones);
  const guardado = useGuardado(datos, destino, alGuardar);
  const texto = TEXTOS.receta;

  return (
    <Formulario
      envio={guardado.envio}
      alEnviar={() => guardado.guardar(lineas.filas)}
      textoDelBoton={texto.guardar}
      textoEnviando={texto.guardando}
    >
      <EstadoDeLaReceta datos={datos} />
      <LineasDeLaReceta lineas={lineas} opciones={opciones} insumos={datos.insumos} />
      <CamposDeLaVersion guardado={guardado} />
      <VolverACargar envio={guardado.envio} recargar={recargar} />
    </Formulario>
  );
}

function LineasDeLaReceta({
  lineas,
  opciones,
  insumos,
}: {
  readonly lineas: ReturnType<typeof useFilas>;
  readonly opciones: readonly Opcion[];
  readonly insumos: ParaEditarReceta['insumos'];
}): ReactNode {
  const unidades = new Map(insumos.map((i) => [i.id, i.unidadDeUso]));

  return (
    <>
      {lineas.filas.map((fila) => (
        <FilaDeReceta
          key={fila.clave}
          fila={fila}
          opciones={opciones}
          unidad={unidades.get(fila.itemId) ?? ''}
          cambiar={(cambio) => {
            lineas.cambiar(fila.clave, cambio);
          }}
          quitar={() => {
            lineas.quitar(fila.clave);
          }}
        />
      ))}
      <div>
        <button type="button" onClick={lineas.anadir} disabled={opciones.length === 0}>
          {TEXTOS.receta.anadir}
        </button>
      </div>
    </>
  );
}

/** Desde cuándo vale la versión nueva y por qué se hizo. */
function CamposDeLaVersion({ guardado }: { readonly guardado: ReturnType<typeof useGuardado> }): ReactNode {
  const texto = TEXTOS.receta;

  return (
    <>
      <CampoDeTexto
        etiqueta={texto.desde}
        nombre="desde"
        tipo="date"
        requerido
        valor={guardado.desde}
        cambiar={guardado.setDesde}
      />
      <CampoDeTexto etiqueta={texto.nota} nombre="nota" valor={guardado.nota} cambiar={guardado.setNota} />
    </>
  );
}

/** Qué hay hoy, y si alguien dejó ya una versión que vale más adelante. */
function EstadoDeLaReceta({ datos }: { readonly datos: ParaEditarReceta }): ReactNode {
  const texto = TEXTOS.receta;
  const hayFutura = datos.ultimaVersionId !== null && datos.ultimaVersionId !== datos.vigente?.id;

  return (
    <div className="pila pila--minima">
      <p className="nota">
        {datos.vigente === null ? texto.sinVigente : `${texto.vigenteDesde} ${comoFecha(datos.vigente.validFrom)}`}
      </p>
      {hayFutura && <p className="nota atencion">{texto.hayFutura}</p>}
      <p className="nota">{texto.ayudaBase}</p>
    </div>
  );
}
