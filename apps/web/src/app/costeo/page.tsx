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

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/ui/Estados';
import { Marco } from '../../componentes/Marco';
import { Tabla } from '../../componentes/ui/Tabla';
import { llamar } from '../../lib/api';
import { comoImporte, comoPorcentaje, menorOIgual } from '../../lib/decimales';
import { useSucursal } from '../../lib/sesion';
import { TEXTOS } from '../../textos/es';

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

interface ProductoCosteado {
  readonly productId: string;
  readonly nombre: string;
  readonly categoria: string | null;
  readonly costos: {
    readonly costoBrutoLote: ImporteDto;
    readonly costoNetoLote: ImporteDto;
    readonly costoTotalUnidad: ImporteDto;
  };
  readonly venta: VentaDto | SinVentaDto;
  readonly itemsSinCosto: readonly string[];
}

interface CosteoDeCarta {
  readonly productos: readonly ProductoCosteado[];
}

/** Venta neta, margen, food cost y multiplicador: las cuatro que no salen. */
const COLUMNAS_DE_VENTA = 4;

/**
 * Los umbrales del semáforo son configuración POR COMPANY (D3) y hoy no viajan
 * en esta respuesta. Se usan los valores semilla como referencia visual, y
 * **solo para el color**: el número que decide es siempre el que manda la API.
 *
 * Es deuda anotada, no un descuido: el día que la API publique los umbrales de
 * la company, esto se sustituye por ellos y el color deja de ser aproximado.
 */
const UMBRAL_VERDE = '0.28';
const UMBRAL_MAXIMO = '0.32';

/**
 * El semáforo devuelve una CLASE, no un color.
 *
 * Los tres colores viven en `tokens.css` y salen del manual de marca: Jade para
 * lo que va bien, Persimmon Profundo para lo que pide atención y Oxblood para
 * la pérdida. Devolver aquí un `var(--color-…)` volvería a meter la capa visual
 * en el archivo que trae los datos, que es justo lo que P14 sacó de aquí.
 */
function claseDelFoodCost(pct: string): string {
  if (menorOIgual(pct, UMBRAL_VERDE)) return 'numero bien';
  if (menorOIgual(pct, UMBRAL_MAXIMO)) return 'numero atencion';
  return 'numero mal';
}

/** Una fila con food cost por encima del máximo lleva la señal al costado. */
function pideAtencion(pct: string): boolean {
  return !menorOIgual(pct, UMBRAL_MAXIMO);
}

export default function Costeo(): ReactNode {
  const { sucursal } = useSucursal();
  const [carta, setCarta] = useState<CosteoDeCarta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    if (sucursal === null) return;
    setError(null);
    setCarta(null);

    try {
      setCarta(await llamar<CosteoDeCarta>({ ruta: `/costeo?locationId=${sucursal}` }));
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : TEXTOS.comun.cargando);
    }
  }, [sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <Marco titulo={TEXTOS.costeo.titulo} ayuda={TEXTOS.costeo.ayuda}>
      {error !== null && (
        <Fallo
          mensaje={error}
          reintentar={() => {
            void cargar();
          }}
        />
      )}

      {error === null && carta === null && <Cargando />}

      {carta !== null && carta.productos.length === 0 && (
        <Vacio titulo={TEXTOS.costeo.vacio} ayuda={TEXTOS.costeo.vacioAyuda} />
      )}

      {carta !== null && carta.productos.length > 0 && <TablaDeCosteo productos={carta.productos} />}
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

function Fila({ producto }: { readonly producto: ProductoCosteado }): ReactNode {
  const { venta, costos } = producto;
  const senal = venta.vendible && pideAtencion(venta.foodCostPct);

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

      <td className="numero">{costos.costoBrutoLote.mostrar}</td>
      <td className="numero">{costos.costoNetoLote.mostrar}</td>
      <td className="numero">{costos.costoTotalUnidad.mostrar}</td>

      {venta.vendible ? (
        <>
          <td className="numero">{venta.ventaNeta.mostrar}</td>
          <td className="numero">{venta.margenContribucion.mostrar}</td>
          <td className={claseDelFoodCost(venta.foodCostPct)}>
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
    </tr>
  );
}
