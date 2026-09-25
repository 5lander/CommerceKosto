'use client';

/**
 * Pantalla 18 — registrar una compra, una merma o un ajuste.
 *
 * **PIDE `inventory.write`, Y ESTA ES LA PANTALLA DE `BODEGA`.** Tiene
 * `inventory.write` y **no** `inventory.read` (§4.3), así que llega aquí y no al
 * libro. Por eso el aviso de «registrado» no la manda a ver la fila: le ofrece
 * registrar otra, y el enlace al libro solo aparece para quien puede leerlo.
 *
 * **NO SE QUEDA EN «SE GUARDÓ» Y YA.** Quien carga inventario carga muchos
 * seguidos, de pie en una bodega: tras guardar, el formulario se monta limpio
 * con una clave nueva y el foco vuelve arriba.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { Permitido } from '../../../../componentes/armazon/Permitido';
import { FormularioDeMovimiento, type DatosDelFormulario } from '../../../../componentes/inventario/FormularioDeMovimiento';
import type { InsumoDelLibro } from '../../../../componentes/inventario/libro';
import type { ArticuloDeCompra } from '../../../../componentes/inventario/movimiento-nuevo';
import { Marco } from '../../../../componentes/Marco';
import { Vista } from '../../../../componentes/ui/Vista';
import { Volver } from '../../../../componentes/ui/Volver';
import { llamar } from '../../../../lib/api';
import { usePermisos } from '../../../../lib/permisos';
import { useSucursal } from '../../../../lib/sesion';
import { useCarga, type Lectura } from '../../../../lib/useLectura';
import { TEXTOS } from '../../../../textos/es';

/**
 * **`leer` TIENE QUE SER ESTABLE** (`useLectura.ts`): con una función nueva en
 * cada render, `useCarga` la toma por una lectura distinta, vuelve a pedir, el
 * estado cambia, y la pantalla se queda en «Cargando…» para siempre. Pasó aquí,
 * y ni los tipos ni el linter lo ven: solo se ve abriendo la pantalla.
 */
function useCatalogo(): Lectura<DatosDelFormulario> {
  const leer = useCallback(async (): Promise<DatosDelFormulario> => {
    const [insumos, articulos] = await Promise.all([
      llamar<readonly InsumoDelLibro[]>({ ruta: '/catalogo/items' }),
      llamar<readonly ArticuloDeCompra[]>({ ruta: '/catalogo/articulos' }),
    ]);
    return { insumos, articulos };
  }, []);

  return useCarga(leer);
}

export default function MovimientoNuevo(): ReactNode {
  const { sucursal } = useSucursal();
  const lectura = useCatalogo();
  const [registrados, setRegistrados] = useState(0);
  const texto = TEXTOS.movimientoNuevo;

  return (
    <Permitido permiso="inventory.write">
      <Marco titulo={texto.titulo} ayuda={texto.ayuda} acciones={<Salida />}>
        <Vista lectura={lectura} vacio="nunca">
          {(datos) => (
            <div className="pila">
              {registrados > 0 && <p className="panel panel--relleno bien">{texto.hecho}</p>}
              {sucursal !== null && (
                <FormularioDeMovimiento
                  // Una clave por registro: el formulario vuelve a nacer limpio
                  // en vez de quedarse con lo anterior a medio borrar.
                  key={`movimiento-${sucursal}-${String(registrados)}`}
                  datos={datos}
                  sucursal={sucursal}
                  alRegistrar={() => {
                    setRegistrados(registrados + 1);
                  }}
                />
              )}
            </div>
          )}
        </Vista>
      </Marco>
    </Permitido>
  );
}

/** Al libro solo quien lo lee: `BODEGA` no tiene `inventory.read` y volvería a «sin acceso». */
function Salida(): ReactNode {
  const { tiene } = usePermisos();
  if (tiene('inventory.read')) return <Volver href="/movimientos" />;

  return (
    <Link href="/inicio" className="boton">
      {TEXTOS.comun.volverAlInicio}
    </Link>
  );
}
