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
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import type { CompanyId } from '../../../../shared/domain/identity/identificadores';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { ipDelCliente } from '../../../../shared/infrastructure/http/ip-del-cliente';
import { PROXIES_DE_CONFIANZA } from '../proxies-de-confianza';
import {
  cookieBorrada,
  cookieDeSesion,
  leerCookie,
} from '../../../iam/infrastructure/http/cookies';
import { LeerAccesosDelBackoffice, LeerAuditoria } from '../../application/casos-de-uso/auditoria';
import { LeerSaludDelCorreo } from '../../application/casos-de-uso/correo';
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
import { CSS, HTML } from './pagina';
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
  /**
   * Desde donde se cree `X-Forwarded-For` (D-16.49). Viaja con la sesion
   * porque la IP es un dato de quien pide —el login del operador y el motivo
   * de cada acceso la registran— y el controlador ya tiene sus tres
   * dependencias.
   */
  @Inject(PROXIES_DE_CONFIANZA) public readonly proxiesDeConfianza!: readonly string[];
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
  @Inject(LeerSaludDelCorreo) public readonly saludDelCorreo!: LeerSaludDelCorreo;
}

/**
 * El JavaScript de la interfaz.
 *
 * **LA RUTA SUBE HASTA `apps/api` Y BAJA A `dist`, y esa vuelta es a propósito.**
 * Este archivo vive en `.../modules/backoffice/infrastructure/http`, y `__dirname`
 * apunta a `dist/...` cuando corre compilado y a `src/...` cuando lo cargan las
 * pruebas. Cinco niveles arriba es `apps/api` en los dos casos; desde ahí,
 * `dist/ui/backoffice.js` siempre existe si se compiló. Calcularlo solo para
 * `dist` hacía que las pruebas leyeran una ruta inexistente.
 *
 * **SE LEE UNA VEZ, EN LA PRIMERA PETICIÓN, Y NO EN EL CONSTRUCTOR.** Un `throw`
 * mientras Nest instancia un proveedor no sube como excepción normal: el manejador
 * de arranque de Nest **aborta el proceso**, y lo que sale es un volcado nativo sin
 * mensaje. Cuesta más entender ese volcado que el problema que lo causó.
 *
 * Quien sí falla en alto es el proceso: `backoffice.ts` comprueba que el guion
 * está **antes de escuchar**. Un back office que sirve una página en blanco porque
 * nadie compiló la interfaz es peor que uno que no arranca.
 */
export const RUTA_DEL_GUION = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'dist',
  'ui',
  'backoffice.js',
);

export function guionDeLaInterfaz(): string {
  try {
    return readFileSync(RUTA_DEL_GUION, 'utf8');
  } catch {
    throw new Error(
      `No está compilada la interfaz del back office (${RUTA_DEL_GUION}). ` +
        'Ejecuta `npm run build --workspace @costeo/api`.',
    );
  }
}

@Controller()
export class BackofficeController {
  private guionCacheado: string | null = null;

  public constructor(
    private readonly sesion: SesionDelOperador,
    private readonly cartera: LaCartera,
    private readonly registros: LosRegistros,
  ) {}

  /**
   * LOS TRES RECURSOS DE LA INTERFAZ SON PÚBLICOS, y tienen que serlo: sin
   * ellos no hay pantalla donde escribir la contraseña. No llevan ningún dato:
   * son el armazón, la hoja de estilos y el guion, iguales para todo el mundo.
   *
   * Y VAN COMO TRES RECURSOS Y NO EN LÍNEA por la CSP: `script-src 'self'`
   * acepta `/ui/app.js` sin nonce, y un `<script>` dentro del HTML no.
   */
  @PublicoEnBackoffice()
  @Get()
  public pagina(@Res({ passthrough: true }) respuesta: ServerResponse): string {
    respuesta.setHeader('Content-Type', 'text/html; charset=utf-8');
    return HTML;
  }

  @PublicoEnBackoffice()
  @Get('ui/estilos.css')
  public estilos(@Res({ passthrough: true }) respuesta: ServerResponse): string {
    respuesta.setHeader('Content-Type', 'text/css; charset=utf-8');
    return CSS;
  }

  @PublicoEnBackoffice()
  @Get('ui/app.js')
  public guionDeLaPagina(@Res({ passthrough: true }) respuesta: ServerResponse): string {
    respuesta.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    // Se cachea tras la primera lectura: es un archivo pequeño y fijo, y un
    // `readFileSync` por petición sería E/S bloqueante a cambio de nada.
    this.guionCacheado ??= guionDeLaInterfaz();
    return this.guionCacheado;
  }

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
      ip: ipDelCliente(peticion, this.sesion.proxiesDeConfianza),
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
    return this.cartera.listar.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza));
  }

  @Get('companies/:id')
  public async verCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: PeticionConOperador,
  ): Promise<unknown> {
    return this.cartera.ver.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza), id as CompanyId);
  }

  @Post('companies')
  @HttpCode(HttpStatus.CREATED)
  public async crearCompany(
    @Body(new EsquemaPipe(CUERPO_DE_NUEVA_COMPANY)) cuerpo: CuerpoDeNuevaCompany,
    @Req() peticion: PeticionConOperador,
  ): Promise<{ readonly id: string }> {
    const id = await this.cartera.crear.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza), cuerpo);
    return { id };
  }

  @Put('companies/:id/plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async ponerPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_PLAN)) cuerpo: CuerpoDeCambioDePlan,
    @Req() peticion: PeticionConOperador,
  ): Promise<void> {
    await this.cartera.cambiarPlan.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza), {
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
    await this.cartera.cambiarEstado.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza), {
      companyId: id as CompanyId,
      estado: cuerpo.estado,
    });
  }

  @Get('companies/:id/auditoria')
  public async auditoriaDe(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: PeticionConOperador,
  ): Promise<unknown> {
    return this.registros.auditoria.ejecutar(peticionDe(peticion, this.sesion.proxiesDeConfianza), id as CompanyId);
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

  /**
   * La salud de la cola de correo (D-16.27c): `{pendientesAntiguos, fallidos,
   * ultimoEnvio}`. Contadores e instantes; NUNCA destinatarios ni `datos`.
   *
   * NO PIDE MOTIVO NI DEJA FILA EN `backoffice_access_log`: no se lee ningún
   * dato de ningún tenant, son agregados sobre la cola entera. El porqué,
   * completo, en `LeerSaludDelCorreo`. Sigue exigiendo sesión: el guard es
   * global.
   */
  @Get('correo/salud')
  public async saludDelCorreo(): Promise<unknown> {
    return this.registros.saludDelCorreo.ejecutar();
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
function peticionDe(peticion: PeticionConOperador, proxiesDeConfianza: readonly string[]): PeticionDeOperador {
  const crudo = peticion.headers[CABECERA_DE_MOTIVO];

  return {
    operador: operadorDe(peticion),
    // Una cabecera repetida llega como array. Se toma la PRIMERA en vez de
    // unirlas: dos motivos distintos en la misma petición no son un motivo más
    // largo, son una petición que alguien armó a mano.
    motivo: (Array.isArray(crudo) ? crudo[0] : crudo) ?? '',
    ip: ipDelCliente(peticion, proxiesDeConfianza),
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

