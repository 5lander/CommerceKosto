/**
 * Adaptador falso de almacenamiento — CLAUDE.md §12, `STORAGE_ADAPTER=fake`.
 *
 * Los bytes se COPIAN al guardar y al leer. Un falso que devuelve el mismo
 * `Uint8Array` que recibio deja que quien lo llamo mute lo "almacenado" desde
 * fuera, y entonces la prueba pasa por una razon que en produccion no existe.
 */

import { Injectable } from '@nestjs/common';

import type { FileStoragePort, StoredFile } from '../../application/ports/file-storage.port';
import { Simulation } from './simulation';

@Injectable()
export class FakeFileStorage implements FileStoragePort {
  public readonly simulation = new Simulation('file-storage');
  private readonly archivos = new Map<string, StoredFile>();

  public async put(file: StoredFile): Promise<string> {
    await this.simulation.settle();
    this.archivos.set(file.key, { ...file, bytes: Uint8Array.from(file.bytes) });
    return file.key;
  }

  public async get(key: string): Promise<StoredFile | null> {
    await this.simulation.settle();
    const encontrado = this.archivos.get(key);
    return encontrado === undefined ? null : { ...encontrado, bytes: Uint8Array.from(encontrado.bytes) };
  }
}
