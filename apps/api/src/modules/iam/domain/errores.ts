/**
 * Errores de `iam`. Todos son de dominio: no saben de HTTP.
 *
 * `CredencialesInvalidasError` ES UNO SOLO PARA TRES CAUSAS DISTINTAS —el
 * correo no existe, la contrasena no coincide, la cuenta o la company estan
 * suspendidas— y eso no es pereza: es el requisito de SEGURIDAD.md §2.1, que
 * exige una respuesta identica exista o no la cuenta. Tres errores distintos
 * serian tres respuestas distinguibles, y con eso se enumera el padron de
 * usuarios sin acertar una sola contrasena.
 *
 * El motivo real SI se registra, pero solo en `detalle`, que viaja al log de
 * auditoria y nunca a la respuesta.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

const MENSAJE_UNICO = 'Correo o contrasena incorrectos.';

/** Causa real del fallo. Va al log de auditoria; jamas a la respuesta. */
export type MotivoDelRechazo =
  | 'correo_desconocido'
  | 'contrasena_incorrecta'
  | 'usuario_no_activo'
  | 'company_no_activa';

export class CredencialesInvalidasError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CREDENCIALES_INVALIDAS';

  public constructor(motivo: MotivoDelRechazo) {
    super(MENSAJE_UNICO, { motivo });
  }
}

/**
 * El unico error del login que SI dice algo distinto, y a proposito.
 *
 * Decir "estas bloqueado" revela que la cuenta existe. Se acepta porque la
 * alternativa —callar— convierte un bloqueo en un fallo de credenciales
 * indistinguible, y el usuario legitimo cambia su contrasena una y otra vez
 * sin entender por que no entra. El atacante ya sabia que la cuenta existe: ha
 * conseguido dispararle cinco fallos.
 */
export class AccesoBloqueadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ACCESO_BLOQUEADO';

  public constructor(public readonly bloqueadoHasta: Date) {
    super('Demasiados intentos fallidos. Vuelve a intentarlo mas tarde.', {
      bloqueadoHasta: bloqueadoHasta.toISOString(),
    });
  }
}

export class SesionInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'SESION_INVALIDA';

  public constructor(motivo: 'ausente' | 'desconocida' | 'revocada' | 'caducada' | 'inactiva') {
    super('Sesion no valida. Inicia sesion de nuevo.', { motivo });
  }
}

export class PermisoDenegadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'PERMISO_DENEGADO';

  public constructor(permiso: string) {
    // El permiso que falta SI sale: quien recibe este error ya esta
    // autenticado, y saber que le falta `location.create` es lo que le permite
    // pedirselo a su administrador en vez de abrir un ticket a ciegas.
    super(`No tienes el permiso "${permiso}".`, { permiso });
  }
}

/**
 * El plan contratado no da para mas.
 *
 * ES 409 Y NO 403: el usuario SI tiene el permiso —por eso llego hasta aqui—,
 * lo que no da es el plan. Un 403 mandaria a su administrador a revisar roles
 * que estan bien puestos.
 */
export class LimiteDelPlanError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'LIMITE_DEL_PLAN';

  public constructor(recurso: string, maximo: number) {
    super(`Tu plan permite hasta ${String(maximo)} ${recurso}. Amplia el plan para anadir mas.`, {
      recurso,
      maximo,
    });
  }
}

export class NoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';
}

export class ContrasenaDebilError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(motivo: string) {
    super(motivo);
  }
}

/**
 * El enlace de restablecimiento no sirve — y NO se dice por que.
 *
 * Vacio, inexistente, ya usado y caducado dan el MISMO error, igual que en la
 * activacion: quien prueba tokens no debe poder distinguir «no existe» de «ya
 * se uso», porque lo segundo confirma que hubo una cuenta detras. Es 400 y no
 * 401: no hay sesion que invalidar, hay una peticion que no vale.
 */
export class TokenDeRestablecimientoInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('El enlace de restablecimiento no es valido o ya caduco. Pide uno nuevo.');
  }
}

/**
 * La ubicacion pedida no esta en el alcance de quien pregunta.
 *
 * ES LA ESCALADA HORIZONTAL, y vive en `iam` porque es una regla sobre la
 * SESION y no sobre lo que se estaba consultando. RLS garantiza que no se vean
 * datos de otra company; no sabe nada de que un `GERENTE_LOCAL` solo puede
 * tocar la suya. Esa mitad se decide en la aplicacion, y la deciden todos los
 * modulos que tienen datos por ubicacion — recetas, costeo e inventario.
 *
 * NACIO EN `recipes` EN P4 Y SE MUDO AQUI EN P6, cuando el segundo modulo la
 * necesito. Dejarla alli habria obligado a `inventory` a importar un error de
 * dominio de `recipes` para hablar de permisos, o a duplicar la funcion.
 */
export class UbicacionFueraDeAlcanceError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'PERMISO_DENEGADO';

  public constructor() {
    super('Esa ubicacion no esta en tu alcance.');
  }
}
