/**
 * Lo que el despachador necesita de la cola, y nada mas — ADR-025.
 *
 * CINCO OPERACIONES, y las cinco caben en los privilegios del rol
 * `costeo_despachador`: leer la cola (`SELECT`), reservarla y marcarla
 * (`UPDATE`) y purgar los golpes viejos del limite de tasa (`DELETE ON
 * rate_limit_hit`). No hay `encolar` —de eso se ocupa la aplicacion, dentro de
 * su transaccion— ni `borrar`: un correo fallido se queda como evidencia. Si un
 * dia el puerto necesita una operacion que no quepa en esos privilegios,
 * primero hay que darselos al rol, y esa conversacion es la que este puerto
 * obliga a tener.
 *
 * `tomarPendientes` DEVUELVE EL CONTENIDO YA INTERPRETADO —o `null` si la fila
 * no se deja leer— porque la columna `datos` es un `jsonb` que escribieron la
 * aplicacion y una funcion definer: es un limite externo, y el adaptador lo
 * valida con esquema antes de que llegue aqui. Una fila ilegible no bloquea
 * la cola: el caso de uso la trata como un envio fallido mas, con su reintento
 * y su tope.
 *
 * LA RESERVA SE RENUEVA FILA A FILA. `tomarPendientes` reserva el lote entero
 * de una vez, pero el lote se envia en serie y la reserva es de minutos: con
 * un lote grande y un proveedor lento, las ultimas filas perderian la reserva
 * antes de que la pasada llegara a ellas, y otra instancia (el contenedor
 * viejo durante un redespliegue, o `npm run correo:despachar` a mano) las
 * enviaria tambien. Por eso, justo antes de cada envio, `renovarReserva`
 * vuelve a reservar ESA fila —y solo si su reserva sigue siendo la de esta
 * pasada—. Si devuelve `false`, otra instancia se la quedo: se cede sin
 * enviar y sin marcar.
 */

import type { ContenidoDeCorreo } from '../../../../shared/application/correo/correo-a-encolar';
import type { DecisionDeReintento } from '../../domain/reintentos';
import type { DatosSaneados } from '../../domain/saneado';

export const COLA_DE_CORREO = 'COLA_DE_CORREO';

export interface CorreoPendiente {
  readonly id: string;
  readonly destinatario: string;
  readonly plantilla: string;
  /** `null` cuando `datos` no tiene la forma que su plantilla exige. */
  readonly contenido: ContenidoDeCorreo | null;
  /** Envios ya intentados antes de este. */
  readonly intentos: number;
  /** Hasta cuando lo reservo `tomarPendientes`: la firma de ESTA pasada sobre la fila. */
  readonly reservadoHasta: Date;
}

/** Lo que hace falta para renovar una reserva: la fila y la firma con la que se tomo. */
export type ReservaDeCorreo = Pick<CorreoPendiente, 'id' | 'reservadoHasta'>;

export interface FalloDeEnvio {
  /** Lo que se guarda en `email_outbox.error`: el mensaje, nunca la respuesta del proveedor. */
  readonly error: string;
  readonly decision: DecisionDeReintento;
  /** Se aplica solo si la decision es `FALLIDO` (D-16.34). */
  readonly datosSaneados: DatosSaneados;
}

export interface ColaDeCorreo {
  /**
   * Los correos `PENDIENTE` cuyo turno llego, hasta `lote`, y los reserva para
   * esta pasada: otra pasada concurrente no los vuelve a tomar.
   */
  tomarPendientes(ahora: Date, lote: number): Promise<readonly CorreoPendiente[]>;

  /**
   * Vuelve a reservar UNA fila desde `ahora`, solo si su reserva sigue siendo
   * la de esta pasada. @returns `false` si otra instancia se la quedo.
   */
  renovarReserva(correo: ReservaDeCorreo, ahora: Date): Promise<boolean>;

  /** `ENVIADO`, con su fecha y `datos` saneado (D-16.34). */
  marcarEnviado(id: string, ahora: Date, datos: DatosSaneados): Promise<void>;

  /** Aplica la decision de reintento; si es `FALLIDO`, sanea `datos`. */
  marcarFallo(id: string, fallo: FalloDeEnvio): Promise<void>;

  /** Borra los golpes de `rate_limit_hit` anteriores al instante. @returns cuantos. */
  purgarLimites(antesDe: Date): Promise<number>;
}
