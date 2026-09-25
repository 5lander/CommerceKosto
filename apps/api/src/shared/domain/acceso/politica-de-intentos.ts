/**
 * Politica de intentos, generalizada — SEGURIDAD.md §2.1, D-16.50.
 *
 * ES LA MISMA REGLA QUE PROTEGE EL LOGIN DESDE P1, con los numeros fuera. Vivia
 * en `iam/domain` con sus umbrales dentro (cuenta 5 / IP 25, ventanas 15 y 60
 * minutos, escala 1 → 5 → 15 → 60), y el limite de tasa de P16-A1 necesita
 * exactamente la misma logica con otros numeros: 10 por hora, 3 por hora. Dos
 * copias de la misma regla son dos oportunidades de que difieran; `shared` no
 * puede importar de un modulo, asi que la regla se muda aqui y `iam` conserva
 * sus constantes y llama.
 *
 * ES DOMINIO PURO: recibe una lista de fechas y una politica, y devuelve una
 * decision. No sabe de PostgreSQL ni de relojes del sistema — `ahora` entra
 * por parametro. Por eso un bloqueo de una hora se prueba en un milisegundo.
 *
 * DOS VENTANAS, Y NO ES REDUNDANCIA:
 *
 *   DISPARO      `umbral` fallos dentro de esta ventana abren un bloqueo.
 *
 *   ESCALADA     la DURACION del bloqueo mira mas atras. Sin esto, quien espera
 *                a que caduque la ventana de disparo vuelve a empezar en el
 *                escalon mas bajo indefinidamente: `umbral` intentos gratis
 *                cada ventana, para siempre.
 *
 * El bloqueo cuenta desde el ULTIMO fallo, no desde el primero: cada intento
 * nuevo durante el bloqueo lo reinicia. Insistir alarga la espera.
 */

export const MINUTO_MS = 60_000;

export interface PoliticaDeIntentos {
  /** Fallos dentro de la ventana de disparo que abren el bloqueo. */
  readonly umbral: number;
  readonly ventanaDeDisparoMs: number;
  /** Cuanto atras se mira para decidir la DURACION. Nunca menor que la de disparo. */
  readonly ventanaDeEscaladaMs: number;
  /** Duracion del bloqueo en minutos, por ronda. La ultima se repite. */
  readonly escalaDeBloqueoMinutos: readonly [number, ...number[]];
}

export interface DecisionDeAcceso {
  /** `false` significa: ni siquiera se hace el trabajo que protege. */
  readonly permitido: boolean;
  /** Cuando vuelve a permitirse. `null` si no hay bloqueo. */
  readonly bloqueadoHasta: Date | null;
  /** Fallos que cuentan para el disparo. Util para el evento de auditoria. */
  readonly fallosRecientes: number;
}

const PERMITIDO_SIN_FALLOS: DecisionDeAcceso = {
  permitido: true,
  bloqueadoHasta: null,
  fallosRecientes: 0,
};

/**
 * @param fallos Fechas de los intentos que cuentan. Quien llama decide desde
 *   cuando: el login descarta lo anterior al ultimo acceso correcto; el limite
 *   de tasa cuenta todo lo que hay en la ventana.
 */
export function evaluarIntentos(entrada: {
  readonly fallos: readonly Date[];
  readonly ahora: Date;
  readonly politica: PoliticaDeIntentos;
}): DecisionDeAcceso {
  const { fallos, ahora, politica } = entrada;
  if (fallos.length === 0) {
    return PERMITIDO_SIN_FALLOS;
  }

  const desde = (limite: number): Date[] =>
    fallos.filter((f) => ahora.getTime() - f.getTime() <= limite);

  const recientes = desde(politica.ventanaDeDisparoMs);
  const paraEscalar = desde(politica.ventanaDeEscaladaMs);
  const rondas = Math.floor(paraEscalar.length / politica.umbral);

  if (rondas === 0) {
    return { permitido: true, bloqueadoHasta: null, fallosRecientes: recientes.length };
  }

  const escala = politica.escalaDeBloqueoMinutos;
  const escalon = Math.min(rondas, escala.length) - 1;
  const minutos = escala[escalon] ?? escala[0];

  const ultimo = paraEscalar.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  const bloqueadoHasta = new Date(ultimo.getTime() + minutos * MINUTO_MS);

  return {
    permitido: ahora.getTime() >= bloqueadoHasta.getTime(),
    bloqueadoHasta,
    fallosRecientes: recientes.length,
  };
}

/**
 * Cuantos intentos, LOS MAS RECIENTES, necesita ver `evaluarIntentos` para
 * decidir lo mismo que veria con todos: `umbral × escalones` fijan la ronda y
 * el escalon; el mas reciente de ellos fija hasta cuando. Uno MAS, para que un
 * recuento que llega al tope se distinga de uno exacto: `abreBloqueo` mira si
 * el recuento es un multiplo del umbral, y con el tope en `umbral × escalones + 1`
 * un recuento truncado nunca lo es.
 *
 * Existe porque quien insiste bloqueado sigue dejando golpes, y leerlos todos
 * en cada peticion convierte su propio bloqueo en coste para la base y para el
 * proceso: a trescientas peticiones por minuto, dieciocho mil filas por hora.
 */
export function golpesQueDeciden(politica: PoliticaDeIntentos): number {
  return politica.umbral * politica.escalaDeBloqueoMinutos.length + 1;
}

/**
 * `true` si, con `fallosPrevios` intentos anteriores, el que se rechaza ahora
 * es el PRIMERO de su ronda: el que abre el bloqueo (`umbral` previos) o lo
 * escala (`2 × umbral`, ...). Es la misma regla que `cruzaUmbralDeBloqueo`
 * en el login, vista desde el intento rechazado y no desde el que completa la
 * ronda.
 *
 * Existe para auditar la TRANSICION y no cada rechazo: un anonimo bloqueado
 * que insiste al ritmo que el limitador global permite escribiria miles de
 * filas por hora en un registro que no se purga nunca. El resto de rechazos
 * quedan en `rate_limit_hit` y en el log de peticiones.
 */
export function abreBloqueo(fallosPrevios: number, politica: PoliticaDeIntentos): boolean {
  return fallosPrevios > 0 && fallosPrevios % politica.umbral === 0;
}

/**
 * El bloqueo efectivo entre varias decisiones: manda la mas restrictiva.
 *
 * SEGURIDAD.md §2.1 exige contar por cuenta **y** por IP, y el "y" no es
 * decorativo. Contar solo por cuenta deja pasar el rociado de contrasenas —una
 * IP prueba la misma contrasena contra mil correos y ninguna cuenta llega al
 * umbral—; contar solo por IP deja pasar la botnet, que reparte los intentos
 * entre miles de direcciones. Se cuentan los ejes que haya y basta con que
 * uno bloquee. El limite de tasa lo usa igual, con IP y destinatario.
 *
 * @returns el momento en que vuelve a permitirse, o `null` si nadie bloquea.
 */
export function bloqueoEfectivo(decisiones: readonly DecisionDeAcceso[]): Date | null {
  const bloqueantes = decisiones
    .filter((d) => !d.permitido)
    .map((d) => d.bloqueadoHasta)
    .filter((hasta): hasta is Date => hasta !== null);

  if (bloqueantes.length === 0) {
    return null;
  }

  return bloqueantes.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}
