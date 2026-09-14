'use client';

/**
 * Pantalla 8 (edición) — lo editable de una presentación de compra.
 *
 * **LA PRESENTACIÓN, SU UNIDAD Y EL FACTOR NO SE EDITAN**: convierten cada compra
 * histórica a unidades de uso, y cambiarlos reescribiría meses cerrados. Si el
 * saco pasa de 2 kg a 2,5 kg, es otra presentación. Se enseñan, no se tocan.
 *
 * **CORREGIR LA TARIFA SÍ**: los artículos anteriores a P16-A1 nacieron con 0.15
 * de semilla, no de verdad, y esta es la pantalla donde se arregla.
 */

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../../../../componentes/armazon/Permitido';
import type { Articulo } from '../../../../../../../componentes/insumos/ficha';
import { Marco } from '../../../../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../../../../componentes/ui/Campo';
import { CampoDePorcentaje } from '../../../../../../../componentes/ui/CampoNumerico';
import { Formulario } from '../../../../../../../componentes/ui/Formulario';
import { Selector } from '../../../../../../../componentes/ui/Selector';
import { Vista } from '../../../../../../../componentes/ui/Vista';
import { Volver } from '../../../../../../../componentes/ui/Volver';
import { llamar } from '../../../../../../../lib/api';
import { fraccionDePorcentaje, porcentajeDeFraccion, sinCerosDeSobra } from '../../../../../../../lib/decimales';
import { useEnvio } from '../../../../../../../lib/useEnvio';
import { useLectura } from '../../../../../../../lib/useLectura';
import { TEXTOS } from '../../../../../../../textos/es';

interface ArticuloConItem extends Articulo {
  readonly item: { readonly id: string; readonly nombre: string; readonly unidadDeUso: string };
}

export default function EditarArticulo(): ReactNode {
  const { id, articuloId } = useParams<{ id: string; articuloId: string }>();
  const lectura = useLectura<ArticuloConItem>(`/catalogo/articulos/${articuloId}`);

  return (
    <Permitido permiso="catalog.update">
      <Marco
        titulo={TEXTOS.articulo.editarTitulo}
        ayuda={lectura.datos === null ? '' : `${lectura.datos.item.nombre} · ${lectura.datos.nombre}`}
        acciones={<Volver href={`/insumos/${id}`} />}
      >
        <Vista lectura={lectura} vacio="nunca">
          {(articulo) => <FormularioDeEdicion articulo={articulo} />}
        </Vista>
      </Marco>
    </Permitido>
  );
}

function useEdicionDeArticulo(articulo: ArticuloConItem) {
  const router = useRouter();
  const envio = useEnvio();
  const [nombre, setNombre] = useState(articulo.nombre);
  const [marca, setMarca] = useState(articulo.marca ?? '');
  const [proveedor, setProveedor] = useState(articulo.proveedor ?? '');
  const [iva, setIva] = useState(porcentajeDeFraccion(articulo.ivaTarifa));
  const [estado, setEstado] = useState<string>(articulo.estado);

  async function guardar(): Promise<void> {
    const cuerpo = {
      nombre: nombre.trim(),
      marca: marca.trim() === '' ? null : marca.trim(),
      proveedor: proveedor.trim() === '' ? null : proveedor.trim(),
      ivaTarifa: fraccionDePorcentaje(iva),
      estado: estado === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    };
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: `/catalogo/articulos/${articulo.id}`, metodo: 'PUT', cuerpo });
    });
    if (salio) router.push(`/insumos/${articulo.item.id}`);
  }

  const campos = { nombre, setNombre, marca, setMarca, proveedor, setProveedor, iva, setIva, estado, setEstado };
  return { campos, envio, guardar };
}

function FormularioDeEdicion({ articulo }: { readonly articulo: ArticuloConItem }): ReactNode {
  const { campos, envio, guardar } = useEdicionDeArticulo(articulo);
  const t = TEXTOS.articulo;
  const fijos = `${sinCerosDeSobra(articulo.presentacion)} ${articulo.unidadDePresentacion} = ${sinCerosDeSobra(articulo.factorDeConversion)} ${articulo.item.unidadDeUso}`;

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={t.guardar} textoEnviando={t.guardando}>
      <p className="nota">{`${t.noEditables} ${fijos}`}</p>
      <CampoDeTexto etiqueta={t.nombre} nombre="nombre" requerido valor={campos.nombre} cambiar={campos.setNombre} />
      <CampoDeTexto etiqueta={t.marca} nombre="marca" valor={campos.marca} cambiar={campos.setMarca} />
      <CampoDeTexto etiqueta={t.proveedor} nombre="proveedor" valor={campos.proveedor} cambiar={campos.setProveedor} />
      <CampoDePorcentaje etiqueta={t.iva} nombre="iva" requerido valor={campos.iva} cambiar={campos.setIva} />
      <Selector
        etiqueta={t.estado}
        valor={campos.estado}
        opciones={[
          { valor: 'ACTIVE', texto: t.activo },
          { valor: 'INACTIVE', texto: t.archivado },
        ]}
        cambiar={campos.setEstado}
      />
    </Formulario>
  );
}
