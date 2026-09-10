/**
 * Politica anti fuerza bruta del login — SEGURIDAD.md §2.1.
 *
 * LA REGLA VIVE EN `shared/domain/acceso/politica-de-intentos.ts` DESDE
 * P16-A1 (D-16.50): el limite de tasa de los endpoints sin sesion necesita la
 * misma logica con otros numeros, y `shared` no puede importar de un modulo.
 * Aqui quedan LOS NUMEROS DEL LOGIN y las dos funciones que solo el login usa.
 * Sus pruebas siguen en verde sin cambiar de resultado: eso es lo que prueba
 * que la generalizacion no movio nada.
 *
 * DOS VENTANAS, Y NO ES REDUNDANCIA:
 *
 *   DISPARO (15 min)    cinco fallos en quince minutos abren un bloqueo. Es el
 *                       umbral de SEGURIDAD.md §2.1.
 *
 *   ESCALADA (60 min)   la DURACION del bloqueo mira mas atras. Sin esto, quien
 *                       espera a que caduquen los quince minutos vuelve a
 *                       empezar en el escalon mas bajo indefinidamente: cinco
 *                       intentos gratis cada cuarto de hora, para siempre.
 *
 * La escalada 1 → 5 → 15 → 60 minutos hace que el coste de seguir probando
 * crezca mucho mas rapido que el numero de intentos ganados.
 */

import {
  MINUTO_MS,
  evaluarIntentos as evaluarConPolitica,
  type DecisionDeAcceso,
  type PoliticaDeIntentos,
} from '../../../shared/domain/acceso/politica-de-intentos';

export { bloqueoEfectivo, type DecisionDeAcceso } from '../../../shared/domain/acceso/politica-de-intentos';

/**
 * El umbral depende del EJE que se este contando, y la diferencia es
 * deliberada.
 *
 *   CUENTA (5)   es el numero de SEGURIDAD.md §2.1. Una persona que falla cinco
 *                veces seguidas su propia contrasena o se equivoco de cuenta o
 *                no es ella.
 *
 *   IP (25)      cinco veces mas. Detras de una IP no hay una persona: hay una
 *                cocina entera. En un restaurante todo el personal sale por el
 *                mismo NAT, asi que con el umbral de cuenta cinco errores
 *                repartidos entre cinco empleados distintos bloquearian el
 *                LOCAL COMPLETO — y la escalada lo dejaria una hora fuera. Eso
 *                no es seguridad: es una denegacion de servicio que cualquiera
 *                puede disparar desde la acera con el wifi del sitio.
 *
 * Lo que el eje de IP tiene que cortar es el ROCIADO DE CONTRASENAS —una IP
 * probando "Verano2026" contra cien correos distintos— y para eso veinticinco
 * fallos en una hora sigue siendo un techo bajisimo: ningun uso legitimo se
 * acerca.
 *
 * Y LA IP TIENE QUE SER LA DEL CLIENTE, NO LA DEL PROXY. Detras de Caddy toda
 * peticion llega con la IP del contenedor `caddy`: sin `ipDelCliente` y
 * `PROXY_DE_CONFIANZA` (D-16.49, INC-022) este eje bloquearia a todos los
 * usuarios a la vez al vigesimoquinto fallo de cualquiera.
 *
 * Es un apartamiento de la lectura literal de SEGURIDAD.md §2.1, que da un solo
 * numero para los dos ejes. Esta razonado en ADR-006 y es reversible: son dos
 * constantes.
 */
const UMBRAL_POR_CUENTA = 5;
const UMBRAL_POR_IP = 25;

const MINUTOS_DE_DISPARO = 15;
const MINUTOS_DE_ESCALADA = 60;

const VENTANA_DE_DISPARO_MS = MINUTOS_DE_DISPARO * MINUTO_MS;
const VENTANA_DE_ESCALADA_MS = MINUTOS_DE_ESCALADA * MINUTO_MS;

const BLOQUEO_PRIMERA_RONDA = 1;
const BLOQUEO_SEGUNDA_RONDA = 5;
const BLOQUEO_TERCERA_RONDA = 15;
const BLOQUEO_A_PARTIR_DE_LA_CUARTA = 60;

/** Duracion del bloqueo en minutos, segun la ronda. La ultima se repite. */
const ESCALA_DE_BLOQUEO_MINUTOS = [
  BLOQUEO_PRIMERA_RONDA,
  BLOQUEO_SEGUNDA_RONDA,
  BLOQUEO_TERCERA_RONDA,
  BLOQUEO_A_PARTIR_DE_LA_CUARTA,
] as const;

export type EjeDeConteo = 'cuenta' | 'ip';

function politicaDeLogin(umbral: number): PoliticaDeIntentos {
  return {
    umbral,
    ventanaDeDisparoMs: VENTANA_DE_DISPARO_MS,
    ventanaDeEscaladaMs: VENTANA_DE_ESCALADA_MS,
    escalaDeBloqueoMinutos: ESCALA_DE_BLOQUEO_MINUTOS,
  };
}

/** Los numeros del login, por eje. Son la unica diferencia entre los dos ejes. */
export const POLITICA_DE_LOGIN: Readonly<Record<EjeDeConteo, PoliticaDeIntentos>> = {
  cuenta: politicaDeLogin(UMBRAL_POR_CUENTA),
  ip: politicaDeLogin(UMBRAL_POR_IP),
};

/**
 * @param fallos Fechas de los intentos fallidos **desde el ultimo acceso
 *   correcto**. El adaptador ya descarta lo anterior: un login correcto limpia
 *   la cuenta, que es lo que impide que un usuario legitimo arrastre para
 *   siempre los fallos de un dia malo.
 */
export function evaluarIntentos(entrada: {
  readonly fallos: readonly Date[];
  readonly ahora: Date;
  /** Cual de los dos ejes se esta contando. Decide el umbral. */
  readonly eje: EjeDeConteo;
}): DecisionDeAcceso {
  return evaluarConPolitica({
    fallos: entrada.fallos,
    ahora: entrada.ahora,
    politica: POLITICA_DE_LOGIN[entrada.eje],
  });
}

/**
 * Cuanto tiempo atras necesita mirar el adaptador.
 *
 * Vive aqui y no en el repositorio para que la consulta y la regla no puedan
 * separarse: si algun dia la escalada llega a cuatro horas, la consulta se
 * ajusta sola en vez de quedarse corta en silencio.
 */
export const VENTANA_A_CONSULTAR_MS: number = VENTANA_DE_ESCALADA_MS;

/**
 * `true` si el fallo numero `fallosPrevios + 1` es el que abre o escala un
 * bloqueo.
 *
 * Existe para el aviso por correo al titular que pide SEGURIDAD.md §2.1: se
 * envia en la TRANSICION, no en cada intento rechazado. Avisar en cada intento
 * convierte la propia notificacion en el ataque —quien quiera inundar un buzon
 * solo tiene que seguir fallando—, y ademas entrena al titular a ignorarlo.
 */
export function cruzaUmbralDeBloqueo(fallosPrevios: number): boolean {
  return (fallosPrevios + 1) % UMBRAL_POR_CUENTA === 0;
}
