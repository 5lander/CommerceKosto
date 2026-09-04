/**
 * Escalas decimales del proyecto.
 *
 * `Escala` es un tipo marcado: no se puede pasar un `number` suelto donde se
 * espera una escala. Evita el error de escribir `dividedBy(x, 2)` cuando se
 * queria `DIVISION`, que produce un resultado plausible y equivocado.
 */

declare const MARCA_ESCALA: unique symbol;

export type Escala = number & { readonly [MARCA_ESCALA]: 'escala' };

/** @internal Solo para construir las constantes de abajo. */
function escala(valor: number): Escala {
  return valor as Escala;
}

/**
 * Presentacion y captura: el `ROUND(x, 2)` de las formulas del SPEC y todo lo
 * que sale hacia un DTO o entra tecleado por un usuario.
 */
export const PRESENTACION: Escala = escala(2);

/**
 * Persistencia: `numeric(24,12)` en PostgreSQL. `audit:migrations` M8 verifica
 * que ninguna columna decimal se aparte de este contrato.
 */
export const ALMACENAMIENTO: Escala = escala(12);

/**
 * Toda division del motor de costeo.
 *
 * Por que 12. Las formulas del SPEC §12 y §14 dividen por `(1 + iva)`, por
 * `factor_conversion` y por `rendimiento`: decimales periodicos, y la unica
 * fuente de error de todo el sistema (`+`, `-` y `x` son exactos).
 *
 * Cota del residuo de la conciliacion R7 con escala S:
 *   error por division           <= 0.5 x 10^-S
 *   amplificacion conservadora   ~ 10^9  (30 lineas x 10.000 unidades/mes
 *                                         x 100 USD/unidad x 300 items)
 *   residuo                      <= 0.5 x 10^(9-S)
 * `ROUND(x, 2) = 0` exige |x| < 0.005, es decir S >= 11.
 *
 * Se toma 12: un orden de magnitud de margen sobre la cota conservadora, y con
 * aritmetica decimal el coste de ese digito extra es nulo.
 *
 * Y el margen no se da por bueno: la prueba de R7 comprueba tambien un canario
 * (|diferencia| <= 1e-6) que se rompe cinco ordenes de magnitud ANTES que el
 * contrato, en el commit que introduce la deriva y no seis meses despues.
 */
export const DIVISION: Escala = escala(12);

/**
 * Techo duro. Multiplicar suma escalas (0.065 x 8.13 da escala 5), asi que una
 * cadena larga de multiplicaciones podria crecer sin limite. Superarlo lanza en
 * vez de redondear en silencio.
 */
export const MAXIMA: Escala = escala(30);

/**
 * Construye una escala arbitraria. Uso restringido: casi todo el codigo debe
 * usar una de las constantes de arriba, que son las que estan justificadas.
 */
export function escalaDe(valor: number): Escala {
  if (!Number.isInteger(valor) || valor < 0 || valor > MAXIMA) {
    throw new RangeError(`Escala invalida: ${String(valor)}. Debe ser un entero entre 0 y ${String(MAXIMA)}.`);
  }
  return escala(valor);
}
