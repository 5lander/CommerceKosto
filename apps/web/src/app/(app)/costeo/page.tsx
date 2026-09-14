'use client';

/**
 * Pantalla 2 — costeo por producto.
 *
 * **NO CALCULA NI UN NÚMERO.** Costo, margen, food cost y multiplicador vienen
 * de `GET /costeo`, que los saca del motor de P5. Esta pantalla ordena filas y
 * pinta colores; si hiciera una división, habría dos sitios donde vive la misma
 * fórmula y el día que difieran ninguno de los dos sería de fiar.
 *
 * **LOS IMPORTES SE MUESTRAN CON `mostrar`, NO CON `exacto`.** La API manda los
 * dos: `mostrar` es el `ROUND(x, 2)` del SPEC, y `exacto` la escala nativa para
 * sumar sin acumular error. Aquí no se suma nada, así que se enseña `mostrar` —
 * y ninguno de los dos se convierte a número.
 *
 * **LOS NÚMEROS SE REDONDEAN Y SE COMPARAN EN `lib/decimales`**, sobre la
 * cadena y sin pasar por `Number`. Ahí está contado por qué el comparador que
 * había —`localeCompare` con `numeric: true`— pintaba un food cost del 16,7 %
 * con el color de la pérdida y uno del 40 % de verde.
 */

import type { ReactNode } from 'react';

import { Marco } from '../../../componentes/Marco';
import { Tabla } from '../../../componentes/ui/Tabla';
import { Vista } from '../../../componentes/ui/Vista';
import { comoImporte, comoPorcentaje } from '../../../lib/decimales';
import { useSucursal } from '../../../lib/sesion';
import { useLectura } from '../../../lib/useLectura';
import { TEXTOS } from '../../../textos/es';

interface ImporteDto {
  readonly mostrar: string;
  readonly exacto: string;
}

interface VentaDto {
  readonly vendible: true;
  readonly ventaNeta: ImporteDto;
  readonly margenContribucion: ImporteDto;
  readonly mcPct: string;
  readonly foodCostPct: string;
  readonly multiplicador: string | null;
}

interface SinVentaDto {
  readonly vendible: false;
  readonly motivo: string;
}

/** El color lo decide la API con los umbrales de la company (D-16.105). */
type Semaforo = 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';

interface ProductoCosteado {
  readonly productId: string;
  readonly semaforoFoodCost: Semaforo;
  readonly nombre: string;
  readonly categoria: string | null;
  readonly costos: {
    readonly costoBrutoLote: ImporteDto;
    readonly costoNetoLote: ImporteDto;
    readonly costoTotalUnidad: ImporteDto;
  };
  readonly venta: VentaDto | SinVentaDto;
  readonly itemsSinCosto: readonly string[];
  /** Sin receta en esta sucursal: sus ceros no son un costo (P16-D, D-16.146). */
  readonly sinReceta: boolean;
}

interface CosteoDeCarta {
  readonly productos: readonly ProductoCosteado[];
}

/** Venta neta, margen, food cost y multiplicador: las cuatro que no salen. */
const COLUMNAS_DE_VENTA = 4;

/** Los tres costos y las cuatro de venta: todo lo que un plato sin receta no tiene. */
const COLUMNAS_NUMERICAS = 7;

/**
 * El semáforo devuelve una CLASE, no un color, y ya no decide nada.
 *
 * **HASTA P16-B ESTA PANTALLA COMPARABA EL FOOD COST CONTRA DOS UMBRALES**
 * escritos aquí —las semillas `0.28` y `0.32`— y es INC-020: con `localeCompare`
 * pintó un 40 % de verde. Después del arreglo seguía siendo una regla de negocio
 * en el navegador, con los umbrales de la semilla en vez de los de la company.
 * Desde P16-B la API manda `semaforoFoodCost` (D-16.105) y esto solo traduce la
 * etiqueta a la clase de `global.css`.
 *
 * Los tres colores viven en `tokens.css` y salen del manual de marca: Jade para
 * lo que va bien, Persimmon Profundo para lo que pide atención y Oxblood para
 * la pérdida.
 */
