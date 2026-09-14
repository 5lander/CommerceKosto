'use client';

/**
 * Pantalla 6 (edición) — lo editable de un insumo, sobre la versión que se leyó.
 *
 * **EL TIPO Y LA UNIDAD NO SE EDITAN**, y se enseñan como tales: la API no lo
 * permite porque cambiaría de magnitud cada cantidad histórica (200 «g» pasarían
 * a ser 200 «kg»). Si hace falta, es otro insumo.
 *
 * **SI OTRA PERSONA GUARDÓ ANTES, SE VUELVE A LEER** (409 `CONFLICTO_DE_VERSION`,
 * ADR-023). El formulario se monta de nuevo con lo que hay ahora —la clave es la
 * versión—: seguir con lo escrito encima de una ficha que ya cambió sería pisar
 * lo del otro sin haberlo visto.
 */

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../componentes/armazon/Permitido';
import { cambioDe, guardarItem, type FichaDeItem } from '../../../../../componentes/insumos/ficha';
import {
  CONFIANZAS,
  PORCENTAJE,
  SI,
  SI_NO,
  SIN_GRUPO,
  opcionesDeGrupos,
} from '../../../../../componentes/insumos/opciones';
import { Marco } from '../../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../../componentes/ui/Campo';
import { Formulario } from '../../../../../componentes/ui/Formulario';
import { Selector, type Opcion } from '../../../../../componentes/ui/Selector';
import { Vista } from '../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../componentes/ui/Volver';
import { llamar } from '../../../../../lib/api';
import { fraccionDePorcentaje, porcentajeDeFraccion } from '../../../../../lib/decimales';
import { useEnvio } from '../../../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../textos/es';

const CONFLICTO_DE_VERSION = 'CONFLICTO_DE_VERSION';

interface ParaEditar {
  readonly ficha: FichaDeItem;
  readonly grupos: readonly Opcion[];
}

interface Borrador {
  readonly nombre: string;
  readonly rendimiento: string;
  readonly grupoId: string;
  readonly confianzaDePrecio: string;
  readonly llevaStock: string;
}

function useParaEditar(id: string): Lectura<ParaEditar> {
  const leer = useMemo(
    () => async (): Promise<ParaEditar> => {
      const [ficha, grupos] = await Promise.all([
        llamar<FichaDeItem>({ ruta: `/catalogo/items/${id}` }),
        llamar<readonly { readonly id: string; readonly nombre: string }[]>({ ruta: '/catalogo/grupos' }),
      ]);
      return { ficha, grupos: opcionesDeGrupos(grupos) };
    },
    [id],
  );
  return useCarga(leer);
}

export default function EditarInsumo(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const lectura = useParaEditar(id);

  return (
    <Permitido permiso="catalog.update">
      <Marco
        titulo={TEXTOS.insumo.editarTitulo}
        ayuda={lectura.datos?.ficha.nombre ?? ''}
        acciones={<Volver href={`/insumos/${id}`} />}
      >
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => <FormularioDeEdicion key={datos.ficha.version} datos={datos} recargar={lectura.recargar} />}
        </Vista>
      </Marco>
    </Permitido>
  );
}

function borradorDe(ficha: FichaDeItem): Borrador {
  return {
    nombre: ficha.nombre,
    rendimiento: porcentajeDeFraccion(ficha.rendimiento),
    grupoId: ficha.grupoId ?? SIN_GRUPO,
    confianzaDePrecio: ficha.confianzaDePrecio,
    llevaStock: ficha.llevaStock === false ? 'no' : SI,
  };
}

function useEdicion(ficha: FichaDeItem) {
  const router = useRouter();
  const envio = useEnvio();
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(ficha));

  function cambiar(campo: keyof Borrador): (valor: string) => void {
    return (valor) => {
      setBorrador((anterior) => ({ ...anterior, [campo]: valor }));
    };
  }

  async function guardar(): Promise<void> {
    const salio = await envio.enviar(async () => {
      await guardarItem(ficha, {
        ...cambioDe(ficha),
        nombre: borrador.nombre.trim(),
        rendimiento: fraccionDePorcentaje(borrador.rendimiento),
        grupoId: borrador.grupoId === SIN_GRUPO ? null : borrador.grupoId,
        confianzaDePrecio: borrador.confianzaDePrecio === 'ESTIMADO' ? 'ESTIMADO' : 'FACTURA',
        llevaStock: ficha.tipo === 'PRODUCIDO' ? borrador.llevaStock === SI : null,
      });
    });
    if (salio) router.push(`/insumos/${ficha.id}`);
  }

  return { borrador, cambiar, envio, guardar };
}

function FormularioDeEdicion({ datos, recargar }: { readonly datos: ParaEditar; readonly recargar: () => void }): ReactNode {
  const { ficha } = datos;
  const { borrador, cambiar, envio, guardar } = useEdicion(ficha);
  const { insumo } = TEXTOS;

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={insumo.guardar} textoEnviando={insumo.guardando}>
      <p className="nota">{`${insumo.fijos} ${TEXTOS.insumos.tipos[ficha.tipo]} · ${ficha.unidadDeUso}`}</p>
      <CampoDeTexto etiqueta={insumo.nombre} nombre="nombre" requerido valor={borrador.nombre} cambiar={cambiar('nombre')} />
      <CampoDeTexto
        etiqueta={insumo.rendimiento}
        nombre="rendimiento"
        requerido
        valor={borrador.rendimiento}
        cambiar={(crudo) => {
          if (PORCENTAJE.test(crudo)) cambiar('rendimiento')(crudo);
        }}
      />
      <Selector etiqueta={insumo.grupo} valor={borrador.grupoId} opciones={datos.grupos} cambiar={cambiar('grupoId')} />
      <Selector etiqueta={insumo.confianza} valor={borrador.confianzaDePrecio} opciones={CONFIANZAS} cambiar={cambiar('confianzaDePrecio')} />
      {ficha.tipo === 'PRODUCIDO' && (
        <Selector etiqueta={insumo.llevaStock} valor={borrador.llevaStock} opciones={SI_NO} cambiar={cambiar('llevaStock')} />
      )}
      {envio.codigo === CONFLICTO_DE_VERSION && (
        <button type="button" onClick={recargar}>
          {insumo.volverACargar}
        </button>
      )}
    </Formulario>
  );
}
