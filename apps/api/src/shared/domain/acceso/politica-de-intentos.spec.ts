/**
 * La politica generalizada, probada con numeros que NO son los del login: si
 * los umbrales estuvieran cableados dentro, estas pruebas lo dirian. Los del
 * login siguen probandose en `iam/domain/politica-de-intentos.spec.ts` con los
 * mismos resultados de siempre, que es la otra mitad de la garantia.
 */

import { describe, expect, it } from 'vitest';

import {
  MINUTO_MS,
  abreBloqueo,
  bloqueoEfectivo,
  evaluarIntentos,
  golpesQueDeciden,
  type DecisionDeAcceso,
  type PoliticaDeIntentos,
} from './politica-de-intentos';

const AHORA = new Date('2026-09-10T12:00:00.000Z');

/** Tres por hora, bloqueo de una hora: la del destinatario del limite de tasa. */
const TRES_POR_HORA: PoliticaDeIntentos = {
  umbral: 3,
  ventanaDeDisparoMs: 60 * MINUTO_MS,
  ventanaDeEscaladaMs: 60 * MINUTO_MS,
  escalaDeBloqueoMinutos: [60],
};

/** Una escala de dos escalones, para ver que la ultima se repite. */
const CON_ESCALA: PoliticaDeIntentos = {
  umbral: 2,
  ventanaDeDisparoMs: 10 * MINUTO_MS,
  ventanaDeEscaladaMs: 30 * MINUTO_MS,
  escalaDeBloqueoMinutos: [2, 7],
};

function fallos(...minutosAtras: readonly number[]): Date[] {
  return minutosAtras.map((m) => new Date(AHORA.getTime() - m * MINUTO_MS));
}

describe('evaluarIntentos con una politica por parametro', () => {
  it('sin fallos, permite', () => {
    expect(evaluarIntentos({ fallos: [], ahora: AHORA, politica: TRES_POR_HORA })).toEqual({
      permitido: true,
      bloqueadoHasta: null,
      fallosRecientes: 0,
    });
  });

  it('por debajo del umbral permite, y cuenta los recientes', () => {
    const decision = evaluarIntentos({ fallos: fallos(5, 3), ahora: AHORA, politica: TRES_POR_HORA });

    expect(decision.permitido).toBe(true);
    expect(decision.bloqueadoHasta).toBeNull();
    expect(decision.fallosRecientes).toBe(2);
  });

  it('en el umbral bloquea el tiempo del primer escalon, contado desde el ULTIMO fallo', () => {
    const decision = evaluarIntentos({ fallos: fallos(40, 20, 5), ahora: AHORA, politica: TRES_POR_HORA });

    expect(decision.permitido).toBe(false);
    expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 55 * MINUTO_MS));
  });

  it('un fallo fuera de la ventana de escalada no cuenta para nada', () => {
    const decision = evaluarIntentos({ fallos: fallos(61, 20, 5), ahora: AHORA, politica: TRES_POR_HORA });

    expect(decision.permitido).toBe(true);
    expect(decision.fallosRecientes).toBe(2);
  });

  it('cuando el bloqueo caduca vuelve a permitir, aunque los fallos sigan en la ventana', () => {
    // Tres fallos con umbral 2 = una ronda: 2 minutos contados desde el ultimo
    // fallo, que fue hace 3. El bloqueo ya paso, y se dice cuando termino.
    const decision = evaluarIntentos({ fallos: fallos(9, 8, 3), ahora: AHORA, politica: CON_ESCALA });

    expect(decision.permitido).toBe(true);
    expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() - 1 * MINUTO_MS));
  });

  describe('la escala', () => {
    it('la segunda ronda usa el segundo escalon', () => {
      const decision = evaluarIntentos({ fallos: fallos(4, 3, 2, 1), ahora: AHORA, politica: CON_ESCALA });

      expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 6 * MINUTO_MS));
    });

    it('mas alla del ultimo escalon se repite el ultimo, no crece sin limite', () => {
      const lista = fallos(...Array.from({ length: 20 }, () => 0));

      const decision = evaluarIntentos({ fallos: lista, ahora: AHORA, politica: CON_ESCALA });

      expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 7 * MINUTO_MS));
    });

    it('los fallos fuera de la ventana de disparo pero dentro de la de escalada SI escalan', () => {
      // Dos fallos hace 25 min (fuera de los 10 de disparo) y dos ahora: dos
      // rondas. Es lo que impide el goteo.
      const decision = evaluarIntentos({ fallos: fallos(25, 24, 1, 0), ahora: AHORA, politica: CON_ESCALA });

      expect(decision.permitido).toBe(false);
      expect(decision.fallosRecientes).toBe(2);
      expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 7 * MINUTO_MS));
    });
  });

  it('insistir durante el bloqueo lo alarga', () => {
    const sinInsistir = evaluarIntentos({ fallos: fallos(3, 2, 1), ahora: AHORA, politica: TRES_POR_HORA });
    const insistiendo = evaluarIntentos({ fallos: fallos(3, 2, 1, 0), ahora: AHORA, politica: TRES_POR_HORA });

    const antes = sinInsistir.bloqueadoHasta?.getTime() ?? 0;
    const despues = insistiendo.bloqueadoHasta?.getTime() ?? 0;

    expect(despues).toBeGreaterThan(antes);
  });
});

