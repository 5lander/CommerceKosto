/**
 * El período contable — SPEC §3 y D6.
 *
 * **EL EXCEL NO TIENE DIMENSIÓN TEMPORAL**: todo es «del mes», un único período
 * implícito. Esta es la extensión que el SaaS necesita para poder comparar un
 * mes con el siguiente y para que el conteo físico congele un corte.
 *
 * **UN PERÍODO SE GUARDA COMO DOS INSTANTES, NO COMO UN MES.** Es la decisión
 * central de este archivo y merece explicarse, porque parece redundante tener
 * `starts_at`/`ends_at` habiendo `anio` y `mes`.
 *
 * `occurred_at` es `timestamptz`: un instante absoluto. Preguntar «¿de qué mes
 * es?» exige una zona horaria, y la respuesta cambia con ella — las 02:00 UTC
 * del 1 de abril son las 21:00 del 31 de marzo en Guayaquil, que es marzo y no
 * abril. Si la zona se aplicara en cada consulta, cambiarla algún día movería
 * de mes movimientos ya cerrados y auditados. Resolviéndola UNA VEZ, al abrir
 * el período, la frontera queda escrita: a partir de ahí todo es una
 * comparación de instantes, en SQL y en TypeScript, sin aritmética de zonas.
 *
 * El intervalo es **semiabierto `[inicioEn, finEn)`**. Un movimiento que caiga
 * exactamente en `finEn` pertenece al mes siguiente, y así ningún instante cae
 * en dos períodos ni se escapa de todos.
 */

import { MesInvalidoError } from './errores';

const PRIMER_MES = 1;
const ULTIMO_MES = 12;
const PRIMER_ANIO = 2000;
const ULTIMO_ANIO = 2100;
const PRIMER_DIA = 1;
const DIGITOS_DEL_MES = 2;

/** Los cuatro datos de un período: el mes y su frontera ya resuelta. */
export interface LimitesDelPeriodo {
  readonly anio: number;
  readonly mes: number;
  readonly inicioEn: Date;
  readonly finEn: Date;
}

/** El mes calendario de una ubicación, con su frontera ya resuelta. */
export class Periodo {
  public readonly anio: number;
  public readonly mes: number;
  public readonly inicioEn: Date;
  public readonly finEn: Date;

  private constructor(limites: LimitesDelPeriodo) {
    this.anio = limites.anio;
    this.mes = limites.mes;
    this.inicioEn = limites.inicioEn;
    this.finEn = limites.finEn;
  }

  /**
   * Rehidrata un período desde sus límites guardados.
   *
   * Lo usa el repositorio: la frontera que manda es la que se escribió al
   * abrirlo, no la que la zona horaria de hoy produciría.
   */
  public static reconstruir(limites: LimitesDelPeriodo): Periodo {
    return new Periodo(limites);
  }

  /** `[inicioEn, finEn)` — semiabierto, para que ningún instante caiga en dos. */
  public contiene(instante: Date): boolean {
    return instante.getTime() >= this.inicioEn.getTime() && instante.getTime() < this.finEn.getTime();
  }

  public haTerminado(ahora: Date): boolean {
    return this.finEn.getTime() <= ahora.getTime();
  }

  /** `2026-03`. Es lo que aparece en los mensajes de error y en los informes. */
  public get etiqueta(): string {
    return `${String(this.anio)}-${String(this.mes).padStart(DIGITOS_DEL_MES, '0')}`;
  }
}

/**
 * Convierte meses en instantes usando una zona horaria concreta.
 *
 * La zona entra por constructor y no se lee de ninguna parte: el dominio no
 * conoce la configuración. Quien la trae es la capa de aplicación, desde
 * `config/periods.ts` (D6).
 */
export class CalendarioDePeriodos {
  public constructor(public readonly zona: string) {}

  /** @throws {MesInvalidoError} */
  public de(anio: number, mes: number): Periodo {
    exigirMesValido(anio, mes);
    const siguiente = mesSiguiente(anio, mes);

    return Periodo.reconstruir({
      anio,
      mes,
      inicioEn: this.medianocheLocal(anio, mes),
      finEn: this.medianocheLocal(siguiente.anio, siguiente.mes),
    });
  }

  /** El mes al que pertenece un instante, según la zona del calendario. */
  public queContiene(instante: Date): Periodo {
    const pared = paredLocal(this.zona, instante);
    return this.de(pared.anio, pared.mes);
  }