const CLASE_DEL_SEMAFORO: Readonly<Record<Semaforo, string>> = {
  VERDE: 'numero bien',
  AMBAR: 'numero atencion',
  ROJO: 'numero mal',
  SIN_DATO: 'numero',
};

export default function Costeo(): ReactNode {
  const { sucursal } = useSucursal();
  const lectura = useLectura<CosteoDeCarta>(sucursal === null ? null : `/costeo?locationId=${sucursal}`);

  return (
    <Marco titulo={TEXTOS.costeo.titulo} ayuda={TEXTOS.costeo.ayuda}>
      <Vista
        lectura={lectura}
        vacio={{
          esVacio: (carta) => carta.productos.length === 0,
          titulo: TEXTOS.costeo.vacio,
          ayuda: TEXTOS.costeo.vacioAyuda,
        }}
      >
        {(carta) => <TablaDeCosteo productos={carta.productos} />}
      </Vista>
    </Marco>
  );
}

function TablaDeCosteo({ productos }: { readonly productos: readonly ProductoCosteado[] }): ReactNode {
  return (
    <div className="pila">
      <Tabla compacta>
        <thead>
          <tr>
            <th>{TEXTOS.costeo.producto}</th>
            <th>{TEXTOS.costeo.costoBruto}</th>
            <th>{TEXTOS.costeo.costoNeto}</th>
            <th>{TEXTOS.costeo.costoTotal}</th>
            <th>{TEXTOS.costeo.ventaNeta}</th>
            <th>{TEXTOS.costeo.margen}</th>
            <th>{TEXTOS.costeo.foodCost}</th>
            <th>{TEXTOS.costeo.multiplicador}</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((producto) => (
            <Fila key={producto.productId} producto={producto} />
          ))}
        </tbody>
      </Tabla>

      <p className="nota">{TEXTOS.costeo.notaIva}</p>
    </div>
  );
}

function Fila({ producto }: { readonly producto: ProductoCosteado }): ReactNode {  // Una fila por encima del máximo lleva la señal al costado.
  const senal = producto.semaforoFoodCost === 'ROJO';

  return (
    <tr data-senal={senal ? 'true' : undefined}>
      <td>
        {producto.nombre}
        {producto.categoria !== null && <span className="bloque tenue">{producto.categoria}</span>}
        {producto.itemsSinCosto.length > 0 && (
          <span className="bloque tenue atencion">
            {TEXTOS.costeo.sinPrecio} {producto.itemsSinCosto.join(', ')}
          </span>
        )}
      </td>

      {producto.sinReceta ? (
        // Sin receta, los ceros de la API son aritmética sobre nada: enseñarlos
        // como «0.00» y un food cost del 0 % era el número plausible y falso
        // que la duda #12 cerró. Se dice lo que falta, en la fila entera.
        <td colSpan={COLUMNAS_NUMERICAS} className="tenue atencion">
          {TEXTOS.costeo.sinReceta}
        </td>
      ) : (
        <CeldasDeCosto producto={producto} />
      )}
    </tr>
  );
}

function CeldasDeCosto({ producto }: { readonly producto: ProductoCosteado }): ReactNode {
  const { venta, costos } = producto;

  return (
    <>
      <td className="numero">{costos.costoBrutoLote.mostrar}</td>
      <td className="numero">{costos.costoNetoLote.mostrar}</td>
      <td className="numero">{costos.costoTotalUnidad.mostrar}</td>

      {venta.vendible ? (
        <>
          <td className="numero">{venta.ventaNeta.mostrar}</td>
          <td className="numero">{venta.margenContribucion.mostrar}</td>
          <td className={CLASE_DEL_SEMAFORO[producto.semaforoFoodCost]}>
            {comoPorcentaje(venta.foodCostPct)}
          </td>
          <td className="numero">
            {venta.multiplicador === null ? TEXTOS.comun.sinDato : comoImporte(venta.multiplicador)}
          </td>
        </>
      ) : (
        <td colSpan={COLUMNAS_DE_VENTA} className="tenue">
          {venta.motivo}
        </td>
      )}
    </>
  );
}
