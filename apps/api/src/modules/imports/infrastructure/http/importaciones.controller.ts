/**
 * La única superficie HTTP de `imports`: deshacer una importación — D-16.200.
 *
 * **SUBIR SIGUE SIN SER UN ENDPOINT, Y ESO NO CAMBIA AQUÍ.** La importación se
 * opera desde la línea de comandos (`npm run importar`) hasta que exista su
 * pantalla (P20). Deshacer sí entra ya, y por una razón que no espera: el
 * comando puede escribir cientos de filas en el libro de un cliente en
 * producción, y hasta hoy la única forma de arreglarlo era corregirlas a mano,
 * una a una, sabiendo cuáles eran.
 *
 * **EXIGE `import.write`, EL MISMO PERMISO QUE ESCRIBIR.** Quien puede meter un
 * archivo entero en el libro puede sacarlo; pedir uno distinto obligaría a
 * llamar a otra persona para arreglar lo que uno acaba de romper. Lo tienen
 * `OWNER` y `ADMIN` — `BODEGA` no, que es lo que importa.
 */

import { Body, Controller, Param, Post } from '@nestjs/common';

import { importJobId as aImportJobId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { IdentificadorDeRuta } from '../../../../shared/infrastructure/http/identificador-de-ruta.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { AnularImportacion } from '../../application/casos-de-uso/anular';
import {
  CUERPO_DE_ANULACION,
  type AnulacionDto,
  type CuerpoDeAnulacion,
} from './importaciones.dto';

@Controller('importaciones')
export class ImportacionesController {
  public constructor(private readonly anulacion: AnularImportacion) {}

  /** R3 — deshacer es escribir las filas contrarias, nunca borrar las suyas. */
  @Post(':importJobId/anulacion')
  @Requiere('import.write')
  public async anular(
    @SesionActual() sesion: SesionActiva,
    @Param('importJobId', IdentificadorDeRuta) importJobId: string,
    @Body(new EsquemaPipe(CUERPO_DE_ANULACION)) cuerpo: CuerpoDeAnulacion,
  ): Promise<AnulacionDto> {
    const resultado = await this.anulacion.ejecutar(sesion, {
      importJobId: aImportJobId(importJobId),
      note: cuerpo.note,
    });

    return { id: resultado.id, estado: 'ANULADA', filasAnuladas: resultado.filasAnuladas };
  }
}
