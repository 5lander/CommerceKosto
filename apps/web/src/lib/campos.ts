/**
 * Lo que un campo de formulario manda a la API.
 *
 * **UN TEXTO OPCIONAL VACÍO VIAJA COMO `null`**, no como cadena vacía: la API
 * distingue «sin marca» de «marca: ''», y los esquemas `.nullable()` esperan lo
 * primero (riesgo «`.nullable()` sin `.optional()`» del plan de P16).
 */
export function textoOpcional(texto: string): string | null {
  const limpio = texto.trim();
  return limpio === '' ? null : limpio;
}
