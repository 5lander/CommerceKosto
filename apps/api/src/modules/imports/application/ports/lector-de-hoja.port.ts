/**
 * Leer un archivo subido y devolver sus filas como texto.
 *
 * **ES UN PUERTO PORQUE LA IMPLEMENTACIÓN LANZA UN PROCESO**, y un caso de uso
 * no puede saber eso. Detrás vive `leerEnHijo`, que hace `fork` de un parser
 * aislado, sin variables de entorno, con plazo y con techo de memoria (ADR-013).
 * Delante, quien lo usa solo ve «bytes entran, filas salen».
 *
 * **TODO SALE COMO `string`, SIEMPRE.** Devolver `number` metería
 * `2.0999999999999996` en el sistema antes de que `Money` y `Ratio` puedan
 * defenderse, y el punto flotante para dinero está prohibido (CLAUDE.md §3).
 */

export const LECTOR_DE_HOJA = 'LECTOR_DE_HOJA';

export interface LectorDeHoja {
  /** @throws {ArchivoIlegibleError} · {@link AnalisisAgotadoError} */
  leer(bytes: Uint8Array): Promise<readonly (readonly string[])[]>;
}
