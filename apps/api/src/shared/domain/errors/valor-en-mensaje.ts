/**
 * Cómo se cita el valor que el usuario escribió dentro de un mensaje de error.
 *
 * **NACE CON P16-A2, CUANDO TRES ERRORES DE BORDE PASARON DE 500 A 400.** Hasta
 * entonces esos mensajes no salían del servidor: el filtro los convertía en el
 * texto genérico de los 5xx, así que daba igual lo que llevaran dentro. Al
 * pasar a 400 el mensaje **sale tal cual al cliente** (`ErrorDeDominio`), y lo
 * que lleva dentro es una cadena que escribió quien está llamando.
 *
 * Lo que hace, y por qué cada cosa:
 *
 * - **Recorta.** Un `@Param` o un `?parametro=` pueden traer kilobytes. Sin
 *   recorte, el cuerpo del 400 sería el eco de la petición: ruido en el log de
 *   errores y un amplificador gratis para quien esté sondeando.
 * - **Quita los caracteres de control.** `EsquemaPipe` ya los rechaza en el
 *   cuerpo y en la consulta, pero los parámetros de ruta **no pasan por él**.
 *   Un salto de línea dentro de un mensaje que acaba en una línea de log parte
 *   esa línea en dos, y la segunda la escribe el atacante.
 *
 * Lo que NO hace: escapar para HTML. Esta API responde `application/json` y
 * nada más; escapar aquí sería adivinar el medio de quien consume.
 *
 * **Se filtra por código y no con una expresión regular** porque un rango de
 * control escrito dentro de un literal de expresion regular es exactamente lo que la
 * regla `no-control-regex` prohíbe, y con razón: en una regex esos caracteres
 * se leen mal y se copian peor.
 */

/** Suficiente para reconocer lo que se escribió; corto para no ser un eco. */
const LARGO_MAXIMO = 60;
/** Espacio. Por debajo están los 32 caracteres de control de ASCII. */
const PRIMER_VISIBLE = 0x20;
/** `DEL`, el control que se quedó fuera del bloque de abajo. */
const BORRADO = 0x7f;
const RECORTE = '…';

function esVisible(caracter: string): boolean {
  const codigo = caracter.codePointAt(0) ?? 0;
  return codigo >= PRIMER_VISIBLE && codigo !== BORRADO;
}

function sinControles(valor: string): string {
  let limpio = '';
  for (const caracter of valor) {
    if (esVisible(caracter)) limpio += caracter;
  }
  return limpio;
}

export function valorParaMensaje(valor: string): string {
  const limpio = sinControles(valor);
  return limpio.length <= LARGO_MAXIMO ? limpio : `${limpio.slice(0, LARGO_MAXIMO)}${RECORTE}`;
}
