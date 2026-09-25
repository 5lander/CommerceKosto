/**
 * Buscar por nombre en una lista ya leída — insumos, productos.
 *
 * **SIN TILDES NI MAYÚSCULAS**: «limon» encuentra «Limón sutil». En una cocina se
 * escribe rápido y en el teléfono, y una tilde que falta no puede esconder una
 * fila. Filtrar así no decide nada: la lista la sigue dando la API.
 */

function paraBuscar(texto: string): string {
  return texto.normalize('NFD').replaceAll(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Si `nombre` contiene lo `buscado`; lo buscado vacío lo encuentra todo. */
export function coincide(nombre: string, buscado: string): boolean {
  return paraBuscar(nombre).includes(paraBuscar(buscado.trim()));
}
