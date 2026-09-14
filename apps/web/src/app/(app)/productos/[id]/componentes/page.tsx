'use client';

/**
 * Pantalla 13 — los componentes de un combo (`PUT /productos/:id/componentes`).
 *
 * **SE MANDA LA LISTA ENTERA** (D-16.114): lo que no va deja de ser componente. Por
 * eso el editor trabaja sobre una copia de lo leído y la guarda de una vez, con la
 * `version` del combo; si otra escritura del producto llegó antes, 409 y se vuelve
 * a leer (ADR-023).
 *
 * **LAS REGLAS SON DE LA API, CON SU MOTIVO**: un componente tiene que ser un
 * producto con receta, no el propio combo, no repetido y con cantidad mayor que
 * cero. El selector ofrece solo productos con receta activos —más los que ya
 * estuvieran—, que es ayuda; el 400 sigue diciendo por qué si algo no vale.
 *
 * **CADA FILA LLEVA SU PROPIA CLAVE**, un contador y no el producto: dos filas
 * pueden apuntar un momento al mismo producto mientras se editan (INC-026).
 */

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../componentes/armazon/Permitido';
import { Marco } from '../../../../../componentes/Marco';
import type { ComponentesLeidos } from '../../../../../componentes/productos/ComponentesDelCombo';
import type { FichaDeProducto } from '../../../../../componentes/productos/ficha';
import { CampoDeCantidad } from '../../../../../componentes/ui/CampoNumerico';
import { Formulario } from '../../../../../componentes/ui/Formulario';
import { Selector, type Opcion } from '../../../../../componentes/ui/Selector';
import { Vista } from '../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../componentes/ui/Volver';
import { VolverACargar } from '../../../../../componentes/ui/VolverACargar';
import { llamar } from '../../../../../lib/api';
import { conPuntoDecimal, sinCerosDeSobra } from '../../../../../lib/decimales';
import { useEnvio } from '../../../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../textos/es';

interface ParaEditar {
  readonly ficha: FichaDeProducto;
  readonly actuales: ComponentesLeidos;
  /** Los productos que pueden ser componente, más los que ya lo son. */
  readonly opciones: readonly Opcion[];
}

interface Fila {
  readonly clave: number;
  readonly productId: string;
  readonly cantidad: string;
}

function opcionesDe(productos: readonly FichaDeProducto[], actuales: ComponentesLeidos, comboId: string): readonly Opcion[] {
  const yaEstan = new Set(actuales.componentes.map((c) => c.productId));
  return productos
    .filter((p) => p.id !== comboId && p.tipo === 'SIMPLE' && (p.estado === 'ACTIVE' || yaEstan.has(p.id)))
    .map((p) => ({ valor: p.id, texto: p.nombre }));
}

function useParaEditar(id: string): Lectura<ParaEditar> {
  const leer = useMemo(
    () => async (): Promise<ParaEditar> => {
      const [ficha, actuales, productos] = await Promise.all([
        llamar<FichaDeProducto>({ ruta: `/productos/${id}` }),
        llamar<ComponentesLeidos>({ ruta: `/productos/${id}/componentes` }),
        llamar<readonly FichaDeProducto[]>({ ruta: '/productos' }),
      ]);
      return { ficha, actuales, opciones: opcionesDe(productos, actuales, id) };
    },
    [id],
  );
  return useCarga(leer);
}

export default function ComponentesDeUnCombo(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const lectura = useParaEditar(id);
  const texto = TEXTOS.componentes;

  return (
    <Permitido permiso="product.write">
      <Marco
        titulo={texto.editarTitulo}
        ayuda={lectura.datos?.ficha.nombre ?? ''}
        acciones={<Volver href={`/productos/${id}`} />}
      >
        <Vista lectura={lectura} vacio="nunca">
          {(datos) =>
            datos.ficha.tipo === 'COMBO' ? (
              <EditorDeComponentes
                key={`editor-${String(datos.actuales.version)}`}
                datos={datos}
                recargar={lectura.recargar}
              />
            ) : (
              <p className="panel panel--relleno atencion">{texto.noEsCombo}</p>
            )
          }
        </Vista>
      </Marco>
    </Permitido>
  );
}

