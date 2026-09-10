/**
 * Que hace el despachador con un correo que no salio — D-16.46, ADR-025.
 *
 * ES UNA DECISION PURA: entran los intentos que ya se hicieron y el instante,
 * sale el estado siguiente y cuando volver a probar. Nada mas. Quien la ejecuta
 * —el caso de uso— no sabe de minutos ni de topes, y quien la persiste —la cola
 * sobre PostgreSQL— no decide nada: escribe lo que esta funcion dijo.
 *
 * LA ESPERA CRECE (1 → 2 → 4 → 8 minutos) porque un proveedor caido no vuelve
 * en cinco segundos, y golpearlo cada pasada solo consume el limite de tasa de
 * su API. Y HAY UN TOPE, porque un correo que no sale en cinco intentos —un
 * cuarto de hora— no va a salir en el sexto: se marca `FALLIDO`, se guarda el
 * ultimo error como evidencia, y el enlace deja de existir en la base
 * (D-16.34: `datos` saneado). Un correo `PENDIENTE` para siempre seria un token
 * en claro para siempre.
 *
 * Sin la columna `siguiente_intento_en` los cinco reintentos serian cinco
 * pasadas seguidas, a veinticinco segundos el total; por eso existe.
 */

/** Al quinto fallo, `FALLIDO`. Es el tope que fija D-16.46. */
export const INTENTOS_MAXIMOS = 5;

const MILISEGUNDOS_POR_MINUTO = 60_000;

const ESPERA_TRAS_EL_PRIMER_FALLO = 1;
const ESPERA_TRAS_EL_SEGUNDO_FALLO = 2;
const ESPERA_TRAS_EL_TERCER_FALLO = 4;
const ESPERA_TRAS_EL_CUARTO_FALLO = 8;

/**
 * Minutos que se espera tras el fallo numero N (posicion N − 1). Cuatro
 * esperas para cinco intentos: tras el quinto no hay espera, hay `FALLIDO`.
 */
const ESPERA_EN_MINUTOS: readonly number[] = [
  ESPERA_TRAS_EL_PRIMER_FALLO,
  ESPERA_TRAS_EL_SEGUNDO_FALLO,
  ESPERA_TRAS_EL_TERCER_FALLO,
  ESPERA_TRAS_EL_CUARTO_FALLO,
];

export type DecisionDeReintento =
  | {
      readonly estado: 'PENDIENTE';
      /** Los intentos ya hechos, contando este. */
      readonly intentos: number;
      readonly siguienteIntentoEn: Date;
    }
  | {
      readonly estado: 'FALLIDO';
      readonly intentos: number;
      readonly siguienteIntentoEn: null;
    };

/**
 * @param entrada.intentos cuantos envios se habian intentado ANTES de este fallo
 * @param entrada.ahora el instante del fallo, por el puerto `Reloj`
 */
export function decidirReintento(entrada: {
  readonly intentos: number;
  readonly ahora: Date;
}): DecisionDeReintento {
  const intentos = entrada.intentos + 1;
  const espera = ESPERA_EN_MINUTOS[entrada.intentos];

  if (intentos >= INTENTOS_MAXIMOS || espera === undefined) {
    return { estado: 'FALLIDO', intentos, siguienteIntentoEn: null };
  }

  return {
    estado: 'PENDIENTE',
    intentos,
    siguienteIntentoEn: new Date(entrada.ahora.getTime() + espera * MILISEGUNDOS_POR_MINUTO),
  };
}
