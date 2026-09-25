'use client';

/**
 * Registrar una compra, una merma o un ajuste — `POST /inventario/movimientos`.
 *
 * **EL FORMULARIO PREGUNTA LO QUE EL TIPO SIGNIFICA**, no lo que la tabla
 * guarda: «cuánto entró», «cuánto se perdió», «la diferencia». El signo lo pone
 * el dominio y aquí no se resta nada (ver `movimiento-nuevo.ts`).
 *
 * **EL MES CERRADO Y LA FECHA FUTURA LOS DICE LA API**, con su motivo escrito
 * para leerse. Esta pantalla no consulta los períodos para adelantarse: sería
 * la misma regla en dos sitios, y además `BODEGA` —que es quien más usa esto—
 * no tiene `period.read`.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { llamar } from '../../lib/api';
import { diaDeHoy } from '../../lib/fechas';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';
import { CampoDeTexto } from '../ui/Campo';
import { CampoDeCantidad, CampoDeCantidadConSigno, CampoDePorcentaje } from '../ui/CampoNumerico';
import { Formulario } from '../ui/Formulario';
import { Selector, type Opcion } from '../ui/Selector';
import type { InsumoDelLibro } from './libro';
import {
  articuloPorDefecto,
  articulosDe,
  cuerpoDe,
  SIN_ARTICULO,
  tipoDe,
  TIPOS_DIRECTOS,
  type ArticuloDeCompra,
  type Borrador,
  type TipoDirecto,
} from './movimiento-nuevo';

export interface DatosDelFormulario {
  readonly insumos: readonly InsumoDelLibro[];
  readonly articulos: readonly ArticuloDeCompra[];
}

function borradorInicial(datos: DatosDelFormulario): Borrador {
  const itemId = datos.insumos[0]?.id ?? '';

  return {
    tipo: 'COMPRA',
    itemId,
    cantidad: '',
    articuloId: articuloPorDefecto(datos.articulos, itemId),
    total: '',
    iva: '',
    fecha: diaDeHoy(),
    nota: '',
  };
}

export function FormularioDeMovimiento({
  datos,
  sucursal,
  alRegistrar,
}: {
  readonly datos: DatosDelFormulario;
  readonly sucursal: string;
  readonly alRegistrar: () => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;
  const [borrador, setBorrador] = useState<Borrador>(() => borradorInicial(datos));
  const envio = useEnvio();

  const cambiar = (cambio: Partial<Borrador>): void => {
    setBorrador({ ...borrador, ...cambio });
  };

  async function registrar(): Promise<void> {
    const bien = await envio.enviar(async () => {
      await llamar({ ruta: '/inventario/movimientos', metodo: 'POST', cuerpo: cuerpoDe(borrador, sucursal) });
    });
    if (bien) alRegistrar();
  }

  if (datos.insumos.length === 0) return <p className="panel panel--relleno atencion">{texto.sinInsumos}</p>;

  return (
    <Formulario
      envio={envio}
      alEnviar={registrar}
      textoDelBoton={texto.registrar}
      textoEnviando={texto.registrando}
    >
      <QueEs tipo={borrador.tipo} cambiar={cambiar} />
      <SelectorDeInsumo datos={datos} valor={borrador.itemId} cambiar={cambiar} />
      <Cantidad borrador={borrador} cambiar={cambiar} />
      {borrador.tipo === 'COMPRA' && <CamposDeCompra borrador={borrador} articulos={datos.articulos} cambiar={cambiar} />}
      <CuandoYPorQue borrador={borrador} cambiar={cambiar} />
    </Formulario>
  );
}

function SelectorDeInsumo({
  datos,
  valor,
  cambiar,
}: {
  readonly datos: DatosDelFormulario;
  readonly valor: string;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  return (
    <Selector
      etiqueta={TEXTOS.movimientoNuevo.insumo}
      valor={valor}
      opciones={datos.insumos.map((insumo) => ({ valor: insumo.id, texto: `${insumo.nombre} (${insumo.unidadDeUso})` }))}
      cambiar={(itemId) => {
        // La presentación es de un insumo: la del anterior deja de valer, y se
        // elige la primera del nuevo para no caer en el 400 de la tarifa.
        cambiar({ itemId, articuloId: articuloPorDefecto(datos.articulos, itemId) });
      }}
    />
  );
}

/** La fecha del hecho y la nota: lo que hace entendible la fila dentro de seis meses. */
function CuandoYPorQue({
  borrador,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;

  return (
    <>
      <CampoDeTexto
        etiqueta={texto.fecha}
        nombre="fecha"
        tipo="date"
        requerido
        valor={borrador.fecha}
        cambiar={(fecha) => {
          cambiar({ fecha });
        }}
      />
      <p className="nota">{texto.fechaAyuda}</p>
      <CampoDeTexto
        etiqueta={texto.nota}
        nombre="nota"
        valor={borrador.nota}
        cambiar={(nota) => {
          cambiar({ nota });
        }}
      />
      <p className="nota">{texto.notaAyuda}</p>
    </>
  );
}

function QueEs({
  tipo,
  cambiar,
}: {
  readonly tipo: TipoDirecto;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;
  const opciones: readonly Opcion[] = TIPOS_DIRECTOS.map((uno) => ({ valor: uno, texto: texto.tipos[uno] ?? uno }));

  return (
    <>
      <Selector
        etiqueta={texto.queEs}
        valor={tipo}
        opciones={opciones}
        cambiar={(elegido) => {
          // Se vacía el IMPORTE, no la presentación: un total con IVA arrastrado
          // a una merma sería un importe inventado, mientras que la presentación
          // es del insumo y sigue valiendo si se vuelve a compra.
          cambiar({ tipo: tipoDe(elegido), total: '', iva: '' });
        }}
      />
      <p className="nota">{texto.ayudasDeTipo[tipo]}</p>
    </>
  );
}

/** `AJUSTE` es el único con signo; los otros dos piden la magnitud (`movimiento.ts`). */
function Cantidad({
  borrador,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;
  const propiedades = {
    etiqueta: texto.cantidades[borrador.tipo] ?? texto.cantidades['COMPRA'] ?? '',
    nombre: 'cantidad',
    requerido: true,
    valor: borrador.cantidad,
    cambiar: (cantidad: string) => {
      cambiar({ cantidad });
    },
  };

  return borrador.tipo === 'AJUSTE' ? <CampoDeCantidadConSigno {...propiedades} /> : <CampoDeCantidad {...propiedades} />;
}

function CamposDeCompra({
  borrador,
  articulos,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly articulos: readonly ArticuloDeCompra[];
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;

  return (
    <>
      <Selector
        etiqueta={texto.articulo}
        valor={borrador.articuloId}
        opciones={opcionesDeArticulos(articulos, borrador.itemId)}
        cambiar={(articuloId) => {
          cambiar({ articuloId });
        }}
      />
      <p className="nota">{texto.articuloAyuda}</p>
      <ImporteDeLaCompra borrador={borrador} cambiar={cambiar} />
    </>
  );
}

/** El total BRUTO de la factura (D-16.9) y, solo si esta factura se sale, su tarifa. */
function ImporteDeLaCompra({
  borrador,
  cambiar,
}: {
  readonly borrador: Borrador;
  readonly cambiar: (cambio: Partial<Borrador>) => void;
}): ReactNode {
  const texto = TEXTOS.movimientoNuevo;

  return (
    <>
      <CampoDeCantidad
        etiqueta={texto.total}
        nombre="total"
        requerido
        valor={borrador.total}
        cambiar={(total) => {
          cambiar({ total });
        }}
      />
      <p className="nota">{texto.totalAyuda}</p>
      <CampoDePorcentaje
        etiqueta={texto.iva}
        nombre="iva"
        valor={borrador.iva}
        cambiar={(iva) => {
          cambiar({ iva });
        }}
      />
      <p className="nota">{texto.ivaAyuda}</p>
    </>
  );
}

function opcionesDeArticulos(articulos: readonly ArticuloDeCompra[], itemId: string): readonly Opcion[] {
  return [
    { valor: SIN_ARTICULO, texto: TEXTOS.movimientoNuevo.sinArticulo },
    ...articulosDe(articulos, itemId).map((articulo) => ({
      valor: articulo.id,
      texto: `${articulo.nombre} · ${articulo.presentacion} ${articulo.unidadDePresentacion}`,
    })),
  ];
}