function useEditor(datos: ParaEditar) {
  const router = useRouter();
  const envio = useEnvio();
  const iniciales = datos.actuales.componentes.map((c, posicion) => ({
    clave: posicion,
    productId: c.productId,
    cantidad: sinCerosDeSobra(c.cantidad),
  }));
  const [filas, setFilas] = useState<readonly Fila[]>(iniciales);
  const [siguiente, setSiguiente] = useState(iniciales.length);

  function anadir(): void {
    const usados = new Set(filas.map((f) => f.productId));
    const libre = datos.opciones.find((o) => !usados.has(o.valor)) ?? datos.opciones[0];
    if (libre === undefined) return;
    setFilas([...filas, { clave: siguiente, productId: libre.valor, cantidad: '1' }]);
    setSiguiente(siguiente + 1);
  }

  function cambiar(clave: number, cambio: Partial<Omit<Fila, 'clave'>>): void {
    setFilas(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  }

  async function guardar(): Promise<void> {
    const componentes = filas.map((f) => ({ productId: f.productId, cantidad: conPuntoDecimal(f.cantidad) }));
    const cuerpo = { version: datos.actuales.version, componentes };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: `/productos/${datos.ficha.id}/componentes`, metodo: 'PUT', cuerpo });
    });
    if (salio) router.push(`/productos/${datos.ficha.id}`);
  }

  const quitar = (clave: number): void => {
    setFilas(filas.filter((f) => f.clave !== clave));
  };
  return { filas, envio, anadir, cambiar, quitar, guardar };
}

function EditorDeComponentes({ datos, recargar }: { readonly datos: ParaEditar; readonly recargar: () => void }): ReactNode {
  const { filas, envio, anadir, cambiar, quitar, guardar } = useEditor(datos);
  const texto = TEXTOS.componentes;

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={texto.guardar} textoEnviando={texto.guardando}>
      <p className="nota">{texto.ayuda}</p>
      {filas.length === 0 && <p className="nota">{texto.sinFilas}</p>}
      {filas.map((fila) => (
        <FilaDeComponente
          key={fila.clave}
          fila={fila}
          opciones={datos.opciones}
          cambiar={(cambio) => {
            cambiar(fila.clave, cambio);
          }}
          quitar={() => {
            quitar(fila.clave);
          }}
        />
      ))}
      {datos.opciones.length === 0 ? (
        <p className="nota atencion">{texto.sinOpciones}</p>
      ) : (
        <div>
          <button type="button" onClick={anadir}>
            {texto.anadir}
          </button>
        </div>
      )}
      <VolverACargar envio={envio} recargar={recargar} />
    </Formulario>
  );
}

function FilaDeComponente({
  fila,
  opciones,
  cambiar,
  quitar,
}: {
  readonly fila: Fila;
  readonly opciones: readonly Opcion[];
  readonly cambiar: (cambio: Partial<Omit<Fila, 'clave'>>) => void;
  readonly quitar: () => void;
}): ReactNode {
  const texto = TEXTOS.componentes;

  return (
    <div className="linea linea--base">
      <Selector
        etiqueta={texto.producto}
        valor={fila.productId}
        opciones={opciones}
        cambiar={(productId) => {
          cambiar({ productId });
        }}
      />
      <CampoDeCantidad
        etiqueta={texto.cantidad}
        nombre={`cantidad-${String(fila.clave)}`}
        requerido
        valor={fila.cantidad}
        cambiar={(cantidad) => {
          cambiar({ cantidad });
        }}
      />
      <button type="button" onClick={quitar}>
        {texto.quitar}
      </button>
    </div>
  );
}
