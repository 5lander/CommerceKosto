/**
 * Errores de `imports`. Todos son de dominio: no saben de HTTP.
 *
 * **LO QUE SE LE DICE A QUIEN SUBIÓ UN ARCHIVO ES DELIBERADAMENTE POCO.** Un
 * archivo es entrada hostil (CLAUDE.md §4.6): decir «detecté un ZIP cifrado» o
 * «el plazo se agotó a los 15 segundos» convierte al importador en un detector
 * de formatos y en un cronómetro que cualquiera puede consultar desde fuera. El
 * detalle para diagnosticar va al log; aquí va lo accionable.
 *
 * **LOS PROBLEMAS DE UNA FILA NO SON ERRORES.** Viajan dentro del `Analisis`,
 * porque un archivo con cuarenta filas malas no es un fallo: es un archivo del
 * que se pueden importar las buenas y arreglar el resto. Solo lo que impide
 * analizar —o escribir— llega hasta aquí.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/** El archivo no se pudo leer, o lo leído no se puede escribir. */
export class ArchivoIlegibleError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

export class ArchivoDemasiadoGrandeError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(limiteMb: number) {
    super(`El archivo supera el máximo de ${String(limiteMb)} MB.`);
  }
}

export class DemasiadasFilasError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(limite: number) {
    super(`El archivo trae más de ${String(limite)} filas. Divídelo en varios.`);
  }
}

/** No existe, o es de otra company: el mismo 404 para los dos (CLAUDE.md §4.4). */
export class ImportacionNoEncontradaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('No se encontró esa importación.');
  }
}

/**
 * Se pide deshacer algo que no se puede deshacer — D-16.200.
 *
 * **EL MENSAJE DICE EL ESTADO, Y ESO ES SEGURO**: quien pregunta ya ha probado
 * que la importación es de su company, porque si no lo fuera habría recibido el
 * 404 de arriba. Sin el estado, el usuario no sabe si insistir o no.
 */
export class ImportacionNoAnulableError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(motivo: string) {
    super(`Esta importación no se puede anular: ${motivo}`);
  }
}

/**
 * El proceso hijo se pasó del plazo y se le mató.
 *
 * No dice cuánto tardó ni qué estaba haciendo: un archivo hostil no debe poder
 * medir el plazo desde fuera. Para quien lo subió, el mensaje útil es el mismo
 * en los dos casos: es demasiado grande o está mal formado.
 */
export class AnalisisAgotadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('El archivo tardó demasiado en procesarse. Puede ser demasiado grande o estar dañado.');
  }
}
