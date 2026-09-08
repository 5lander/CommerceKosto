/**
 * La superficie HTTP del back office. **Vive en su propio proceso y su propio puerto.**
 *
 * **NO SE PUBLICA A INTERNET.** Escucha en loopback y se llega por túnel SSH
 * (`docs/runbooks/despliegue.md`). Un back office accesible desde fuera es una
 * puerta a todos los tenants protegida solo por una contraseña.
 *
 * **TODA RUTA QUE TOCA DATOS DE UN CLIENTE EXIGE LA CABECERA `X-Motivo`.** No
 * hay ruta de conveniencia sin ella: si la hubiera, sería la que se usa.
 */

import {
  Body,
  Controller,
  Inject,
  Injectable,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CompanyId } from '../../../../shared/domain/identity/identificadores';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import {
  cookieBorrada,
  cookieDeSesion,
  leerCookie,
} from '../../../iam/infrastructure/http/cookies';
import { LeerAccesosDelBackoffice, LeerAuditoria } from '../../application/casos-de-uso/auditoria';
import {
  CambiarEstadoDeCompany,
  CambiarPlan,
  CrearCompany,
  ListarCompanies,
  ListarPlanes,
  VerCompany,
  type PeticionDeOperador,
} from '../../application/casos-de-uso/companies';
import {
  CerrarSesionDeOperador,
  IniciarSesionDeOperador,
  // La MISMA constante que usa la sesión: si la cookie viviera más que el
  // token, el operador vería un 401 con la sesión aparentemente abierta.
  VIGENCIA_MS,
  type OperadorActivo,
} from '../../application/casos-de-uso/sesion';
import {
  CABECERA_DE_MOTIVO,
  CUERPO_DE_CAMBIO_DE_ESTADO,
  CUERPO_DE_CAMBIO_DE_PLAN,
  CUERPO_DE_LOGIN_DE_OPERADOR,
  CUERPO_DE_NUEVA_COMPANY,
  type CuerpoDeCambioDeEstado,
  type CuerpoDeCambioDePlan,
  type CuerpoDeLoginDeOperador,
  type CuerpoDeNuevaCompany,
} from './backoffice.dto';
import {
  COOKIE_DE_OPERADOR,
  PublicoEnBackoffice,
  type PeticionConOperador,
} from './operador.guard';

/**
 * Los casos de uso agrupados, para que el constructor no tenga diez parámetros.
 *
 * ES EL MISMO PATRÓN QUE `DependenciasDeAnaliticaNest`, y por la misma razón:
 * CLAUDE.md §3 pone el techo en tres parámetros, y un controlador con una
 * decena de dependencias sueltas se lee como una lista de la compra. Con
 * inyección por propiedad no hace falta ninguna fábrica.
 */
@Injectable()
export class SesionDelOperador {
  @Inject(IniciarSesionDeOperador) public readonly iniciar!: IniciarSesionDeOperador;
  @Inject(CerrarSesionDeOperador) public readonly cerrar!: CerrarSesionDeOperador;
}

@Injectable()
export class LaCartera {
  @Inject(ListarCompanies) public readonly listar!: ListarCompanies;
  @Inject(ListarPlanes) public readonly planes!: ListarPlanes;
  @Inject(VerCompany) public readonly ver!: VerCompany;
  @Inject(CrearCompany) public readonly crear!: CrearCompany;
  @Inject(CambiarPlan) public readonly cambiarPlan!: CambiarPlan;
  @Inject(CambiarEstadoDeCompany) public readonly cambiarEstado!: CambiarEstadoDeCompany;
}

@Injectable()
export class LosRegistros {
  @Inject(LeerAuditoria) public readonly auditoria!: LeerAuditoria;
  @Inject(LeerAccesosDelBackoffice) public readonly accesos!: LeerAccesosDelBackoffice;
}

@Controller()
export class BackofficeController {
  public constructor(
    private readonly sesion: SesionDelOperador,
    private readonly cartera: LaCartera,
    private readonly registros: LosRegistros,
  ) {}

