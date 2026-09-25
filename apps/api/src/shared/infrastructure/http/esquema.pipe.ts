/**
 * Validacion por esquema en el limite HTTP — CLAUDE.md §3.
 *
 * TODO ESQUEMA DE ESTE PROYECTO ES `.strict()`, y esa es la decision que
 * importa. El modo por defecto de Zod —ignorar las claves que sobran— convierte
 * la asignacion masiva en un fallo silencioso: un cliente manda `companyId` o
 * `role` de mas, el esquema los tira sin decir nada, y el dia que alguien pase
 * el cuerpo entero a un `update` la clave de mas se escribe. Con `.strict()` la
 * peticion se RECHAZA, y el intento queda registrado en vez de perdido.
 *
 * El pipe no sabe de dominio: recibe un esquema y devuelve el valor tipado. La
 * unica decision que toma es convertir el fallo de Zod en un error de dominio,
 * para que salga por el mismo formato `{ code, message }` que todo lo demas.
 *
 * Y UNA SEGUNDA, ANADIDA EN P15: rechaza los CARACTERES DE CONTROL antes de
 * validar. Ver `exigirSinCaracteresDeControl`.
 *
 * Y UNA TERCERA, DE LA REVISION DE P16-A2: el mensaje de un problema NO es el
 * eco de la peticion. Ver `textoDelProblema`, que es donde `.strict()` deja de
 * devolver las claves sobrantes tal y como llegaron.
 */

import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

import { EntradaInvalidaError } from '../../domain/errors/entrada-invalida';
import { valorParaMensaje } from '../../domain/errors/valor-en-mensaje';

/** Cuantos problemas se enumeran. Mas alla es ruido para quien integra. */
const PROBLEMAS_A_MOSTRAR = 5;

/** Cuantas claves sobrantes se nombran antes de resumir con el numero. */
const CLAVES_A_MOSTRAR = 3;

/** Cuanto se baja en un objeto anidado antes de dejar de mirar. */
const PROFUNDIDAD_MAXIMA = 8;

/**
 * Caracteres de control C0 y C1, salvo tabulador, salto de linea y retorno.
 *
 * El que importa de verdad es el **byte NUL**: PostgreSQL **no puede guardarlo**
 * en una columna de texto, y su rechazo llega al cliente como
 * `INTERNAL_ERROR 500` en vez de como un 400 que diga que el nombre no vale.
 *
 * Lo encontro el pentest de P15 mandando un NUL (`U+0000`) como nombre de item. Es la
 * clase exacta de INC-012 —una restriccion de la base que nadie tradujo— y era
 * alcanzable desde CUALQUIER campo de texto por cualquier usuario autenticado.
 * Un 500 dispara alertas de operacion, cuenta como caida, y le dice a quien
 * prueba que encontro algo que rompe el servidor.
 */
// Los tres de control que SI son texto legitimo. Un nombre de dos lineas o con
// una tabulacion pegada desde una hoja de calculo no tiene por que rechazarse.
const TABULADOR = 0x09;
const SALTO_DE_LINEA = 0x0a;
const RETORNO_DE_CARRO = 0x0d;

/** Fin del bloque C0 (el que empieza en NUL) y limites del bloque C1. */
const FIN_DE_C0 = 0x1f;
const INICIO_DE_C1 = 0x7f;
const FIN_DE_C1 = 0x9f;

/**
 * SE COMPRUEBA POR PUNTO DE CODIGO Y NO CON UNA EXPRESION REGULAR.
 *
 * Una regex con estos caracteres dentro obliga a escribirlos —o a escaparlos— en
 * el fuente, y `no-control-regex` la rechaza precisamente porque casi siempre son
 * un accidente. Aqui no lo son, pero la respuesta correcta no es silenciar la
 * regla: es no necesitarla. Comparar numeros dice lo mismo y se lee mejor.
 */
function esDeControl(codigo: number): boolean {
  if (codigo === TABULADOR || codigo === SALTO_DE_LINEA || codigo === RETORNO_DE_CARRO) {
    return false;
  }
  return codigo <= FIN_DE_C0 || (codigo >= INICIO_DE_C1 && codigo <= FIN_DE_C1);
}