  /** El mes anterior. Lo necesita el inventario inicial de SPEC §16. */
  public anterior(periodo: Periodo): Periodo {
    const previo = mesAnterior(periodo.anio, periodo.mes);
    return this.de(previo.anio, previo.mes);
  }

  /** El instante en que empieza el día 1 de ese mes, en la zona del calendario. */
  private medianocheLocal(anio: number, mes: number): Date {
    return instanteDeParedLocal(this.zona, anio, mes);
  }
}

/** @throws {MesInvalidoError} */
function exigirMesValido(anio: number, mes: number): void {
  const mesEnRango = Number.isInteger(mes) && mes >= PRIMER_MES && mes <= ULTIMO_MES;
  const anioEnRango = Number.isInteger(anio) && anio >= PRIMER_ANIO && anio <= ULTIMO_ANIO;

  if (!mesEnRango || !anioEnRango) {
    throw new MesInvalidoError(anio, mes);
  }
}

function mesSiguiente(anio: number, mes: number): { readonly anio: number; readonly mes: number } {
  return mes === ULTIMO_MES ? { anio: anio + 1, mes: PRIMER_MES } : { anio, mes: mes + 1 };
}

function mesAnterior(anio: number, mes: number): { readonly anio: number; readonly mes: number } {
  return mes === PRIMER_MES ? { anio: anio - 1, mes: ULTIMO_MES } : { anio, mes: mes - 1 };
}

/** Las piezas de un instante tal como se leen en el reloj de pared de una zona. */
interface ParedLocal {
  readonly anio: number;
  readonly mes: number;
  readonly dia: number;
  readonly hora: number;
  readonly minuto: number;
  readonly segundo: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  const existente = formateadores.get(zona);
  if (existente !== undefined) return existente;

  const nuevo = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formateadores.set(zona, nuevo);
  return nuevo;
}

/**
 * `Number.parseInt` y no `Number(...)`: aquí no hay ningún decimal en juego
 * —son enteros de calendario— y la regla `no-coercion-numerica-en-dominio`
 * existe para impedir que un valor exacto del mundo decimal caiga al binario.
 * Un año y un mes no tienen esa propiedad que perder.
 */
function paredLocal(zona: string, instante: Date): ParedLocal {
  const partes = new Map<string, string>(
    formateador(zona)
      .formatToParts(instante)
      .map((parte) => [parte.type, parte.value]),
  );
  const entero = (nombre: string): number => Number.parseInt(partes.get(nombre) ?? '0', 10);

  return {
    anio: entero('year'),
    mes: entero('month'),
    dia: entero('day'),
    hora: entero('hour'),
    minuto: entero('minute'),
    segundo: entero('second'),
  };
}

/** Milisegundos que la zona va por delante de UTC en ese instante. */
function desfaseEnMs(zona: string, instante: Date): number {
  const pared = paredLocal(zona, instante);
  const comoSiFueraUtc = Date.UTC(
    pared.anio,
    pared.mes - 1,
    pared.dia,
    pared.hora,
    pared.minuto,
    pared.segundo,
  );
  return comoSiFueraUtc - instante.getTime();
}

/**
 * El instante en que el reloj de pared de `zona` marca el día 1 de ese mes.
 *
 * **DOS PASADAS, Y LA SEGUNDA NO ES PARANOIA.** El desfase que hay que restar
 * depende del instante en que se mide, y en una zona con horario de verano el
 * de la primera estimación puede no ser el del resultado. Ecuador no cambia la
 * hora, así que aquí las dos pasadas dan lo mismo; la segunda existe para que
 * el cálculo siga siendo correcto el día que este producto se venda en Chile o
 * en España.
 *
 * Lo que lo comprueba es una propiedad, no un caso: la prueba recorre los doce
 * meses de 2026 en tres zonas —una sin DST, una del hemisferio norte y una del
 * sur— y exige que cada frontera vuelva a caer en su propio mes y que el
 * instante siguiente caiga en el otro. Un desfase mal medido rompe eso por una
 * hora, que es exactamente el tamaño del error que se busca.
 */
function instanteDeParedLocal(zona: string, anio: number, mes: number): Date {
  const supuesto = Date.UTC(anio, mes - 1, PRIMER_DIA);
  const primeraPasada = supuesto - desfaseEnMs(zona, new Date(supuesto));
  return new Date(supuesto - desfaseEnMs(zona, new Date(primeraPasada)));
}
