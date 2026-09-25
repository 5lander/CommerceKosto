/**
 * El módulo del back office. **`AppModule` NO lo importa, y nunca debe.**
 *
 * Esa frase es el criterio de aceptación de P11: «existe un test que verifica
 * que ningún módulo de la app cliente importa la conexión privilegiada». Aquí
 * está la mitad estructural —este módulo solo lo monta `backoffice.ts`— y la
 * otra mitad son tres cosas que sí lo comprueban:
 *
 *   · `audit:forbidden`, con la regla `conexion-privilegiada-solo-en-backoffice`
 *   · `audit:arch`, que prohíbe la arista hacia esta carpeta
 *   · una prueba de integración que construye `AppModule` de verdad y comprueba
 *     que `BackofficeConnection` no está en su contenedor
 *
 * **NO IMPORTA `SharedModule`.** Sería la vía por la que el pool de la
 * aplicación entraría en este proceso: `SharedModule` trae `PrismaConnection`,
 * que se conecta como `costeo_app`. Un proceso, un rol, un pool. Lo que hace
 * falta de `shared` —el reloj— se declara aquí, que son tres líneas.
 */

import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { RELOJ, type Reloj } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import {
  HASHER_DE_CONTRASENAS,
  type HasherDeContrasenas,
} from '../iam/application/ports/hasher-de-contrasenas.port';
import { Argon2Hasher } from '../iam/infrastructure/argon2-hasher';
import { LeerAccesosDelBackoffice, LeerAuditoria } from './application/casos-de-uso/auditoria';
import { LeerSaludDelCorreo } from './application/casos-de-uso/correo';
import {
  CambiarEstadoDeCompany,
  CambiarPlan,
  CrearCompany,
  ListarCompanies,
  ListarPlanes,
  VerCompany,
  type DependenciasDeCompanies,
} from './application/casos-de-uso/companies';
import {
  CerrarSesionDeOperador,
  IniciarSesionDeOperador,
  ValidarSesionDeOperador,
  type DependenciasDeSesionDeOperador,
} from './application/casos-de-uso/sesion';
import {
  REPOSITORIO_DE_BACKOFFICE,
  type RepositorioDeBackoffice,
} from './application/ports/repositorio-de-backoffice.port';
import { BackofficeConnection } from './infrastructure/backoffice-connection';
import { minutosDeAlertaDelEntorno } from './infrastructure/minutos-de-alerta';
import { PROXIES_DE_CONFIANZA, proxiesDeConfianzaDelEntorno } from './infrastructure/proxies-de-confianza';
import { PrismaBackofficeRepositorio } from './infrastructure/prisma-backoffice.repositorio';
import { ErrorFilter } from '../../shared/infrastructure/http/error.filter';
import { securityHeaders } from '../../shared/infrastructure/http/security-headers';
import {
  BackofficeController,
  LaCartera,
  LosRegistros,
  SesionDelOperador,
} from './infrastructure/http/backoffice.controller';
import { CsrfDeOperadorGuard } from './infrastructure/http/csrf-de-operador.guard';
import { OperadorGuard } from './infrastructure/http/operador.guard';

type Repo = RepositorioDeBackoffice;

function conRepositorio(repositorio: Repo): DependenciasDeCompanies {
  return { repositorio };
}

function conSesion(
  repositorio: Repo,
  hasher: HasherDeContrasenas,
  reloj: Reloj,
): DependenciasDeSesionDeOperador {
  return { repositorio, hasher, reloj };
}

const DE_REPO = { inject: [REPOSITORIO_DE_BACKOFFICE] };
const DE_SESION = { inject: [REPOSITORIO_DE_BACKOFFICE, HASHER_DE_CONTRASENAS, RELOJ] };

