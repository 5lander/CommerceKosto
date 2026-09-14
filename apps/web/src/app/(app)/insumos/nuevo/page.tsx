'use client';

/**
 * Pantalla 5 — alta de un insumo.
 *
 * **EL RENDIMIENTO SE ESCRIBE EN PORCENTAJE**, como se lee en el listado, y la
 * API lo recibe como fracción: «85» viaja como `"0.85"`. La conversión corre la
 * coma sobre el texto (`fraccionDePorcentaje`), sin pasar por `Number`. Si el
 * valor no tiene sentido —más de 100, cero— lo dice la API con su 400: la regla
 * vive allí.
 *
 * **LA UNIDAD DE USO SE ELIGE, NO SE ESCRIBE** (P16-A2): `"l"` está bien escrito
 * y no existe —el litro es `lt`—, así que la lista sale de `GET /catalogo/unidades`.
 *
 * **«¿LLEVA STOCK?» SOLO EN UNA PREPARACIÓN**: la API lo exige ahí y lo prohíbe
 * en un ítem comprado, así que el campo aparece al elegir el tipo y viaja como
 * `null` en el otro.
 *
 * **LA UNIDAD Y EL TIPO NO SE PODRÁN CAMBIAR DESPUÉS** (la API no lo permite:
 * cambiarían de magnitud las cantidades históricas), y la ayuda lo dice antes de
 * guardar, no después.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { Marco } from '../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../componentes/ui/Campo';
import { Formulario } from '../../../../componentes/ui/Formulario';
import { Selector, type Opcion } from '../../../../componentes/ui/Selector';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { llamar } from '../../../../lib/api';
import { fraccionDePorcentaje } from '../../../../lib/decimales';
import { useEnvio } from '../../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

/** Un porcentaje con hasta dos decimales, con coma o punto. */
const PORCENTAJE = /^\d{0,3}(?:[.,]\d{0,2})?$/u;

const SIN_GRUPO = '';
const SI = 'si';
const NO = 'no';

interface Unidad {
  readonly codigo: string;
  readonly nombre: string;
}

interface Grupo {
  readonly id: string;
  readonly nombre: string;
}

interface Opciones {
  readonly unidades: readonly Opcion[];
  readonly grupos: readonly Opcion[];
}

interface Borrador {
  readonly nombre: string;
  readonly tipo: 'COMPRADO' | 'PRODUCIDO';
  readonly unidadDeUso: string;
  readonly rendimiento: string;
  readonly grupoId: string;
  readonly confianzaDePrecio: 'FACTURA' | 'ESTIMADO';
  readonly llevaStock: string;
}

function useOpciones(): Lectura<Opciones> {
  const leer = useMemo(
    () => async (): Promise<Opciones> => {
      const [unidades, grupos] = await Promise.all([
        llamar<readonly Unidad[]>({ ruta: '/catalogo/unidades' }),
        llamar<readonly Grupo[]>({ ruta: '/catalogo/grupos' }),
      ]);
      return {
        unidades: unidades.map((u) => ({ valor: u.codigo, texto: `${u.codigo} — ${u.nombre}` })),
        grupos: [{ valor: SIN_GRUPO, texto: TEXTOS.insumo.sinGrupo }, ...grupos.map((g) => ({ valor: g.id, texto: g.nombre }))],
      };
    },
    [],
  );
  return useCarga(leer);
}

export default function NuevoInsumo(): ReactNode {
  const opciones = useOpciones();

  return (
    <Permitido permiso="catalog.create">
      <Marco titulo={TEXTOS.insumo.nuevoTitulo} ayuda={TEXTOS.insumo.nuevoAyuda} acciones={<Volver href="/insumos" />}>
        <Vista lectura={opciones} vacio="nunca">
          {(leidas) => <FormularioDeAlta opciones={leidas} />}
        </Vista>
      </Marco>
    </Permitido>
  );
}

/** El cuerpo de `POST /catalogo/items` desde lo que se escribió. */
function cuerpoDe(borrador: Borrador): Readonly<Record<string, unknown>> {
  return {
    nombre: borrador.nombre.trim(),
    tipo: borrador.tipo,
    unidadDeUso: borrador.unidadDeUso,
    rendimiento: fraccionDePorcentaje(borrador.rendimiento),
    grupoId: borrador.grupoId === SIN_GRUPO ? null : borrador.grupoId,
    confianzaDePrecio: borrador.confianzaDePrecio,
    llevaStock: borrador.tipo === 'PRODUCIDO' ? borrador.llevaStock === SI : null,
  };
}

