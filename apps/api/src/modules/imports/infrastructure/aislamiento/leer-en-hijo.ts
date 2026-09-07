/**
 * El parseo corre en OTRO PROCESO — SEGURIDAD.md §5.4.
 *
 * «El parser de hoja de cálculo corre aislado: proceso separado con timeout y
 * límite de memoria. Un `.xlsx` es un ZIP de XML y los vectores son conocidos
 * —zip bomb, expansión de entidades XML, fórmulas y macros—, así que el parseo
 * va **siempre** en el worker de cola, jamás en el proceso HTTP.»
 *
 * SE CUMPLE CON UN PROCESO HIJO, NO CON UNA COLA, y la decisión está tomada con
 * el usuario y registrada en ADR-013. La primera frase de §5.4 pide «proceso
 * separado con timeout y límite de memoria», y eso es exactamente `fork` con
 * `--max-old-space-size` y un plazo. Lo de «worker de cola» daba por supuesta
 * una cola que este proyecto no tiene: BullMQ y Redis nunca se instalaron, y
 * montarlos para un trabajo de segundos sería un contenedor más que operar.
 *
 * QUÉ APORTA EL AISLAMIENTO, en concreto:
 *
 *   - Una zip bomb que burlara los topes revienta el **hijo**, no la API. El
 *     padre ve un código de salida y responde 400.
 *   - Un bucle infinito en el parseo se corta por el plazo. Sin esto, un solo
 *     archivo dejaría un núcleo al 100 % para siempre.
 *   - El tope de memoria del hijo es suyo: por mucho que pida, el proceso que
 *     atiende peticiones conserva su heap.
 *
 * LO QUE NO APORTA, y conviene no confundirlo: no hay reintentos ni cola de
 * mensajes muertos. Si el análisis falla, el usuario vuelve a subir el archivo.
 * Para un trabajo de segundos disparado por alguien que mira la pantalla, es la
 * respuesta correcta.
 *
 * EL HIJO ES `.mjs` Y VIVE FUERA DE `src/`. La razón es de ejecución y está
 * contada en `parser/lector.mjs`: Node exige extensión explícita para ejecutar
 * TypeScript como ESM, y este paquete es CommonJS con imports sin extensión,
 * así que `fork('hijo.ts')` falla desde el fuente. Se comprobó antes de decidir.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AnalisisAgotadoError, ArchivoIlegibleError } from '../../domain/errores';
import { LIMITES_DEL_ZIP } from '../limites';

/** El plazo. Un archivo de 5.000 filas se analiza en menos de un segundo. */
const PLAZO_MS = 15_000;

/** Megabytes de heap para el hijo. Con el tope del ZIP, sobra. */
const MEMORIA_MB = 192;

/**
 * La ruta del hijo, buscando la raíz del paquete hacia arriba.
 *
 * NI `__dirname` A PELO NI UN NÚMERO FIJO DE `..`. `dist/` refleja `src/`, así
 * que contar directorios funcionaría hoy en los dos sitios y se rompería el día
 * que alguien mueva este archivo — **y se rompería solo en producción**, que es
 * la peor forma de romperse. Buscar el `package.json` no depende de dónde esté
 * este módulo.
 */
function rutaDelHijo(): string {
  let actual = __dirname;

  for (;;) {
    if (existsSync(join(actual, 'package.json'))) return join(actual, 'parser', 'hijo.mjs');

    const padre = dirname(actual);
    if (padre === actual) {
      throw new Error('No se encontró la raíz del paquete para localizar el parser.');
    }
    actual = padre;
  }
}

interface RespuestaDelHijo {
  readonly ok: boolean;
  readonly filas?: readonly (readonly string[])[];
  readonly error?: string;
}

/**
 * Quien contesta primero, gana.
 *
 * Un hijo puede mandar su respuesta **y despues** salir, o morirse sin mandar
 * nada, o pasarse del plazo mientras contesta. Sin una guarda, la promesa se
 * resolveria dos veces —lo segundo se ignora en silencio— y el `clearTimeout`
 * se haria a destiempo, dejando un temporizador vivo que mantiene el proceso
 * despierto. Esto lo convierte en una sola respuesta: la primera.
 */
function unaSolaVez(): (accion: () => void) => void {
  let contestado = false;

  return (accion) => {
    if (contestado) return;
    contestado = true;
    accion();
  };
}

interface Cableado {
  readonly hijo: ChildProcess;
  readonly cerrar: (accion: () => void) => void;
  readonly resolver: (filas: readonly (readonly string[])[]) => void;
  readonly rechazar: (error: Error) => void;
}

/** Los tres desenlaces posibles del hijo, cada uno con su respuesta. */
function cablearRespuestas({ hijo, cerrar, resolver, rechazar }: Cableado): void {
  hijo.on('message', (mensaje: RespuestaDelHijo) => {
    cerrar(() => {
      hijo.kill();
      if (mensaje.ok && mensaje.filas !== undefined) resolver(mensaje.filas);
      else rechazar(new ArchivoIlegibleError(mensaje.error ?? 'No se pudo leer el archivo.'));
    });
  });

  hijo.on('error', () => {
    cerrar(() => {
      rechazar(new ArchivoIlegibleError('No se pudo analizar el archivo.'));
    });
  });

  // SALIR SIN HABER CONTESTADO ES EL HIJO MUERTO: sin memoria, o reventado por
  // el propio archivo. Es el caso que justifica el aislamiento, y aqui se
  // convierte en un 400 en vez de en una caida de la API.
  hijo.on('exit', () => {
    cerrar(() => {
      rechazar(
        new ArchivoIlegibleError(
          'El archivo no se pudo procesar. Puede estar dañado o ser demasiado grande.',
        ),
      );
    });
  });
}

/**
 * Lee el archivo en un proceso aparte y devuelve sus celdas como texto.
 *
 * @throws {AnalisisAgotadoError} si el hijo se pasa del plazo.
 * @throws {ArchivoIlegibleError} si el hijo rechaza el archivo o muere.
 */
export async function leerEnHijo(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
  return new Promise((resolver, rechazar) => {
    const hijo = fork(rutaDelHijo(), {
      // EL HIJO NO HEREDA EL ENTORNO. No necesita la cadena de conexion ni los
      // secretos para leer un ZIP, y darselos seria ampliar la superficie del
      // proceso que trata la entrada hostil — lo contrario de aislarlo.
      env: {},
      execArgv: [`--max-old-space-size=${String(MEMORIA_MB)}`],
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const responder = unaSolaVez();
    const plazo = setTimeout(() => {
      responder(() => {
        hijo.kill('SIGKILL');
        rechazar(new AnalisisAgotadoError());
      });
    }, PLAZO_MS);

    cablearRespuestas({
      hijo,
      cerrar: (accion) => {
        responder(() => {
          clearTimeout(plazo);
          accion();
        });
      },
      resolver,
      rechazar,
    });

    hijo.send({ bytes: Buffer.from(bytes).toString('base64'), limites: LIMITES_DEL_ZIP });
  });
}
