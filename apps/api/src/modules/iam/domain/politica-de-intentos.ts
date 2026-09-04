/**
 * Politica anti fuerza bruta — SEGURIDAD.md §2.1.
 *
 * ES DOMINIO PURO: recibe una lista de fechas y devuelve una decision. No sabe
 * de PostgreSQL, ni de Redis, ni de relojes del sistema — `ahora` entra por
 * parametro. Por eso se puede probar el bloqueo de una hora sin esperar una
 * hora, que es la unica forma de que estas reglas esten probadas de verdad.
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
 * Es un apartamiento de la lectura literal de SEGURIDAD.md §2.1, que da un solo
 * numero para los dos ejes. Esta razonado en ADR-006 y es reversible: son dos
 * constantes.
 */
const UMBRAL_POR_CUENTA = 5;
const UMBRAL_POR_IP = 25;

const MINUTO_MS = 60_000;

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

const UMBRAL_DE: Readonly<Record<EjeDeConteo, number>> = {
  cuenta: UMBRAL_POR_CUENTA,
  ip: UMBRAL_POR_IP,
};

export interface DecisionDeAcceso {
  /** `false` significa: ni siquiera se comprueba la contrasena. */
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
  const { fallos, ahora, eje } = entrada;
  const umbral = UMBRAL_DE[eje];
  if (fallos.length === 0) {
    return PERMITIDO_SIN_FALLOS;
  }

  const desde = (limite: number): Date[] =>
    fallos.filter((f) => ahora.getTime() - f.getTime() <= limite);

  const recientes = desde(VENTANA_DE_DISPARO_MS);
  const paraEscalar = desde(VENTANA_DE_ESCALADA_MS);
  const rondas = Math.floor(paraEscalar.length / umbral);

  if (rondas === 0) {
    return { permitido: true, bloqueadoHasta: null, fallosRecientes: recientes.length };
  }

  const escalon = Math.min(rondas, ESCALA_DE_BLOQUEO_MINUTOS.length) - 1;
  const minutos = ESCALA_DE_BLOQUEO_MINUTOS[escalon] ?? ESCALA_DE_BLOQUEO_MINUTOS[0];

  // El bloqueo cuenta desde el ULTIMO fallo, no desde el primero: cada intento
  // nuevo durante el bloqueo lo reinicia. Insistir alarga la espera.
  const ultimo = paraEscalar.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  const bloqueadoHasta = new Date(ultimo.getTime() + minutos * MINUTO_MS);

  return {
    permitido: ahora.getTime() >= bloqueadoHasta.getTime(),
    bloqueadoHasta,
    fallosRecientes: recientes.length,
  };
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
 * El bloqueo efectivo entre varias decisiones: manda la mas restrictiva.
 *
 * SEGURIDAD.md §2.1 exige contar por cuenta **y** por IP, y el "y" no es
 * decorativo. Contar solo por cuenta deja pasar el rociado de contrasenas —una
 * IP prueba la misma contrasena contra mil correos y ninguna cuenta llega a
 * cinco fallos—; contar solo por IP deja pasar la botnet, que reparte los
 * intentos entre miles de direcciones. Se cuentan los dos ejes y basta con que
 * uno bloquee.
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