function useAlta(opciones: Opciones) {
  const router = useRouter();
  const envio = useEnvio();
  const [borrador, setBorrador] = useState<Borrador>({
    nombre: '',
    tipo: 'COMPRADO',
    unidadDeUso: opciones.unidades[0]?.valor ?? '',
    rendimiento: '100',
    grupoId: SIN_GRUPO,
    confianzaDePrecio: 'FACTURA',
    llevaStock: SI,
  });

  function cambiar<K extends keyof Borrador>(campo: K): (valor: Borrador[K]) => void {
    return (valor) => {
      setBorrador((anterior) => ({ ...anterior, [campo]: valor }));
    };
  }

  async function guardar(): Promise<void> {
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/catalogo/items', metodo: 'POST', cuerpo: cuerpoDe(borrador) });
    });
    if (salio) router.push('/insumos');
  }

  return { borrador, cambiar, envio, guardar };
}

function FormularioDeAlta({ opciones }: { readonly opciones: Opciones }): ReactNode {
  const { borrador, cambiar, envio, guardar } = useAlta(opciones);
  const { insumo } = TEXTOS;

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={insumo.crear} textoEnviando={insumo.creando}>
      <CampoDeTexto etiqueta={insumo.nombre} nombre="nombre" requerido valor={borrador.nombre} cambiar={cambiar('nombre')} />
      <Selector
        etiqueta={insumo.tipo}
        valor={borrador.tipo}
        opciones={TIPOS}
        cambiar={(valor) => {
          cambiar('tipo')(valor === 'PRODUCIDO' ? 'PRODUCIDO' : 'COMPRADO');
        }}
      />
      {borrador.tipo === 'PRODUCIDO' && (
        <Selector etiqueta={insumo.llevaStock} valor={borrador.llevaStock} opciones={SI_NO} cambiar={cambiar('llevaStock')} />
      )}
      <Selector etiqueta={insumo.unidad} valor={borrador.unidadDeUso} opciones={opciones.unidades} cambiar={cambiar('unidadDeUso')} />
      <p className="nota">{insumo.unidadAyuda}</p>
      <CampoDeRendimiento valor={borrador.rendimiento} cambiar={cambiar('rendimiento')} />
      <Selector etiqueta={insumo.grupo} valor={borrador.grupoId} opciones={opciones.grupos} cambiar={cambiar('grupoId')} />
      <Selector
        etiqueta={insumo.confianza}
        valor={borrador.confianzaDePrecio}
        opciones={CONFIANZAS}
        cambiar={(valor) => {
          cambiar('confianzaDePrecio')(valor === 'ESTIMADO' ? 'ESTIMADO' : 'FACTURA');
        }}
      />
    </Formulario>
  );
}

const TIPOS: readonly Opcion[] = [
  { valor: 'COMPRADO', texto: TEXTOS.insumos.tipos.COMPRADO },
  { valor: 'PRODUCIDO', texto: TEXTOS.insumos.tipos.PRODUCIDO },
];

const SI_NO: readonly Opcion[] = [
  { valor: SI, texto: TEXTOS.insumo.llevaStockSi },
  { valor: NO, texto: TEXTOS.insumo.llevaStockNo },
];

const CONFIANZAS: readonly Opcion[] = [
  { valor: 'FACTURA', texto: TEXTOS.insumo.confianzas.FACTURA },
  { valor: 'ESTIMADO', texto: TEXTOS.insumo.confianzas.ESTIMADO },
];

function CampoDeRendimiento({
  valor,
  cambiar,
}: {
  readonly valor: string;
  readonly cambiar: (valor: string) => void;
}): ReactNode {
  return (
    <>
      <CampoDeTexto
        etiqueta={TEXTOS.insumo.rendimiento}
        nombre="rendimiento"
        requerido
        valor={valor}
        cambiar={(crudo) => {
          if (PORCENTAJE.test(crudo)) cambiar(crudo);
        }}
      />
      <p className="nota">{TEXTOS.insumo.rendimientoAyuda}</p>
    </>
  );
}
