/**
 * Las fechas del frontend, en un solo sitio — D-16.4, INC-013.
 *
 * **EL MES POR DEFECTO ES EL DE ECUADOR, NO EL DE UTC.** Hasta el armazón, tres
 * pantallas lo calculaban con `getUTCMonth()`: a partir de las 19:00 del último
 * día del mes, en Guayaquil ya es el día 1 en UTC, y la rejilla de ventas se
 * abría en el mes siguiente. Es INC-013 —un instante UTC del día 1 que pertenece
 * al mes anterior— visto desde el navegador.
 *
 * **SIN `parseInt` NI `Number(...)`** (`no-number-en-frontend`). Un año y un mes
 * que llegan como texto —de la URL o de `Intl`— se validan por su forma y se
 * leen a través de una fecha **al mediodía UTC del día 15**, que cae en el mismo
 * mes en cualquier zona horaria del planeta: los números salen de los getters de
 * `Date`, no de parsear cadenas.
 */

export interface Mes {
  readonly anio: number;
  readonly mes: number;
}

/** La zona del negocio: la de los períodos contables (ADR-010). */
const ZONA_DEL_NEGOCIO = 'America/Guayaquil';

const DIGITOS_DE_ANIO = /^\d{4}$/u;
const DIGITOS_DE_MES = /^(?:0?[1-9]|1[0-2])$/u;
const ANCHO_DEL_MES = 2;

const FORMATO_DEL_MES = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_DEL_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
});

/**
 * El mes de un año y un mes escritos como texto, o `null` si no tienen forma de
 * año y mes. Nunca un mes «corregido»: `?mes=13` no es diciembre.
 */
export function mesDeTexto(anio: string | null, mes: string | null): Mes | null {
  if (anio === null || mes === null || !DIGITOS_DE_ANIO.test(anio) || !DIGITOS_DE_MES.test(mes)) return null;
  const mediodia = new Date(`${anio}-${mes.padStart(ANCHO_DEL_MES, '0')}-15T12:00:00Z`);
  return { anio: mediodia.getUTCFullYear(), mes: mediodia.getUTCMonth() + 1 };
}

/** El mes en curso en Ecuador. */
export function mesDeHoy(): Mes {
  const partes = FORMATO_DEL_MES.formatToParts(new Date());
  const anio = partes.find((parte) => parte.type === 'year')?.value ?? null;
  const mes = partes.find((parte) => parte.type === 'month')?.value ?? null;
  // `Intl` siempre da las dos partes; si no, el mes UTC es el mal menor.
  return mesDeTexto(anio, mes) ?? { anio: new Date().getUTCFullYear(), mes: new Date().getUTCMonth() + 1 };
}

/** El mes anterior, cruzando el año cuando toca. */
export function mesAnterior({ anio, mes }: Mes): Mes {
  const mediodia = new Date(`${String(anio)}-${String(mes).padStart(ANCHO_DEL_MES, '0')}-15T12:00:00Z`);
  mediodia.setUTCMonth(mediodia.getUTCMonth() - 1);
  return { anio: mediodia.getUTCFullYear(), mes: mediodia.getUTCMonth() + 1 };
}

/** El mes como lo pide la API y como vive en la URL: `anio=2026&mes=9`. */
export function consultaDelMes({ anio, mes }: Mes): string {
  return `anio=${String(anio)}&mes=${String(mes)}`;
}
