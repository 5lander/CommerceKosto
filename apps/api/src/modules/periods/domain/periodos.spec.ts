/**
 * El calendario de períodos y sus transiciones — SPEC §3, D6.
 *
 * **CON LA BASE APAGADA**, como todo el dominio. Lo que se prueba aquí es la
 * frontera del mes, que es el número del que dependen dos cosas que no se
 * pueden arreglar después: qué movimientos quedan sellados al cerrar, y a qué
 * mes pertenece cada compra en los informes de P8.
 */

import { describe, expect, it } from 'vitest';

import {
  ABIERTO,
  CERRADO,
  exigirCerrable,
  exigirReabrible,
} from './cierre';
import {
  MesInvalidoError,
  PeriodoNoCerradoError,
  PeriodoNoTerminadoError,
  PeriodoYaCerradoError,
} from './errores';
import { CalendarioDePeriodos, Periodo } from './periodo';

/** Ecuador no cambia la hora: UTC−5 todo el año (D11). */
const GUAYAQUIL = new CalendarioDePeriodos('America/Guayaquil');

const MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Una sin DST, una del hemisferio norte y una del sur. */
const ZONAS_DE_PRUEBA = ['America/Guayaquil', 'Europe/Madrid', 'America/Santiago'];

describe('la frontera del mes', () => {
  it('marzo de 2026 en Guayaquil va de las 05:00Z del día 1 a las 05:00Z del 1 de abril', () => {
    const marzo = GUAYAQUIL.de(2026, 3);

    expect(marzo.inicioEn.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(marzo.finEn.toISOString()).toBe('2026-04-01T05:00:00.000Z');
    expect(marzo.etiqueta).toBe('2026-03');
  });

  it('diciembre acaba en enero del año siguiente', () => {
    const diciembre = GUAYAQUIL.de(2026, 12);

    expect(diciembre.finEn.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('el intervalo es semiabierto: el instante final ya es del mes siguiente', () => {
    const marzo = GUAYAQUIL.de(2026, 3);

    expect(marzo.contiene(marzo.inicioEn)).toBe(true);
    expect(marzo.contiene(new Date(marzo.finEn.getTime() - 1))).toBe(true);
    expect(marzo.contiene(marzo.finEn)).toBe(false);
  });

  /**
   * EL CASO QUE JUSTIFICA GUARDAR INSTANTES Y NO UN MES.
   *
   * Las 02:00 UTC del 1 de abril son las 21:00 del 31 de marzo en Guayaquil.
   * Un movimiento registrado a esa hora es de MARZO, y quien cerrara marzo sin
   * tener eso en cuenta lo dejaría fuera del mes que acaba de sellar.
   */
  it('un instante UTC de abril que en Guayaquil todavía es marzo pertenece a marzo', () => {
    const periodo = GUAYAQUIL.queContiene(new Date('2026-04-01T02:00:00.000Z'));

    expect(periodo.etiqueta).toBe('2026-03');
  });

  it('cinco horas después, el mismo día ya es abril', () => {
    const periodo = GUAYAQUIL.queContiene(new Date('2026-04-01T05:00:00.000Z'));

    expect(periodo.etiqueta).toBe('2026-04');
  });

  it('el mes anterior a enero es diciembre del año pasado', () => {
    expect(GUAYAQUIL.anterior(GUAYAQUIL.de(2026, 1)).etiqueta).toBe('2025-12');
  });

  it.each(ZONAS_DE_PRUEBA)(
    'en %s, cada frontera de 2026 cae en su propio mes y la siguiente en el otro',
    (zona) => {
      const calendario = new CalendarioDePeriodos(zona);

      for (const mes of MESES) {
        const periodo = calendario.de(2026, mes);

        // Si el desfase se midiera en el instante equivocado, el resultado se
        // iría una hora — y con él, el mes de todo movimiento de esa hora.
        expect(calendario.queContiene(periodo.inicioEn).etiqueta).toBe(periodo.etiqueta);
        expect(calendario.queContiene(new Date(periodo.finEn.getTime() - 1)).etiqueta).toBe(
          periodo.etiqueta,
        );
        expect(calendario.queContiene(periodo.finEn).etiqueta).not.toBe(periodo.etiqueta);
      }
    },
  );

  it.each([
    [2026, 0],
    [2026, 13],
    [1999, 6],
    [2101, 6],
  ])('rechaza el mes %i-%i con un error de dominio', (anio, mes) => {
    expect(() => GUAYAQUIL.de(anio, mes)).toThrow(MesInvalidoError);
  });
});

describe('las transiciones del período', () => {
  const marzo = GUAYAQUIL.de(2026, 3);
  const abrilTerminado = new Date('2026-04-02T00:00:00.000Z');
  const mediadosDeMarzo = new Date('2026-03-15T00:00:00.000Z');

  it('un mes terminado y abierto se puede cerrar', () => {
    expect(() => {
      exigirCerrable({ periodo: marzo, estadoActual: ABIERTO, ahora: abrilTerminado });
    }).not.toThrow();
  });

  /**
   * Cerrar el mes en curso bloquearía sus propios días restantes, y la única
   * salida sería una reapertura que solo el `OWNER` puede hacer.
   */
  it('un mes que todavía no ha terminado no se puede cerrar', () => {
    expect(() => {
      exigirCerrable({ periodo: marzo, estadoActual: ABIERTO, ahora: mediadosDeMarzo });
    }).toThrow(PeriodoNoTerminadoError);
  });

  it('cerrar dos veces el mismo mes se rechaza', () => {
    expect(() => {
      exigirCerrable({ periodo: marzo, estadoActual: CERRADO, ahora: abrilTerminado });
    }).toThrow(PeriodoYaCerradoError);
  });

  it('solo se reabre lo que está cerrado', () => {
    expect(() => {
      exigirReabrible({ periodo: marzo, estadoActual: CERRADO });
    }).not.toThrow();
    expect(() => {
      exigirReabrible({ periodo: marzo, estadoActual: ABIERTO });
    }).toThrow(PeriodoNoCerradoError);
  });

  it('el estado que manda al rehidratar es el guardado, no el que la zona de hoy produciría', () => {
    const guardado = Periodo.reconstruir({
      anio: 2026,
      mes: 3,
      inicioEn: new Date('2026-03-01T05:00:00.000Z'),
      finEn: new Date('2026-04-01T05:00:00.000Z'),
    });

    expect(guardado.contiene(new Date('2026-04-01T02:00:00.000Z'))).toBe(true);
  });
});
