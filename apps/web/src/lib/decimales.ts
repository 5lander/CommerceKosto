/**
 * Los decimales, mostrados y comparados COMO CADENA.
 *
 * ============================================================================
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ============================================================================
 *
 * La API manda las proporciones con su escala exacta **a propósito**, y lo dice
 * en `costing/infrastructure/http/presentacion.ts`:
 *
 *   «Un food cost de 0.3601277778 mostrado como 0.36 pierde la información con
 *    la que se compara contra los umbrales. Quien la muestre decide cuántos
 *    decimales pinta; quien la calcula no puede decidirlo por él.»
 *
 * Este archivo es ese «quien la muestre». No calcula nada de negocio: redondea
 * para enseñar y compara contra un umbral, las dos cosas sobre el texto y sin
 * pasar por `Number` ni `parseFloat` en ningún punto — que es lo que la regla
 * `no-restricted-syntax` de `eslint.config.mjs` hace cumplir.
 *
 * Está en `lib/` y no dentro de una pantalla porque lo usan dos, y `jscpd` falla
 * ante cualquier clon. Pero el motivo de fondo es mejor: **las reglas de cómo se
 * enseña un número se auditan de una vez si viven en un sitio.**
 */

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

/** Los ceros de la izquierda sobran, salvo el único que precede a la coma. */
const CEROS_A_LA_IZQUIERDA = /^0+(?=\d)/u;

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

/**
 * Redondea un decimal escrito como cadena, **medio hacia arriba**.
 *
 * Medio hacia arriba es el `ROUND()` de Excel y el que usa el resto del
 * proyecto (`shared/domain/money`). Y se redondea, **no se trunca**: truncar
 * parece inofensivo y no lo es. El umbral verde del food cost está en 28 %, y
 * un `0.2799` truncado sale «27,9 %» y se pinta de verde cuando el número real
 * redondea a 28,0 %. Un color equivocado en el borde exacto del umbral es la
 * clase de número plausible y falso que este sistema existe para evitar.
 */
export function redondear(valor: string, decimales: number): string {
  const [entera = '0', decimal = ''] = valor.split('.');

  // Se pide un dígito de más: el que decide el redondeo.
  const necesarios = entera.length + decimales;
  const digitos = `${entera}${decimal}`.padEnd(necesarios + 1, '0');

  const truncado = digitos.slice(0, necesarios);
  const conAcarreo =
    digitos.slice(necesarios, necesarios + 1) >= MITAD ? sumarUno(truncado) : truncado;

  const corte = conAcarreo.length - decimales;
  const parteEntera = conAcarreo.slice(0, corte).replace(CEROS_A_LA_IZQUIERDA, '');

  return decimales === 0 ? parteEntera : `${parteEntera}.${conAcarreo.slice(corte)}`;
}

/** Cuántos decimales se enseñan de un importe o de un ratio. */
const DECIMALES_VISIBLES = 2;

/**
 * `2783.2768695647808` a `2783.28`.
 *
 * La API manda la escala de almacenamiento —doce decimales— porque es la que
 * permite sumar sin acumular error. Enseñarla tal cual no está mal, está **sin
 * terminar**: delante de un cliente, un número así se lee como que el sistema
 * no lo está.
 */
export function comoImporte(valor: string): string {
  return redondear(valor, DECIMALES_VISIBLES);
}

/** Un decimal se muestra con un decimal de porcentaje. */
const DECIMALES_DE_PORCENTAJE = 1;

/** Mover la coma dos posiciones es multiplicar por cien, sin aritmética. */
const POSICIONES_DEL_PORCENTAJE = 2;

/** Mueve la coma a la derecha sobre la CADENA. Multiplicar sin multiplicar. */
function moverComa(valor: string, posiciones: number): string {
  const [entera = '0', decimal = ''] = valor.split('.');
  const digitos = entera + decimal.padEnd(posiciones, '0');

  const corte = entera.length + posiciones;
  const nuevaEntera = digitos.slice(0, corte).replace(CEROS_A_LA_IZQUIERDA, '');
  const nuevaDecimal = digitos.slice(corte);

  return nuevaDecimal === '' ? nuevaEntera : `${nuevaEntera}.${nuevaDecimal}`;
}

/**
 * `0.2359` a `23,6 %`.
 *
 * **NO SE MULTIPLICA POR 100 NI SE USA `toFixed`.** Las dos cosas son
 * aritmética de punto flotante sobre un decimal exacto, que es lo que este
 * proyecto no hace en ningún sitio (CLAUDE.md §3). Se redondea primero a un
 * decimal más de los que hacen falta y luego se corre la coma.
 *
 * La coma decimal es la de es-EC (D11), no el punto.
 */
export function comoPorcentaje(fraccion: string): string {
  const redondeado = redondear(fraccion, POSICIONES_DEL_PORCENTAJE + DECIMALES_DE_PORCENTAJE);

  return `${moverComa(redondeado, POSICIONES_DEL_PORCENTAJE).replace('.', ',')} %`;
}

/**
 * Compara dos decimales EXACTOS sin convertirlos a punto flotante.
 *
 * ============================================================================
 * NO USA `localeCompare` CON `numeric: true`. LO USABA, Y MENTÍA.
 * ============================================================================
 *
 * `Intl.Collator` con `numeric: true` no compara decimales: compara **tramos de
 * dígitos**. `"0.1673"` se parte en `0`, `.`, `1673` y `"0.28"` en `0`, `.`,
 * `28`; empatan el `0` y el punto, y entonces compara **1673 contra 28**. Por
 * eso decía que `0,1673` es mayor que `0,32`.
 *
 * En pantalla eran las dos mentiras a la vez:
 *
 *   - un food cost del **16,7 % pintado de Oxblood**, el color de la pérdida, y
 *     con la señal de atención al costado;
 *   - y al revés, `0.4 <= 0.32` daba **true**: un food cost del **40 % en
 *     verde**. Esa es la peligrosa, porque no se va a mirar dos veces.
 *
 * Lo destapó levantar la pila de producción y mirar la pantalla con datos
 * reales. Ninguna revisión de código lo vio: la línea llevaba `numeric: true` y
 * un comentario diciendo que evitaba el punto flotante. Lo evitaba; lo que
 * hacía en su lugar estaba mal.
 *
 * ============================================================================
 * CÓMO SE COMPARA DE VERDAD
 * ============================================================================
 *
 * Parte entera alineada por la izquierda y parte decimal alineada por la
 * derecha, las dos rellenadas a la misma longitud y comparadas como texto. Con
 * la misma longitud, el orden alfabético de los dígitos ES el orden numérico.
 *
 * **Solo vale para decimales NO NEGATIVOS**, que es lo que hay aquí: un food
 * cost y un umbral. Con signo habría que tratarlo aparte, y no hay ningún caso.
 */
export function menorOIgual(izquierda: string, derecha: string): boolean {
  const [enteraI = '0', decimalI = ''] = izquierda.split('.');
  const [enteraD = '0', decimalD = ''] = derecha.split('.');

  const largoEntero = Math.max(enteraI.length, enteraD.length);
  const largoDecimal = Math.max(decimalI.length, decimalD.length);

  const i = enteraI.padStart(largoEntero, '0') + decimalI.padEnd(largoDecimal, '0');
  const d = enteraD.padStart(largoEntero, '0') + decimalD.padEnd(largoDecimal, '0');

  return i <= d;
}