function llevaCaracterDeControl(texto: string): boolean {
  for (let posicion = 0; posicion < texto.length; posicion += 1) {
    if (esDeControl(texto.charCodeAt(posicion))) return true;
  }
  return false;
}

/**
 * Recorre el valor y falla si algun texto lleva un caracter de control.
 *
 * VA EN EL PIPE Y NO EN CADA CAMPO, y es deliberado. Ponerlo campo a campo
 * significa acordarse en el siguiente campo que alguien anada, y ese es
 * exactamente el olvido que no avisa. Ponerlo en un refinamiento de OBJETO
 * seria peor: no se ejecuta si otro campo fallo antes (INC-008). Aqui corre
 * SIEMPRE y antes que nada.
 *
 * @param valor lo que llego por el cable, ya parseado como JSON
 */
function exigirSinCaracteresDeControl(valor: unknown, profundidad = 0): void {
  // RENDIRSE AQUI SERIA DEJAR PASAR LO HONDO. Un `return` en el limite de
  // profundidad convierte el anidamiento en la forma de saltarse la
  // comprobacion: basta con enterrar la cadena nueve niveles. Ningun cuerpo
  // legitimo de esta API baja tanto, asi que se rechaza — la opcion mas
  // restrictiva, que es la que manda ante la duda (CLAUDE.md 4).
  if (profundidad > PROFUNDIDAD_MAXIMA) {
    throw new EntradaInvalidaError(['(cuerpo): la peticion esta anidada mas de lo que se acepta.']);
  }

  if (typeof valor === 'string') {
    if (llevaCaracterDeControl(valor)) {
      throw new EntradaInvalidaError([
        '(cuerpo): hay caracteres de control en un campo de texto. Suelen venir de copiar y ' +
          'pegar desde otro programa; vuelve a escribir el valor a mano.',
      ]);
    }
    return;
  }

  if (Array.isArray(valor)) {
    for (const elemento of valor) exigirSinCaracteresDeControl(elemento, profundidad + 1);
    return;
  }

  if (typeof valor === 'object' && valor !== null) {
    for (const anidado of Object.values(valor)) {
      exigirSinCaracteresDeControl(anidado, profundidad + 1);
    }
  }
}

/** Un problema de Zod, tal y como sale de `safeParse`. */
type Problema = ZodError['issues'][number];

/**
 * EL TEXTO DE UN PROBLEMA, CON UN CASO PROPIO: LAS CLAVES QUE SOBRAN.
 *
 * El mensaje que Zod escribe para `unrecognized_keys` lleva dentro los NOMBRES
 * de las claves sobrantes, verbatim y sin recorte. Como ese texto sale al
 * cliente dentro del 400, un `?<clave de 300 caracteres>=1` volvia entero en el
 * cuerpo de la respuesta: el error convertido en eco de la peticion, que es
 * justo lo que `valorParaMensaje` existe para evitar en la otra puerta de este
 * mismo borde (los mensajes de dominio, P16-A2).
 *
 * Asi que las claves pasan por el mismo filtro —recorte y sin caracteres de
 * control— y solo se nombran las primeras; el numero dice cuantas eran. El
 * texto va en espanol, como el resto del mensaje que las envuelve.
 */
function textoDelProblema(problema: Problema): string {
  if (problema.code !== 'unrecognized_keys') {
    return problema.message;
  }
  const nombradas = problema.keys.slice(0, CLAVES_A_MOSTRAR).map(valorParaMensaje).join(', ');
  return `sobran parametros (${String(problema.keys.length)}): ${nombradas}`;
}

@Injectable()
export class EsquemaPipe<T> implements PipeTransform<unknown, T> {
  public constructor(private readonly esquema: ZodType<T>) {}

  public transform(valor: unknown): T {
    exigirSinCaracteresDeControl(valor);

    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) {
      return resultado.data;
    }

    const problemas = resultado.error.issues
      .slice(0, PROBLEMAS_A_MOSTRAR)
      .map((issue) => `${issue.path.join('.') || '(cuerpo)'}: ${textoDelProblema(issue)}`);

    throw new EntradaInvalidaError(problemas);
  }
}
