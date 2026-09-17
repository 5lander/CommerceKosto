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
 * CINCO FALLOS BLOQUEAN UNA CUENTA. Es el numero de SEGURIDAD.md §2.1: una
 * persona que falla cinco veces seguidas su propia contrasena o se equivoco de
 * cuenta o no es ella. El bloqueo es de ESA cuenta y no alcanza a nadie mas.
 */
const UMBRAL_POR_CUENTA = 5;

/**
 * EL EJE DE IP LIMITA, NO BLOQUEA — D-16.196, ADR-028, INC-027.
 *
 * Contaba FALLOS (25 en una hora) y abria un bloqueo escalonado igual que el de
 * cuenta, hasta sesenta minutos. Dos cosas iban mal, y las dos se ven desde una
 * cocina:
 *
 *   1. UNA SOLA CUENTA PODIA DEJAR FUERA A TODO EL MUNDO. Un cocinero que
 *      insiste veinticinco veces con la contrasena vieja —o un atacante que le
 *      apunta a el— bloqueaba la IP entera: el resto del personal, con sus
 *      credenciales buenas, se quedaba fuera una hora. Su cuenta ya estaba
 *      bloqueada al quinto fallo; el eje de IP solo anadia victimas.
 *
 *   2. DETRAS DE UNA IP PUEDE NO HABER UN LOCAL, SINO UN BARRIO. Con CGNAT el
 *      operador mete cientos de abonados tras la misma direccion publica: la
 *      IP no identifica a un cliente, y bloquearla castiga a desconocidos.
 *
 * Lo que este eje tiene que cortar es el ROCIADO DE CONTRASENAS: una IP
 * probando "Verano2026" contra cien correos. Esa firma no son "muchos fallos",
 * son MUCHAS CUENTAS DISTINTAS, asi que es lo que se cuenta. Y la respuesta es
 * un 429 de duracion FIJA —esperar y volver—, nunca una escalada: el limite
 * frena el barrido sin convertirse en la denegacion de servicio que cualquiera
 * dispara desde la acera con el wifi del sitio.
 *
 * Y LA IP TIENE QUE SER LA DEL CLIENTE, NO LA DEL PROXY. Detras de Caddy toda
 * peticion llega con la IP del contenedor `caddy`: sin `ipDelCliente` y
 * `PROXY_DE_CONFIANZA` (D-16.49, INC-022) este eje contaria a todos los
 * usuarios como uno solo.
 */
const CUENTAS_DISTINTAS_POR_IP = 10;
const MINUTOS_DE_ENFRIAMIENTO_DE_IP = 15;

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

/** Los numeros del login por CUENTA. El eje de IP ya no bloquea (ver arriba). */
export const POLITICA_DE_LOGIN: PoliticaDeIntentos = {
  umbral: UMBRAL_POR_CUENTA,
  ventanaDeDisparoMs: VENTANA_DE_DISPARO_MS,
  ventanaDeEscaladaMs: VENTANA_DE_ESCALADA_MS,
  escalaDeBloqueoMinutos: ESCALA_DE_BLOQUEO_MINUTOS,
};

/** Un fallo visto desde el eje de IP: cuando, y CONTRA QUE CUENTA. */
export interface FalloPorIp {
  readonly at: Date;
  readonly email: string;
}

export interface LimiteDeIp {
  readonly permitido: boolean;
  /** Hasta cuando se rechaza. `null` si no hay limite. */
  readonly hasta: Date | null;
  /** Cuantas cuentas distintas ha tanteado esa IP en la ventana. */
  readonly cuentasDistintas: number;
}

/**
 * El rociado de contrasenas desde una IP: MUCHAS CUENTAS, no muchos fallos.
 *
 * El enfriamiento cuenta desde el ULTIMO fallo y dura siempre lo mismo: insistir
 * alarga la espera, pero no la agrava. Sin escalada, una IP compartida nunca se
 * queda fuera mas de ese cuarto de hora por lo que hagan otros.
 */
export function evaluarRociadoPorIp(entrada: {
  readonly fallos: readonly FalloPorIp[];
  readonly ahora: Date;
}): LimiteDeIp {
  const enVentana = entrada.fallos.filter(
    (f) => entrada.ahora.getTime() - f.at.getTime() <= VENTANA_DE_ESCALADA_MS,
  );
  const cuentasDistintas = new Set(enVentana.map((f) => f.email)).size;

  if (cuentasDistintas < CUENTAS_DISTINTAS_POR_IP) {
    return { permitido: true, hasta: null, cuentasDistintas };
  }

  const ultimo = enVentana.reduce((a, b) => (a.at.getTime() > b.at.getTime() ? a : b));
  const hasta = new Date(ultimo.at.getTime() + MINUTOS_DE_ENFRIAMIENTO_DE_IP * MINUTO_MS);

  return { permitido: hasta.getTime() <= entrada.ahora.getTime(), hasta, cuentasDistintas };
}

/**
 * @param fallos Fechas de los intentos fallidos **desde el ultimo acceso
 *   correcto**. El adaptador ya descarta lo anterior: un login correcto limpia
 *   la cuenta, que es lo que impide que un usuario legitimo arrastre para
 *   siempre los fallos de un dia malo.
 */
export function evaluarIntentos(entrada: {
  readonly fallos: readonly Date[];
  readonly ahora: Date;
}): DecisionDeAcceso {
  return evaluarConPolitica({
    fallos: entrada.fallos,
    ahora: entrada.ahora,
    politica: POLITICA_DE_LOGIN,
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
