/**
 * El "objeto de parametros" de CLAUDE.md §3, materializado como una clase que
 * NestJS puede rellenar.
 *
 * POR QUE EXISTE. Un caso de uso como `IniciarSesion` necesita seis
 * colaboradores, y la regla del proyecto es maximo tres parametros. La salida
 * que la propia regla propone es el objeto de parametros; lo que falta es
 * construirlo, y ahi el contenedor de Nest solo sabe inyectar por constructor
 * —que tendria los mismos seis parametros— o por propiedad. Se usa por
 * propiedad: es una caracteristica documentada de NestJS, deja los seis puertos
 * en una lista legible, y hace que cada caso de uso reciba exactamente un
 * parametro.
 *
 * ESTA CLASE ES LO UNICO QUE CONOCE LOS TOKENS DE INYECCION. Los casos de uso
 * ven interfaces; si manana el hasher pasa a ser otro, se cambia una linea aqui
 * y nada mas. Cada caso de uso declara la parte que necesita —`IniciarSesion`
 * pide seis, `ValidarSesion` tres— y esta clase las satisface todas por
 * estructura, sin herencia ni jerarquia.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { MAILER_PORT, type MailerPort } from '../../../shared/application/ports/mailer.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import {
  GENERADOR_DE_TOKENS,
  type GeneradorDeTokens,
} from '../application/ports/generador-de-tokens.port';
import {
  HASHER_DE_CONTRASENAS,
  type HasherDeContrasenas,
} from '../application/ports/hasher-de-contrasenas.port';
import {
  REPOSITORIO_DE_AUTENTICACION,
  type RepositorioDeAutenticacion,
} from '../application/ports/repositorio-de-autenticacion.port';
import {
  REPOSITORIO_DE_ORGANIZACION,
  type RepositorioDeOrganizacion,
} from '../application/ports/repositorio-de-organizacion.port';

@Injectable()
export class DependenciasDeIam {
  @Inject(REPOSITORIO_DE_AUTENTICACION)
  public readonly repositorio!: RepositorioDeAutenticacion;

  @Inject(REPOSITORIO_DE_ORGANIZACION)
  public readonly organizacion!: RepositorioDeOrganizacion;

  @Inject(HASHER_DE_CONTRASENAS)
  public readonly hasher!: HasherDeContrasenas;

  @Inject(GENERADOR_DE_TOKENS)
  public readonly tokens!: GeneradorDeTokens;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(MAILER_PORT)
  public readonly correo!: MailerPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;
}