describe('golpesQueDeciden', () => {
  it('es umbral × escalones + 1', () => {
    expect(golpesQueDeciden(TRES_POR_HORA)).toBe(4);
    expect(golpesQueDeciden(CON_ESCALA)).toBe(5);
  });

  it('con solo los mas recientes, hasta ese tope, la decision es la misma que con todos', () => {
    const todos = fallos(...Array.from({ length: 40 }, (_, i) => i / 2));
    const recientes = [...todos].sort((a, b) => b.getTime() - a.getTime()).slice(0, golpesQueDeciden(CON_ESCALA));

    const conTodos = evaluarIntentos({ fallos: todos, ahora: AHORA, politica: CON_ESCALA });
    const conRecientes = evaluarIntentos({ fallos: recientes, ahora: AHORA, politica: CON_ESCALA });

    expect(conRecientes.permitido).toBe(conTodos.permitido);
    expect(conRecientes.bloqueadoHasta).toEqual(conTodos.bloqueadoHasta);
  });
});

describe('abreBloqueo', () => {
  it('el rechazo con exactamente `umbral` previos es el que abre el bloqueo', () => {
    expect(abreBloqueo(3, TRES_POR_HORA)).toBe(true);
  });

  it('los siguientes rechazos de la misma ronda no: es transicion, no cada intento', () => {
    expect([4, 5, 7, 8].map((n) => abreBloqueo(n, TRES_POR_HORA))).toEqual([false, false, false, false]);
  });

  it('con `2 × umbral` previos escala, y vuelve a ser transicion', () => {
    expect(abreBloqueo(6, TRES_POR_HORA)).toBe(true);
  });

  it('sin previos nunca: cero es multiplo de todo y no abre nada', () => {
    expect(abreBloqueo(0, TRES_POR_HORA)).toBe(false);
  });

  it('un recuento truncado al tope de `golpesQueDeciden` nunca es transicion', () => {
    expect(abreBloqueo(golpesQueDeciden(TRES_POR_HORA), TRES_POR_HORA)).toBe(false);
    expect(abreBloqueo(golpesQueDeciden(CON_ESCALA), CON_ESCALA)).toBe(false);
  });
});

describe('bloqueoEfectivo', () => {
  const PRONTO = new Date('2026-09-10T12:01:00.000Z');
  const TARDE = new Date('2026-09-10T13:00:00.000Z');
  const permitido: DecisionDeAcceso = { permitido: true, bloqueadoHasta: null, fallosRecientes: 0 };

  it('sin bloqueos devuelve null', () => {
    expect(bloqueoEfectivo([permitido, permitido])).toBeNull();
    expect(bloqueoEfectivo([])).toBeNull();
  });

  it('con varios bloqueados manda el que termina MAS TARDE', () => {
    const a: DecisionDeAcceso = { permitido: false, bloqueadoHasta: PRONTO, fallosRecientes: 3 };
    const b: DecisionDeAcceso = { permitido: false, bloqueadoHasta: TARDE, fallosRecientes: 10 };

    expect(bloqueoEfectivo([a, permitido, b])).toBe(TARDE);
  });
});
