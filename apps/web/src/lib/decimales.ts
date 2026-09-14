/**
 * Los decimales, mostrados COMO CADENA.
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
 * para enseñar, sobre el texto y sin pasar por `Number` ni `parseFloat` en ningún
 * punto — que es lo que la regla `no-restricted-syntax` de `eslint.config.mjs`
 * hace cumplir.
 *
 * **YA NO COMPARA.** Hasta P16-B tenía `menorOIgual`, que la pantalla de costeo
 * usaba para decidir el color del food cost contra los umbrales —y antes de eso
 * un `localeCompare` que pintaba un 40 % de verde (INC-020)—. Desde P16-B el
 * color lo decide la API (`semaforoFoodCost`, D-16.105), y comparar un número
 * contra un umbral en el navegador es exactamente la regla de negocio que
 * CLAUDE.md §8 saca del frontend. Si una pantalla vuelve a necesitar comparar,
 * lo que falta es un campo en la API, no una función aquí.
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

/**
 * `19.000000000000` a `19`, y `1.500000000000` a `1.5`: sin redondear.
 *
 * **ES LO QUE PRECARGA UNA CASILLA EDITABLE.** La API manda las unidades y las
 * cantidades a escala de almacenamiento, y hasta el armazón la rejilla de ventas
 * y la hoja de conteo las ponían tal cual en el campo: con la regla de «solo
 * dígitos» o «tres decimales», **una fila ya guardada no se podía editar** —ni
 * borrar un carácter—. Solo lo destapó capturar la pantalla con datos.
 *
 * No redondea, a diferencia de `comoImporte`: lo que sobra son ceros, y quitar
 * ceros de la derecha de la coma no cambia el número. Un entero sin coma se
 * devuelve igual: sus ceros sí cuentan.
 */
export function sinCerosDeSobra(valor: string): string {
  if (!valor.includes('.')) return valor;
  return valor.replace(/0+$/u, '').replace(/\.$/u, '');
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