  @PublicoEnBackoffice()
  @Post('sesion')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body(new EsquemaPipe(CUERPO_DE_LOGIN_DE_OPERADOR)) cuerpo: CuerpoDeLoginDeOperador,
    @Req() peticion: IncomingMessage,
    @Res({ passthrough: true }) respuesta: ServerResponse,
  ): Promise<{ readonly expiraEn: string }> {
    const token = await this.sesion.iniciar.ejecutar({
      email: cuerpo.email,
      contrasena: cuerpo.contrasena,
      ip: ipDe(peticion),
      userAgent: null,
    });

    const expiraEn = new Date(Date.now() + VIGENCIA_MS);
    respuesta.setHeader(
      'Set-Cookie',
      cookieDeSesion({
        token,
        expiraEn,
        ahora: new Date(),
        // SIEMPRE `Secure`, incluso en desarrollo: al back office se llega por
        // túnel, así que no hay escenario legítimo en texto plano.
        seguro: true,
        nombre: COOKIE_DE_OPERADOR,
      }),
    );

    return { expiraEn: expiraEn.toISOString() };
  }

  @Post('salir')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @Req() peticion: IncomingMessage,
    @Res({ passthrough: true }) respuesta: ServerResponse,
  ): Promise<void> {
    const token = leerCookie(peticion.headers.cookie, COOKIE_DE_OPERADOR);
    if (token !== null) await this.sesion.cerrar.ejecutar(token);
    respuesta.setHeader('Set-Cookie', cookieBorrada(true, COOKIE_DE_OPERADOR));
  }

  @Get('planes')
  public async listarPlanes(): Promise<unknown> {
    return this.cartera.planes.ejecutar();
  }

  @Get('companies')
  public async listarCompanies(
    @Req() peticion: PeticionConOperador,
  ): Promise<unknown> {
    return this.cartera.listar.ejecutar(peticionDe(peticion));
  }

  @Get('companies/:id')
  public async verCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: PeticionConOperador,
  ): Promise<unknown> {
    return this.cartera.ver.ejecutar(peticionDe(peticion), id as CompanyId);
  }

  @Post('companies')
  @HttpCode(HttpStatus.CREATED)
  public async crearCompany(
    @Body(new EsquemaPipe(CUERPO_DE_NUEVA_COMPANY)) cuerpo: CuerpoDeNuevaCompany,
    @Req() peticion: PeticionConOperador,
  ): Promise<{ readonly id: string }> {
    const id = await this.cartera.crear.ejecutar(peticionDe(peticion), cuerpo);
    return { id };
  }

  @Put('companies/:id/plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async ponerPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_PLAN)) cuerpo: CuerpoDeCambioDePlan,
    @Req() peticion: PeticionConOperador,
  ): Promise<void> {
    await this.cartera.cambiarPlan.ejecutar(peticionDe(peticion), {
      companyId: id as CompanyId,
      plan: cuerpo.plan,
    });
  }

  @Put('companies/:id/estado')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async ponerEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_ESTADO)) cuerpo: CuerpoDeCambioDeEstado,
    @Req() peticion: PeticionConOperador,
  ): Promise<void> {
    await this.cartera.cambiarEstado.ejecutar(peticionDe(peticion), {
      companyId: id as CompanyId,
      estado: cuerpo.estado,
    });
  }

  @Get('companies/:id/auditoria')
  public async auditoriaDe(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: PeticionConOperador,
  ): Promise<unknown> {
    return this.registros.auditoria.ejecutar(peticionDe(peticion), id as CompanyId);
  }

  /**
   * Quién ha estado mirando qué.
   *
   * NO PIDE MOTIVO: es el registro del propio back office, y quien lo consulta
   * está auditando a los operadores, no mirando datos de un cliente.
   */
  @Get('accesos')
  public async accesosDelBackoffice(): Promise<unknown> {
    return this.registros.accesos.ejecutar();
  }
}

/**
 * Arma la petición del operador.
 *
 * **LA CABECERA AUSENTE SE TRATA COMO UN MOTIVO VACÍO, no como un error de
 * esquema.** Pasarla por un Zod daría «(cuerpo): Too small», que menciona un
 * cuerpo que no existe y no dice qué poner. El dominio, en cambio, contesta
 * «faltan 20 caracteres, escribe para qué necesitas ver estos datos». Un
 * control que se explica mal se rodea; uno que dice qué hacer, se cumple.
 */
function peticionDe(peticion: PeticionConOperador): PeticionDeOperador {
  const crudo = peticion.headers[CABECERA_DE_MOTIVO];

  return {
    operador: operadorDe(peticion),
    // Una cabecera repetida llega como array. Se toma la PRIMERA en vez de
    // unirlas: dos motivos distintos en la misma petición no son un motivo más
    // largo, son una petición que alguien armó a mano.
    motivo: (Array.isArray(crudo) ? crudo[0] : crudo) ?? '',
    ip: ipDe(peticion),
  };
}

/**
 * El operador que el guard dejó puesto.
 *
 * LANZA EN VEZ DE AFIRMAR CON `as`. El guard garantiza que está, pero un `as`
 * convierte «el guard dejó de correr en esta ruta» en `undefined` viajando hacia
 * dentro hasta reventar en un sitio que no dice nada. Aquí revienta donde el
 * fallo está, y es el fallo más grave posible: una ruta del back office sin
 * autenticar.
 */
function operadorDe(peticion: PeticionConOperador): OperadorActivo {
  if (peticion.operador === undefined) {
    throw new Error('Ruta de back office sin guard: el operador no está en la petición.');
  }
  return peticion.operador;
}

function ipDe(peticion: IncomingMessage): string | null {
  return peticion.socket.remoteAddress ?? null;
}
