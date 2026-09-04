/**
 * Modulo `iam` — companies, usuarios, sesiones, ubicaciones y roles.
 *
 * Es el cableado, y nada mas: aqui se elige que implementacion responde a cada
 * puerto. Los casos de uso reciben el puerto por constructor y no saben cual
 * les toco, que es lo que permite probarlos sin base de datos (CLAUDE.md §2).
 *
 * LOS CASOS DE USO SE CONSTRUYEN CON `useFactory` Y NO CON `@Injectable()`.
 * `application` no puede importar NestJS —lo verifica la regla
 * `application-sin-framework` de `audit:arch`—, asi que la clase no lleva
 * decorador y es este modulo el que la instancia. El resultado es que el caso
 * de uso se puede construir a mano en una prueba con seis dobles y sin
 * contenedor de por medio.
 *
 * LOS DOS GUARDS SON GLOBALES, Y EL ORDEN IMPORTA. `SesionGuard` primero
 * —resuelve quien pregunta—, `PermisosGuard` despues —decide si puede—. Que
 * sean globales es lo que hace que la autorizacion sea deny-by-default: una
 * ruta nueva esta protegida sin que nadie tenga que acordarse de protegerla.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import { CambiarContrasena } from './application/casos-de-uso/cambiar-contrasena';
import { CerrarSesion } from './application/casos-de-uso/cerrar-sesion';
import { IniciarSesion } from './application/casos-de-uso/iniciar-sesion';
import { ValidarSesion } from './application/casos-de-uso/validar-sesion';
import { CrearUbicacion, ListarUbicaciones } from './application/casos-de-uso/ubicaciones';
import {
  AceptarInvitacion,
  AsignarRol,
  InvitarUsuario,
  RevocarRol,
} from './application/casos-de-uso/usuarios';
import { GENERADOR_DE_TOKENS } from './application/ports/generador-de-tokens.port';
import { HASHER_DE_CONTRASENAS } from './application/ports/hasher-de-contrasenas.port';
import { REPOSITORIO_DE_AUTENTICACION } from './application/ports/repositorio-de-autenticacion.port';
import { REPOSITORIO_DE_ORGANIZACION } from './application/ports/repositorio-de-organizacion.port';
import { Argon2Hasher } from './infrastructure/argon2-hasher';
import { DependenciasDeIam } from './infrastructure/dependencias-de-iam';
import { GeneradorDeTokensCriptografico } from './infrastructure/generador-de-tokens';
import { AuthController } from './infrastructure/http/auth.controller';
import { ContrasenaController } from './infrastructure/http/contrasena.controller';
import { PermisosGuard } from './infrastructure/http/permisos.guard';
import { SesionGuard } from './infrastructure/http/sesion.guard';
import { UbicacionesController } from './infrastructure/http/ubicaciones.controller';
import { RolesDeUsuario } from './infrastructure/http/roles-de-usuario';
import { UsuariosController } from './infrastructure/http/usuarios.controller';
import { PrismaAutenticacionRepositorio } from './infrastructure/prisma-autenticacion.repositorio';
import { PrismaOrganizacionRepositorio } from './infrastructure/prisma-organizacion.repositorio';

@Module({
  controllers: [AuthController, ContrasenaController, UbicacionesController, UsuariosController],
  providers: [
    { provide: HASHER_DE_CONTRASENAS, useClass: Argon2Hasher },
    { provide: GENERADOR_DE_TOKENS, useClass: GeneradorDeTokensCriptografico },
    { provide: REPOSITORIO_DE_AUTENTICACION, useClass: PrismaAutenticacionRepositorio },
    { provide: REPOSITORIO_DE_ORGANIZACION, useClass: PrismaOrganizacionRepositorio },
    { provide: RELOJ, useClass: RelojDelSistema },

    DependenciasDeIam,

    {
      provide: IniciarSesion,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): IniciarSesion => new IniciarSesion(deps),
    },
    {
      provide: ValidarSesion,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): ValidarSesion => new ValidarSesion(deps),
    },
    {
      provide: CerrarSesion,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): CerrarSesion => new CerrarSesion(deps),
    },
    {
      provide: CambiarContrasena,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): CambiarContrasena => new CambiarContrasena(deps),
    },

    {
      provide: CrearUbicacion,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): CrearUbicacion => new CrearUbicacion(deps),
    },
    {
      provide: ListarUbicaciones,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): ListarUbicaciones => new ListarUbicaciones(deps),
    },
    {
      provide: InvitarUsuario,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): InvitarUsuario => new InvitarUsuario(deps),
    },
    {
      provide: AceptarInvitacion,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): AceptarInvitacion => new AceptarInvitacion(deps),
    },
    {
      provide: RolesDeUsuario,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): RolesDeUsuario =>
        new RolesDeUsuario(new AsignarRol(deps), new RevocarRol(deps)),
    },

    { provide: APP_GUARD, useClass: SesionGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
  exports: [ValidarSesion],
})
export class IamModule {}
