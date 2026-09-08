/**
 * El final de un binario que falla: el mensaje fuera, y codigo 1.
 *
 * **`process.exitCode` Y NO `process.exit()`.** `exit()` corta el proceso en el
 * acto, y una escritura a una tuberia todavia en vuelo se pierde: el fallo
 * aparenta ser un silencio. Con `exitCode`, Node vacia lo pendiente y termina
 * solo. Es exactamente el sintoma que costo media hora en P15 cuando el medidor
 * moria al arrancar sin imprimir una linea.
 *
 * **SOLO EL MENSAJE, NUNCA LA PILA.** Quien lanza uno de estos binarios a mano
 * necesita saber que hacer, no donde reventó; la pila va al log del proceso si
 * lo hay. Y en el back office importa mas: una pila cuenta rutas y nombres de
 * archivo de un servidor que ve todos los tenants.
 */

const SALIDA_CON_ERROR = 1;

export function morirCon(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = SALIDA_CON_ERROR;
}
