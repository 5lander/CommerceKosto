/**
 * `CORREO_MINUTOS_DE_ALERTA`, leida a mano como `BACKOFFICE_PORT` en
 * `backoffice.ts`: el back office no tiene esquema de entorno —tres variables
 * no lo justifican— y la regla es la misma, un entero o un error que dice cual.
 */

const POR_DEFECTO = 15;
/** Un dia entero de `PENDIENTE` sin alertar ya no es un umbral, es apagar la alerta. */
const MAXIMO = 1_440;

const VARIABLE = 'CORREO_MINUTOS_DE_ALERTA';

/** @throws {Error} si la variable existe y no es un entero entre 1 y 1440. */
export function minutosDeAlertaDelEntorno(): number {
  const crudo = process.env[VARIABLE];
  if (crudo === undefined || crudo.trim() === '') return POR_DEFECTO;

  const valor = Number.parseInt(crudo, 10);
  if (!Number.isInteger(valor) || valor <= 0 || valor > MAXIMO) {
    throw new Error(`${VARIABLE} no es un numero de minutos valido: "${crudo}" (entero entre 1 y ${String(MAXIMO)}).`);
  }
  return valor;
}
