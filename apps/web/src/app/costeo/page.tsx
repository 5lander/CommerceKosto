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
 * El semáforo compara `foodCostPct` **como cadena**, con `localeCompare`
 * numérico: los dos lados son decimales exactos con la misma escala, así que la
 * comparación es fiable sin pasar por punto flotante.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Cargando, Error as Fallo, Vacio } from '../../componentes/ui/Estados';
import { Marco } from '../../componentes/Marco';
import { Tabla } from '../../componentes/ui/Tabla';
import { llamar } from '../../lib/api';
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

/**
 * Los umbrales del semáforo son configuración POR COMPANY (D3) y hoy no viajan
 * en esta respuesta. Se usan los valores semilla como referencia visual, y
 * **solo para el color**: el número que decide es siempre el que manda la API.
 *
 * Es deuda anotada, no un descuido: el día que la API publique los umbrales de
 * la company, esto se sustituye por ellos y el color deja de ser aproximado.
 */
/** Venta neta, margen, food cost y multiplicador: las cuatro que no salen. */
const COLUMNAS_DE_VENTA = 4;

const UMBRAL_VERDE = '0.28';
const UMBRAL_MAXIMO = '0.32';

/** Compara dos decimales EXACTOS sin convertirlos a punto flotante. */
function menorOIgual(izquierda: string, derecha: string): boolean {
  return izquierda.localeCompare(derecha, undefined, { numeric: true }) <= 0;
}

/**
 * El semaforo devuelve una CLASE, no un color.
 *
 * Los tres colores viven en `tokens.css` y salen del manual de marca: Jade para
 * lo que va bien, Persimmon Profundo para lo que pide atencion y Oxblood para la
 * perdida. Devolver aqui un `var(--color-…)` volveria a meter la capa visual en
 * el archivo que trae los datos, que es justo lo que P14 saca de aqui.
 */
function claseDelFoodCost(pct: string): string {
  if (menorOIgual(pct, UMBRAL_VERDE)) return 'numero bien';
  if (menorOIgual(pct, UMBRAL_MAXIMO)) return 'numero atencion';
  return 'numero mal';
}

/** Una fila con food cost por encima del maximo lleva la senal al costado. */
function pideAtencion(pct: string): boolean {
  return !menorOIgual(pct, UMBRAL_MAXIMO);
}

/** Un decimal se muestra con un decimal de porcentaje. */
const DECIMALES_DE_PORCENTAJE = 1;

/** Mover la coma dos posiciones es multiplicar por cien, sin aritmetica. */
const POSICIONES_DEL_PORCENTAJE = 2;

/**
 * A partir de este dígito se redondea hacia arriba.
 *
 * Es un CARÁCTER y no un número: comparar `'7' >= '5'` da lo mismo que comparar
 * los enteros —los dígitos ordenan igual como texto que como cifra— y evita el
 * `Number()` que la regla `no-restricted-syntax` prohíbe en este directorio.
 */
const MITAD = '5';

/** El dígito siguiente a cada uno. El `9` acarrea, y por eso no está. */
const SIGUIENTE: Readonly<Record<string, string>> = {
  '0': '1',
  '1': '2',
  '2': '3',
  '3': '4',
  '4': '5',
  '5': '6',
  '6': '7',
  '7': '8',
  '8': '9',
};

/**
 * `0.2359` a `23,6 %`, moviendo la coma sobre la CADENA.
 *
 * **NO SE MULTIPLICA POR 100 NI SE USA `toFixed`.** Las dos cosas son aritmética
 * de punto flotante sobre un decimal exacto, que es lo que este proyecto no hace
 * en ningún sitio (CLAUDE.md §3).
 *
 * **Y SE REDONDEA, NO SE TRUNCA.** Truncar parece inofensivo y no lo es: el
 * umbral verde de food cost está en 28 %, y un `0.2799` truncado sale como
 * «27,9 %» y se pinta de verde cuando el número real redondea a 28,0 %. Un color
 * equivocado en el borde exacto del umbral es justo la clase de número plausible
 * y falso que este sistema existe para evitar. El redondeo es medio hacia
 * arriba, como el `ROUND()` de Excel y como el resto del proyecto.
 */
function comoPorcentaje(fraccion: string): string {
  const [entera = '0', decimal = ''] = fraccion.split('.');

  // Se pide un dígito de más: el que decide el redondeo.
  const necesarios = entera.length + POSICIONES_DEL_PORCENTAJE + DECIMALES_DE_PORCENTAJE;
  const digitos = `${entera}${decimal}`.padEnd(necesarios + 1, '0');

  const siguiente = digitos.slice(necesarios, necesarios + 1);
  const truncado = digitos.slice(0, necesarios);
  const redondeado = siguiente >= MITAD ? sumarUno(truncado) : truncado;

  const corte = redondeado.length - DECIMALES_DE_PORCENTAJE;
  const enteroPct = redondeado.slice(0, corte).replace(/^0+(?=\d)/u, '');

  return `${enteroPct},${redondeado.slice(corte)} %`;
}

/**
 * Suma uno a un número escrito como cadena de dígitos, con acarreo.
 *
 * **NO PASA POR `Number` EN NINGÚN PUNTO.** `0.9999` como porcentaje son cuatro
 * acarreos encadenados, y hacerlos en punto flotante sobre una cifra que decide
 * el color de un food cost es exactamente lo que este proyecto no hace. Un
 * dígito que no está en `SIGUIENTE` es un `9`: se pone a cero y se acarrea.
 */
function sumarUno(digitos: string): string {
  const cifras = Array.from(digitos);

  for (let i = cifras.length - 1; i >= 0; i -= 1) {
    const siguiente = SIGUIENTE[cifras[i] ?? ''];

    if (siguiente !== undefined) {
      cifras[i] = siguiente;
      return cifras.join('');
    }
    cifras[i] = '0';
  }

  // Todos eran nueves: el número creció una posición.
  return `1${cifras.join('')}`;
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
          <td className="numero">{venta.multiplicador ?? TEXTOS.comun.sinDato}</td>
        </>
      ) : (
        <td colSpan={COLUMNAS_DE_VENTA} className="tenue">
          {venta.motivo}
        </td>
      )}
    </tr>
  );
}
