/**
 * De la cabecera del archivo a las columnas que el importador entiende.
 *
 * ES LA PRIMERA COSA QUE FALLA EN UNA IMPORTACIÓN REAL, y casi nunca por culpa
 * del usuario: escribió «Unidad de uso» donde se esperaba «unidad_de_uso», o
 * dejó un espacio detrás, o Excel le metió un BOM delante. Rechazar el archivo
 * entero por eso es hacerle perder media hora buscando un carácter invisible.
 *
 * Así que la cabecera se compara **normalizada** —sin tildes, sin mayúsculas,
 * sin espacios ni guiones bajos de más— y cada columna acepta varios nombres.
 * Lo que **no** se hace es adivinar por posición: un archivo con las columnas
 * cambiadas de orden se lee bien, y uno al que le falta una columna obligatoria
 * se rechaza **diciendo cuál**, no con un «formato inválido».
 *
 * ES DOMINIO PURO. Entra la fila de cabeceras, sale un mapa de clave a índice.
 */

import { normalizar } from './similitud';

export interface Columna {
  /** Cómo la llama el importador por dentro. */
  readonly clave: string;
  /** Los nombres que se aceptan en el archivo. El primero es el canónico. */
  readonly alias: readonly string[];
  readonly obligatoria: boolean;
}

export interface Cabecera {
  /** Clave de columna → índice en la fila. */
  readonly indices: ReadonlyMap<string, number>;
  /** Las obligatorias que no aparecieron, por su nombre canónico. */
  readonly faltantes: readonly string[];
  /** Columnas del archivo que el importador no conoce. No son un error. */
  readonly ignoradas: readonly string[];
}

/**
 * Compara sin tildes, sin mayúsculas y sin separadores.
 *
 * `unidad_de_uso`, `Unidad de Uso` y `UNIDAD-DE-USO` acaban en `unidaddeuso`,
 * que es lo que hace que las tres funcionen sin una tabla de excepciones.
 */
function clavear(encabezado: string): string {
  return normalizar(encabezado).replaceAll(/[^\p{L}\p{N}]/gu, '');
}

export function leerCabecera(
  fila: readonly string[],
  columnas: readonly Columna[],
): Cabecera {
  const porNombre = new Map<string, number>();
  fila.forEach((encabezado, indice) => {
    const clave = clavear(encabezado);
    // El PRIMERO gana si hay dos columnas con el mismo nombre. Es arbitrario y
    // da igual cuál se elija; lo que no da igual es que sea determinista.
    if (clave !== '' && !porNombre.has(clave)) porNombre.set(clave, indice);
  });

  const indices = new Map<string, number>();
  const faltantes: string[] = [];
  const reconocidas = new Set<number>();

  for (const columna of columnas) {
    const indice = columna.alias.map(clavear).map((a) => porNombre.get(a)).find((i) => i !== undefined);

    if (indice === undefined) {
      if (columna.obligatoria) faltantes.push(columna.alias[0] ?? columna.clave);
      continue;
    }

    indices.set(columna.clave, indice);
    reconocidas.add(indice);
  }

  return {
    indices,
    faltantes,
    // Se DEVUELVEN, no se callan: una columna que el usuario creía que se
    // estaba importando y no se importaba es una sorpresa cara. La
    // previsualización las enseña.
    ignoradas: fila.filter((_, i) => !reconocidas.has(i) && clavear(fila[i] ?? '') !== ''),
  };
}

/** El valor de una columna en una fila, ya recortado. `''` si no está. */
export function celda(
  fila: readonly string[],
  cabecera: Cabecera,
  clave: string,
): string {
  const indice = cabecera.indices.get(clave);
  return indice === undefined ? '' : (fila[indice] ?? '').trim();
}
