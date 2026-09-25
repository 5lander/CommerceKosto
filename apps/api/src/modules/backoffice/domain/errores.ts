/**
 * Los errores del back office.
 *
 * **NO REUTILIZAN LOS DE `iam`, y es deliberado.** `iam` habla de sesiones de un
 * usuario DENTRO de una company; aquí no hay company. Compartir el tipo haría
 * que un `catch (SesionInvalidaError)` de la app cliente capturara también los
 * del back office, y son dos sistemas de identidad que no deben tocarse.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/**
 * El operador no pudo entrar.
 *
 * **UN SOLO MENSAJE PARA TODAS LAS CAUSAS**, igual que en el login de la app:
 * distinguir «ese correo no existe» de «esa contraseña no es» convierte el
 * formulario en un enumerador de operadores. Y aquí importa más: la lista de
 * operadores del back office es la lista de quién puede ver a todos los
 * clientes.
 */
export class AccesoDeOperadorDenegadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CREDENCIALES_INVALIDAS';

  public constructor() {
    super('Correo o contraseña incorrectos.');
  }
}

export class SesionDeOperadorInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'SESION_INVALIDA';

  public constructor(motivo: string) {
    super('Tu sesión de back office no es válida. Vuelve a entrar.', { motivo });
  }
}

export class CompanyNoEncontradaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Esa company no existe.');
  }
}

export class PlanDesconocidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(codigo: string) {
    super(`El plan "${codigo}" no existe.`, { plan: codigo });
  }
}

export class EstadoDesconocidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(estado: string) {
    super(`"${estado}" no es un estado que se pueda fijar desde aquí.`, { estado });
  }
}

/**
 * Bajar de plan por debajo de lo que la company ya tiene dentro.
 *
 * **SE RECHAZA EN VEZ DE DEJARLA EN FALTA.** Un cambio de plan que deja a un
 * cliente con 12 ubicaciones sobre un límite de 10 no rompe nada hoy: rompe el
 * día que intente crear la número 13 y nadie recuerde por qué. El operador tiene
 * que ver el conflicto en el momento de causarlo.
 */
export class PlanNoAlcanzaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'LIMITE_DEL_PLAN';

  public constructor(recurso: string, tiene: number, maximo: number) {
    super(
      `Esa company ya tiene ${String(tiene)} ${recurso} y el plan destino permite ` +
        `${String(maximo)}. Elige un plan que la cubra.`,
      { recurso, tiene, maximo },
    );
  }
}
