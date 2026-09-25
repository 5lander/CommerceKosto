/**
 * `GET /catalogo/unidades` — el catálogo global de unidades.
 *
 * **CONTROLADOR PROPIO Y NO UNA RUTA MÁS EN `ArticulosController`**, por dos
 * razones. La primera es de forma: ese controlador ya lleva sus tres
 * dependencias y una cuarta rompería el límite de CLAUDE.md §3. La segunda es
 * de fondo, y es la que decide: esto **no es un recurso del tenant**. Las otras
 * rutas del catálogo leen filas de una company; esta lee una tabla global, de
 * solo lectura para la aplicación, que ninguna company puede cambiar. Tenerlo
 * a la vista en un archivo aparte es lo que evita que alguien le añada un
 * `POST` sin darse cuenta de lo que está tocando.
 *
 * `catalog.read`, como el resto del catálogo: lo tienen los cinco roles, y
 * `BODEGA` lo necesita tanto como los demás para leer una unidad en un conteo.
 */

import { Controller, Get } from '@nestjs/common';

import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { ListarUnidades } from '../../application/casos-de-uso/unidades';
import type { UnidadLeida } from '../../application/ports/repositorio-de-catalogo.port';

@Controller('catalogo/unidades')
export class UnidadesController {
  public constructor(private readonly listarUnidades: ListarUnidades) {}

  @Get()
  @Requiere('catalog.read')
  public listar(): Promise<readonly UnidadLeida[]> {
    return this.listarUnidades.ejecutar();
  }
}
