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
 * LOS TRES GUARDS SON GLOBALES, Y EL ORDEN IMPORTA. `SesionGuard` primero
 * —resuelve quien pregunta—, `CsrfGuard` despues —comprueba que la mutacion
 * la origino de verdad la pagina de la aplicacion, P16-A2— y `PermisosGuard`
 * al final —decide si puede—. Que sean globales es lo que hace que la
 * autorizacion sea deny-by-default: una ruta nueva esta protegida, y desde
 * P16-A2 tambien exige token si muta, sin que nadie tenga que acordarse.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import { CambiarContrasena } from './application/casos-de-uso/cambiar-contrasena';
import { CerrarSesion } from './application/casos-de-uso/cerrar-sesion';
import { IniciarSesion } from './application/casos-de-uso/iniciar-sesion';
import {
  RestablecerContrasena,
  SolicitarRestablecimiento,
} from './application/casos-de-uso/restablecer-contrasena';
import { ValidarSesion } from './application/casos-de-uso/validar-sesion';
import { CrearUbicacion, ListarUbicaciones } from './application/casos-de-uso/ubicaciones';
import {
  AceptarInvitacion,
  AsignarRol,
  InvitarUsuario,
  ReenviarInvitacion,
  RevocarRol,
} from './application/casos-de-uso/usuarios';
import { ENLACES } from './application/ports/enlaces.port';
import { GENERADOR_DE_TOKENS } from './application/ports/generador-de-tokens.port';
import { HASHER_DE_CONTRASENAS } from './application/ports/hasher-de-contrasenas.port';
import { REPOSITORIO_DE_AUTENTICACION } from './application/ports/repositorio-de-autenticacion.port';
import { REPOSITORIO_DE_ORGANIZACION } from './application/ports/repositorio-de-organizacion.port';
import { Argon2Hasher } from './infrastructure/argon2-hasher';
import { DependenciasDeIam } from './infrastructure/dependencias-de-iam';
import { EnlacesDeLaApp } from './infrastructure/enlaces-de-la-app';
import { GeneradorDeTokensCriptografico } from './infrastructure/generador-de-tokens';
import { AuthController } from './infrastructure/http/auth.controller';
import { ContrasenaController } from './infrastructure/http/contrasena.controller';
import { CsrfGuard } from './infrastructure/http/csrf.guard';
import { InvitacionesDeUsuario } from './infrastructure/http/invitaciones-de-usuario';
import { PermisosGuard } from './infrastructure/http/permisos.guard';
import { Restablecimiento } from './infrastructure/http/restablecimiento';
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
    { provide: ENLACES, useClass: EnlacesDeLaApp },

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
      provide: Restablecimiento,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): Restablecimiento =>
        new Restablecimiento(new SolicitarRestablecimiento(deps), new RestablecerContrasena(deps)),
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
      provide: InvitacionesDeUsuario,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): InvitacionesDeUsuario =>
        new InvitacionesDeUsuario(
          new InvitarUsuario(deps),
          new ReenviarInvitacion(deps),
          new AceptarInvitacion(deps),
        ),
    },
    {
      provide: RolesDeUsuario,
      inject: [DependenciasDeIam],
      useFactory: (deps: DependenciasDeIam): RolesDeUsuario =>
        new RolesDeUsuario(new AsignarRol(deps), new RevocarRol(deps)),
    },

    { provide: APP_GUARD, useClass: SesionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
  // `ListarUbicaciones` se exporta desde P9: el consolidado necesita saber
  // que ubicaciones tiene la company, y pedirlo por el caso de uso es lo que
  // mantiene el alcance de sesion aplicandose una sola vez y en un solo sitio.
  // `IniciarSesion` se exporta para el CLI de importacion, que abre su sesion
  // por el MISMO camino que el navegador en vez de fabricarse una a mano.
  exports: [IniciarSesion, ValidarSesion, ListarUbicaciones],
})
export class IamModule {}
