/**
 * Donde el presupuesto de tiempo de CLAUDE.md §5 se puede EXIGIR — INC-016.
 *
 * EL PROBLEMA. El reenvio de puertos de Docker Desktop en Windows se atasca
 * ~300 ms cuando cruza un resultado grande. La misma consulta de 1.600 filas
 * tarda 2 ms dentro del contenedor y da 5 ms o 310 ms —sin nada en medio—
 * desde el host. Las suites de rendimiento corren en el host, asi que sus
 * numeros de TIEMPO nunca han medido el sistema: median ese proxy, y pasaban o
 * fallaban segun le apeteciera. La medicion buena, con la aplicacion y la base
 * en la misma red, da un p95 de ~85 ms contra un presupuesto de 400.
 *
 * POR QUE NO SE DETECTA EL TRANSPORTE Y YA. Se intento, y se descarto por las
 * malas: una sonda que mide el transporte justo antes **no predice** como se va
 * a comportar treinta segundos despues. El atasco aparece y desaparece por
 * minutos enteros. Una sonda asi da falsos verdes y falsos rojos, que es peor
 * que no tenerla, porque ademas parece rigurosa.
 *
 * LO QUE SE HACE EN SU LUGAR, y no esconde nada:
 *
 *   1. **La medicion se ejecuta SIEMPRE** y su numero se imprime siempre. Nadie
 *      pierde de vista el rendimiento por trabajar en Windows.
 *   2. **El presupuesto solo se EXIGE donde la medicion es valida**: en CI, que
 *      corre sobre Linux con el mismo `docker-compose.yml` y sin ese proxy.
 *   3. Fuera de ahi la asercion se salta con el motivo escrito en la salida.
 *
 * LO QUE ESTO **NO** RELAJA. Las aserciones de PLAN —que el indice se use, que
 * no haya `Seq Scan`— corren en todas partes, porque el plan no depende del
 * transporte. Son la mitad que dura, y es literalmente lo que el comentario de
 * esas suites ya decia antes de que esto se descubriera.
 *
 * DEUDA CON FECHA DE PAGO. Esto deja el presupuesto guardado por CI y por nadie
 * mas. Lo que corresponde es un banco de pruebas que mida en la topologia de
 * produccion —`npm run bench`, con la API en la red de compose—, y esta anotado
 * en `ESTADO.md` para P9, que trae su propio presupuesto de 800 ms.
 */

export const SE_EXIGE_EL_PRESUPUESTO = process.env['CI'] !== undefined;

export const MOTIVO_TRANSPORTE =
  'medido e impreso, pero no exigido aqui: el proxy de Docker en Windows falsea el tiempo (INC-016). El presupuesto lo guarda CI';
