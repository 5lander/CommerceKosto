'use client';

/**
 * Pantalla 8 — una presentación de compra nueva para un insumo: «el saco de 2 kg».
 *
 * **LA TARIFA DE IVA ES DEL ARTÍCULO Y ES OBLIGATORIA** (P16-A1, D-16.9): la
 * factura del saco de harina dice 0 % y la del detergente 15 %. Se precarga con
 * la del grupo del insumo si la define, porque es lo más probable, y se puede
 * cambiar.
 *
 * **EL FACTOR DE CONVERSIÓN SOLO SE PIDE CUANDO LA FÍSICA NO LO DA**: si la
 * presentación y la unidad de uso son de la misma dimensión —kg y g—, lo calcula
 * la API y mandarlo es 400. Si no —«un huevo pesa 50 g»—, hace falta. La pantalla
 * compara la dimensión de las dos unidades, que es un dato de
 * `GET /catalogo/unidades`, para enseñar el campo solo cuando toca; quien decide
 * sigue siendo la API.
 */

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../../componentes/armazon/Permitido';
import type { FichaDeItem } from '../../../../../../componentes/insumos/ficha';
import { Marco } from '../../../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../../../componentes/ui/Campo';
import { CampoDeCantidad, CampoDePorcentaje } from '../../../../../../componentes/ui/CampoNumerico';
import { Formulario } from '../../../../../../componentes/ui/Formulario';
import { Selector } from '../../../../../../componentes/ui/Selector';
import { Vista } from '../../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../../componentes/ui/Volver';
import { llamar } from '../../../../../../lib/api';
import { textoOpcional } from '../../../../../../lib/campos';
import { conPuntoDecimal, fraccionDePorcentaje, porcentajeDeFraccion } from '../../../../../../lib/decimales';
import { useEnvio } from '../../../../../../lib/useEnvio';
import { useCarga, type Lectura } from '../../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../../textos/es';

interface Unidad {
  readonly codigo: string;
  readonly nombre: string;
  readonly dimension: string;
}

interface ParaCrear {
  readonly ficha: FichaDeItem;
  readonly unidades: readonly Unidad[];
}

interface Borrador {
  readonly nombre: string;
  readonly marca: string;
  readonly proveedor: string;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
  readonly factor: string;
  readonly iva: string;
}

function useParaCrear(id: string): Lectura<ParaCrear> {
  const leer = useMemo(
    () => async (): Promise<ParaCrear> => {
      const [ficha, unidades] = await Promise.all([
        llamar<FichaDeItem>({ ruta: `/catalogo/items/${id}` }),
        llamar<readonly Unidad[]>({ ruta: '/catalogo/unidades' }),
      ]);
      return { ficha, unidades };
    },
    [id],
  );
  return useCarga(leer);
}

export default function NuevoArticulo(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const lectura = useParaCrear(id);

  return (
    <Permitido permiso="catalog.create">
      <Marco
        titulo={TEXTOS.articulo.nuevoTitulo}
        ayuda={lectura.datos?.ficha.nombre ?? ''}
        acciones={<Volver href={`/insumos/${id}`} />}
      >
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => <FormularioDeArticulo datos={datos} />}
        </Vista>
      </Marco>
    </Permitido>
  );
}

/** Si hay que pedir el factor: la presentación no es de la misma dimensión que la unidad de uso. */
function pideFactor(datos: ParaCrear, unidadDePresentacion: string): boolean {
  const dimensionDe = (codigo: string): string | undefined => datos.unidades.find((u) => u.codigo === codigo)?.dimension;
  return dimensionDe(unidadDePresentacion) !== dimensionDe(datos.ficha.unidadDeUso);
}

function vacioDe(ficha: FichaDeItem): Borrador {
  const ivaDelGrupo = ficha.grupo?.ivaTarifa ?? null;
  return {
    nombre: '',
    marca: '',
    proveedor: '',
    presentacion: '',
    unidadDePresentacion: ficha.unidadDeUso,
    factor: '',
    iva: ivaDelGrupo === null ? '' : porcentajeDeFraccion(ivaDelGrupo),
  };
}

function useAltaDeArticulo(datos: ParaCrear) {
  const router = useRouter();
  const envio = useEnvio();
  const [borrador, setBorrador] = useState<Borrador>(() => vacioDe(datos.ficha));
  const conFactor = pideFactor(datos, borrador.unidadDePresentacion);

  function cambiar(campo: keyof Borrador): (valor: string) => void {
    return (valor) => {
      setBorrador((anterior) => ({ ...anterior, [campo]: valor }));
    };
  }

  async function guardar(): Promise<void> {
    const cuerpo = {
      itemId: datos.ficha.id,
      nombre: borrador.nombre.trim(),
      marca: textoOpcional(borrador.marca),
      proveedor: textoOpcional(borrador.proveedor),
      presentacion: conPuntoDecimal(borrador.presentacion),
      unidadDePresentacion: borrador.unidadDePresentacion,
      factorExplicito: conFactor ? conPuntoDecimal(borrador.factor) : null,
      ivaTarifa: fraccionDePorcentaje(borrador.iva),
    };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/catalogo/articulos', metodo: 'POST', cuerpo });
    });
    if (salio) router.push(`/insumos/${datos.ficha.id}`);
  }

  return { borrador, cambiar, conFactor, envio, guardar };
}

function FormularioDeArticulo({ datos }: { readonly datos: ParaCrear }): ReactNode {
  const { borrador, cambiar, conFactor, envio, guardar } = useAltaDeArticulo(datos);
  const { articulo } = TEXTOS;
  const unidades = datos.unidades.map((u) => ({ valor: u.codigo, texto: `${u.codigo} — ${u.nombre}` }));

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={articulo.crear} textoEnviando={articulo.creando}>
      <CampoDeTexto etiqueta={articulo.nombre} nombre="nombre" requerido valor={borrador.nombre} cambiar={cambiar('nombre')} />
      <CampoDeTexto etiqueta={articulo.marca} nombre="marca" valor={borrador.marca} cambiar={cambiar('marca')} />
      <CampoDeTexto etiqueta={articulo.proveedor} nombre="proveedor" valor={borrador.proveedor} cambiar={cambiar('proveedor')} />
      <CampoDeCantidad etiqueta={articulo.presentacion} nombre="presentacion" requerido valor={borrador.presentacion} cambiar={cambiar('presentacion')} />
      <Selector etiqueta={articulo.unidad} valor={borrador.unidadDePresentacion} opciones={unidades} cambiar={cambiar('unidadDePresentacion')} />
      {conFactor && (
        <CampoDeCantidad
          etiqueta={`${articulo.factor} ${datos.ficha.unidadDeUso}`}
          nombre="factor"
          requerido
          valor={borrador.factor}
          cambiar={cambiar('factor')}
        />
      )}
      <p className="nota">{articulo.fijos}</p>
      <CampoDePorcentaje etiqueta={articulo.iva} nombre="iva" requerido valor={borrador.iva} cambiar={cambiar('iva')} />
    </Formulario>
  );
}
