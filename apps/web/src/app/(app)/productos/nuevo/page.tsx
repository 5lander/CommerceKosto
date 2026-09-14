'use client';

/**
 * Pantalla 11 (alta) — un producto nuevo: nombre, tipo y categoría (`POST /productos`).
 *
 * **LA PORCIÓN, NO EL PLATO** (SPEC §8): «Arroz con carne (segundo)» y «(plato
 * fuerte)» son dos productos, con su receta, su categoría y su PVP. La ayuda lo
 * dice antes de escribir el nombre, que es cuando sirve.
 *
 * **NACE SIN SUCURSALES**: si se vende y a cuánto se decide en cada una desde la
 * ficha, que es adonde lleva el alta. Un nombre repetido en la empresa es 409, y
 * el mensaje de la API va junto al botón.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { Marco } from '../../../../componentes/Marco';
import { CampoDeTexto } from '../../../../componentes/ui/Campo';
import { Formulario } from '../../../../componentes/ui/Formulario';
import { Selector } from '../../../../componentes/ui/Selector';
import { Volver } from '../../../../componentes/ui/Volver';
import { llamar } from '../../../../lib/api';
import { textoOpcional } from '../../../../lib/campos';
import { useEnvio } from '../../../../lib/useEnvio';
import { TEXTOS } from '../../../../textos/es';

const TIPOS = [
  { valor: 'SIMPLE', texto: TEXTOS.productos.tipos.SIMPLE },
  { valor: 'COMBO', texto: TEXTOS.productos.tipos.COMBO },
];

export default function NuevoProducto(): ReactNode {
  return (
    <Permitido permiso="product.write">
      <Marco
        titulo={TEXTOS.productoDeVenta.nuevo}
        ayuda={TEXTOS.productoDeVenta.nuevoAyuda}
        acciones={<Volver href="/productos" />}
      >
        <FormularioDeProducto />
      </Marco>
    </Permitido>
  );
}

function FormularioDeProducto(): ReactNode {
  const router = useRouter();
  const envio = useEnvio();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('SIMPLE');
  const [categoria, setCategoria] = useState('');
  const producto = TEXTOS.productoDeVenta;

  async function guardar(): Promise<void> {
    const cuerpo = { nombre: nombre.trim(), tipo, categoria: textoOpcional(categoria) };
    const creado = { id: '' };
    const salio = await envio.enviar(async () => {
      creado.id = (await llamar<{ readonly id: string }>({ ruta: '/productos', metodo: 'POST', cuerpo })).id;
    });
    if (salio) router.push(`/productos/${creado.id}`);
  }

  return (
    <Formulario envio={envio} alEnviar={guardar} textoDelBoton={producto.crear} textoEnviando={producto.creando}>
      <CampoDeTexto etiqueta={producto.nombre} nombre="nombre" requerido valor={nombre} cambiar={setNombre} />
      <Selector etiqueta={producto.tipo} valor={tipo} opciones={TIPOS} cambiar={setTipo} />
      <p className="nota">{producto.tipoAyuda}</p>
      <CampoDeTexto etiqueta={producto.categoria} nombre="categoria" valor={categoria} cambiar={setCategoria} />
    </Formulario>
  );
}
