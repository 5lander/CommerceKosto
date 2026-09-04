/**
 * Puerto de almacenamiento de archivos — CLAUDE.md §12.
 *
 * Su consumidor real es P10 (importacion de Excel/CSV): el archivo subido se
 * guarda antes de parsearse, para poder reproducir un fallo de importacion con
 * el archivo exacto que lo causo.
 *
 * Mismo motivo que el puerto de correo para existir ya en P0: sin el, "levanta
 * sin credenciales reales" no es verificable.
 */

export const FILE_STORAGE_PORT = 'FILE_STORAGE_PORT';

export interface StoredFile {
  readonly key: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface FileStoragePort {
  /** @returns la clave con la que recuperarlo. */
  put(file: StoredFile): Promise<string>;
  get(key: string): Promise<StoredFile | null>;
}
