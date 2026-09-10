/**
 * Una pasada del despachador — ADR-025, D-16.15, D-16.28, D-16.34, D-16.46.
 *
 * ES EL UNICO SITIO DEL SISTEMA QUE ENVIA CORREO. La API encola; esto entrega.
 * Y lo hace con un rol que ve exactamente dos tablas, en un proceso que no
 * tiene ni la cadena de conexion de la aplicacion.
 *
 * LA PASADA, EN ORDEN:
 *
 *   1. toma hasta `lote` correos `PENDIENTE` cuyo turno llego;
 *   2. por cada uno: renueva su reserva (si otra instancia se la quedo, lo
 *      cede), lo escribe con las plantillas de `shared/application`, lo manda
 *      por `MailerPort`, y lo marca. Si salio, `ENVIADO` con `datos` saneado;
 *      si no, la decision de reintento (espera creciente y tope);
 *   3. purga los golpes de `rate_limit_hit` con mas de 24 horas (D-16.28):
 *      la ventana mas larga del limite es de una hora, asi que a las 24 no
 *      queda nada que contar. Va aqui y no en un cron porque el despachador
 *      ya pasa cada pocos segundos y ya tiene el `DELETE`.
 *
 * UN FALLO DE ENVIO NO PARA LA PASADA. Cada correo se marca por separado; el
 * que falla queda registrado con su error y su siguiente intento, y el
 * siguiente de la lista se intenta igual.
 *
 * UN FALLO AL MARCAR SI SUBE, Y NO PASA POR `marcarFallo`. Son dos `try`
 * distintos a proposito: si el proveedor acepto el correo y lo que falla es la
 * marca —la base caida un instante—, tratarlo como fallo de envio dejaria la
 * fila `PENDIENTE` con `intentos + 1` y un error de base en una columna que
 * leen la aplicacion y el back office, y el correo saldria OTRA VEZ al minuto.
 * Subiendo, la pasada se corta, la fila queda con su reserva, y solo si la
 * base vuelve antes de que caduque se reintenta una vez: es la unica ventana
 * de doble envio que queda, cabe en los milisegundos entre el `2xx` del
 * proveedor y el `UPDATE`, y esta dicha en ADR-025.
 *
 * SIN NEST, SIN PRISMA, SIN RELOJ DEL SISTEMA: recibe sus tres puertos por
 * constructor y se prueba con dobles en memoria, como cualquier caso de uso
 * (CLAUDE.md §2).
 */

import { renderizar } from '../../../shared/application/correo/plantillas';
import type { MailerPort } from '../../../shared/application/ports/mailer.port';
import type { Reloj } from '../../../shared/application/ports/reloj.port';
import { decidirReintento } from '../domain/reintentos';
import { datosSaneados } from '../domain/saneado';
import type { ColaDeCorreo, CorreoPendiente } from './ports/cola-de-correo.port';

/** El nombre con el que los correos hablan del sistema. */
const NOMBRE_DEL_PRODUCTO = 'costeo-saas';

/** Ninguna ventana del limite de tasa pasa de una hora (D-16.50); a las 24 no queda nada que contar. */
const HORAS_DE_LIMITE_QUE_SE_CONSERVAN = 24;
const MILISEGUNDOS_POR_HORA = 3_600_000;

/**
 * Lo que va a `email_outbox.error`. Se acota porque un proveedor puede devolver
 * una pagina entera como mensaje, y la columna la leen la aplicacion (P16-C) y
 * el back office.
 */
const LARGO_MAXIMO_DEL_ERROR = 500;

const ERROR_DE_DATOS_ILEGIBLES = 'Los datos del correo no tienen la forma de su plantilla.';

export interface DependenciasDelDespacho {
  readonly cola: ColaDeCorreo;
  readonly mailer: MailerPort;
  readonly reloj: Reloj;
  /** Cuantos correos como maximo por pasada (`CORREO_LOTE`). */
  readonly lote: number;
}

export interface ResumenDePasada {
  readonly tomados: number;
  readonly enviados: number;
  readonly fallidos: number;
  /** Tomados cuya reserva ya era de otra instancia al ir a enviarlos: ni se envian ni se marcan. */
  readonly cedidos: number;
  readonly purgados: number;
}

/** Como termino cada correo de la pasada; es la clave del contador del resumen. */
type Desenlace = 'enviados' | 'fallidos' | 'cedidos';

function mensajeDe(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  return texto.slice(0, LARGO_MAXIMO_DEL_ERROR);
}

export class DespacharCorreo {
  public constructor(private readonly deps: DependenciasDelDespacho) {}

  public async ejecutar(): Promise<ResumenDePasada> {
    const ahora = this.deps.reloj.ahora();
    const pendientes = await this.deps.cola.tomarPendientes(ahora, this.deps.lote);

    const cuenta: Record<Desenlace, number> = { enviados: 0, fallidos: 0, cedidos: 0 };
    for (const correo of pendientes) {
      cuenta[await this.entregar(correo)] += 1;
    }

    const antesDe = new Date(ahora.getTime() - HORAS_DE_LIMITE_QUE_SE_CONSERVAN * MILISEGUNDOS_POR_HORA);
    const purgados = await this.deps.cola.purgarLimites(antesDe);

    return { tomados: pendientes.length, ...cuenta, purgados };
  }

  /** Un fallo de envio se registra y no sube; un fallo al reservar o al marcar, si. */
  private async entregar(correo: CorreoPendiente): Promise<Desenlace> {
    if (!(await this.deps.cola.renovarReserva(correo, this.deps.reloj.ahora()))) {
      return 'cedidos';
    }

    const saneado = datosSaneados(correo.plantilla, correo.destinatario);
    const fallo = await this.intentarEnvio(correo);
    if (fallo === null) {
      await this.deps.cola.marcarEnviado(correo.id, this.deps.reloj.ahora(), saneado);
      return 'enviados';
    }

    const decision = decidirReintento({ intentos: correo.intentos, ahora: this.deps.reloj.ahora() });
    await this.deps.cola.marcarFallo(correo.id, { error: fallo, decision, datosSaneados: saneado });
    return 'fallidos';
  }

  /** @returns el mensaje del fallo, acotado, o `null` si el proveedor lo acepto. */
  private async intentarEnvio(correo: CorreoPendiente): Promise<string | null> {
    if (correo.contenido === null) {
      return ERROR_DE_DATOS_ILEGIBLES;
    }
    try {
      const { subject, body } = renderizar(correo.contenido, NOMBRE_DEL_PRODUCTO);
      await this.deps.mailer.send({ to: correo.destinatario, subject, body });
      return null;
    } catch (error: unknown) {
      return mensajeDe(error);
    }
  }
}
