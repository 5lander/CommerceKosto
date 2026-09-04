/**
 * Ubicaciones — SPEC §2.
 *
 * LOS DOS ENDPOINTS EXIGEN CAPACIDADES DISTINTAS, y ahi esta la prueba de la
 * escalada vertical: `GERENTE_LOCAL` tiene `location.read` y NO tiene
 * `location.create`, asi que lista las suyas y recibe 403 al intentar crear.
 * No hace falta escribirlo en ningun `if`: sale de las filas de
 * `role_permission` que sembro la migracion.
 *
 * EL LISTADO NO LLEVA `@Requiere` DE ESCRITURA NI FILTRO PROPIO: el alcance lo
 * aplica el caso de uso a partir de `sesion.alcance`. Es la escalada
 * horizontal, y se prueba: un `GERENTE_LOCAL` de la ubicacion A no ve la B
 * aunque las dos sean de su company.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { CrearUbicacion, ListarUbicaciones } from '../../application/casos-de-uso/ubicaciones';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import type { Ubicacion } from '../../application/ports/repositorio-de-organizacion.port';
import { SesionActual } from './decoradores';
import { CUERPO_DE_UBICACION, type CuerpoDeUbicacion } from './organizacion.dto';

@Controller('ubicaciones')
export class UbicacionesController {
  public constructor(
    private readonly crearUbicacion: CrearUbicacion,
    private readonly listarUbicaciones: ListarUbicaciones,
  ) {}

  @Get()
  @Requiere('location.read')
  public listar(@SesionActual() sesion: SesionActiva): Promise<readonly Ubicacion[]> {
    return this.listarUbicaciones.ejecutar(sesion);
  }

  @Post()
  @Requiere('location.create')
  @HttpCode(HttpStatus.CREATED)
  public crear(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_UBICACION)) cuerpo: CuerpoDeUbicacion,
  ): Promise<Ubicacion> {
    return this.crearUbicacion.ejecutar(sesion, cuerpo);
  }
}