@Module({
  controllers: [BackofficeController],
  providers: [
    BackofficeConnection,
    { provide: REPOSITORIO_DE_BACKOFFICE, useClass: PrismaBackofficeRepositorio },
    { provide: HASHER_DE_CONTRASENAS, useClass: Argon2Hasher },
    { provide: RELOJ, useClass: RelojDelSistema },
    // La lista se lee al construir el modulo: una entrada invalida para el
    // arranque, como `BACKOFFICE_PORT` (D-16.49).
    { provide: PROXIES_DE_CONFIANZA, useFactory: proxiesDeConfianzaDelEntorno },

    // DENY BY DEFAULT: el guard es global del proceso, así que una ruta nueva
    // nace protegida. Al revés, la que se olvida queda abierta — y aquí lo que
    // queda abierto son todos los tenants a la vez.
    { provide: APP_GUARD, useClass: OperadorGuard },
    // Y despues el del token: necesita al operador que deja el de arriba.
    { provide: APP_GUARD, useClass: CsrfDeOperadorGuard },

    // EL MISMO FILTRO QUE LA APP CLIENTE, y por la misma razón: un `23514` de
    // PostgreSQL sin traducir sale como 500 y cuenta la restricción que violó.
    // El back office mira datos de todos los clientes: es el último sitio donde
    // conviene que un error hable de más.
    { provide: APP_FILTER, useClass: ErrorFilter },

    {
      provide: IniciarSesionDeOperador,
      ...DE_SESION,
      useFactory: (r: Repo, h: HasherDeContrasenas, c: Reloj): IniciarSesionDeOperador =>
        new IniciarSesionDeOperador(conSesion(r, h, c)),
    },
    {
      provide: ValidarSesionDeOperador,
      ...DE_SESION,
      useFactory: (r: Repo, h: HasherDeContrasenas, c: Reloj): ValidarSesionDeOperador =>
        new ValidarSesionDeOperador(conSesion(r, h, c)),
    },
    {
      provide: CerrarSesionDeOperador,
      ...DE_SESION,
      useFactory: (r: Repo, h: HasherDeContrasenas, c: Reloj): CerrarSesionDeOperador =>
        new CerrarSesionDeOperador(conSesion(r, h, c)),
    },

    {
      provide: ListarCompanies,
      ...DE_REPO,
      useFactory: (r: Repo): ListarCompanies => new ListarCompanies(conRepositorio(r)),
    },
    {
      provide: ListarPlanes,
      ...DE_REPO,
      useFactory: (r: Repo): ListarPlanes => new ListarPlanes(conRepositorio(r)),
    },
    {
      provide: VerCompany,
      ...DE_REPO,
      useFactory: (r: Repo): VerCompany => new VerCompany(conRepositorio(r)),
    },
    {
      provide: CrearCompany,
      ...DE_REPO,
      useFactory: (r: Repo): CrearCompany => new CrearCompany(conRepositorio(r)),
    },
    {
      provide: CambiarPlan,
      ...DE_REPO,
      useFactory: (r: Repo): CambiarPlan => new CambiarPlan(conRepositorio(r)),
    },
    {
      provide: CambiarEstadoDeCompany,
      ...DE_REPO,
      useFactory: (r: Repo): CambiarEstadoDeCompany =>
        new CambiarEstadoDeCompany(conRepositorio(r)),
    },
    {
      provide: LeerAuditoria,
      ...DE_REPO,
      useFactory: (r: Repo): LeerAuditoria => new LeerAuditoria({ repositorio: r }),
    },
    {
      provide: LeerAccesosDelBackoffice,
      ...DE_REPO,
      useFactory: (r: Repo): LeerAccesosDelBackoffice =>
        new LeerAccesosDelBackoffice({ repositorio: r }),
    },
    {
      provide: LeerSaludDelCorreo,
      inject: [REPOSITORIO_DE_BACKOFFICE, RELOJ],
      // El umbral se lee al construir el modulo: un valor invalido en el
      // entorno para el arranque, como `BACKOFFICE_PORT`.
      useFactory: (r: Repo, c: Reloj): LeerSaludDelCorreo =>
        new LeerSaludDelCorreo({ repositorio: r, reloj: c, minutosDeAlerta: minutosDeAlertaDelEntorno() }),
    },

    // LAS TRES FACHADAS, por inyección de propiedad: el controlador recibe tres
    // dependencias y no diez (CLAUDE.md §3).
    SesionDelOperador,
    LaCartera,
    LosRegistros,
  ],
})
export class BackofficeModule implements NestModule {
  /**
   * LAS CABECERAS DE SEGURIDAD SON DEL MODULO, NO DEL LANZADOR.
   *
   * Estaban en `backoffice.ts` y funcionaban, pero eso dejaba la CSP fuera de lo
   * que el modulo garantiza: una prueba que monta el modulo no las veia, y un
   * segundo lanzador podria olvidarlas. Aqui viajan con el modulo alla donde se
   * monte, y la prueba mide lo mismo que sirve el proceso.
   *
   * Importan mas que en la app cliente por un detalle: **este proceso sirve
   * HTML**. `script-src 'self'` sin nonce es lo que obliga a que el guion y los
   * estilos vayan como recursos propios en vez de en linea.
   */
  public configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(...securityHeaders()).forRoutes('*');
  }
}
