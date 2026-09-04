/**
 * La politica anti fuerza bruta, probada sin esperar ni un segundo real: `ahora`
 * entra por parametro. Un bloqueo de una hora se comprueba en un milisegundo.
 */

import { describe, expect, it } from 'vitest';

import {
  VENTANA_A_CONSULTAR_MS,
  bloqueoEfectivo,
  cruzaUmbralDeBloqueo,
  evaluarIntentos,
  type DecisionDeAcceso,
} from './politica-de-intentos';

const AHORA = new Date('2026-09-04T12:00:00.000Z');
const MINUTO = 60_000;

/** @param minutosAtras cuantos minutos antes de `AHORA` ocurrio cada fallo */
function fallos(...minutosAtras: readonly number[]): Date[] {
  return minutosAtras.map((m) => new Date(AHORA.getTime() - m * MINUTO));
}

function evaluar(lista: readonly Date[], ahora: Date = AHORA) {
  return evaluarIntentos({ fallos: lista, ahora, eje: 'cuenta' });
}

describe('evaluarIntentos', () => {
  it('sin fallos, permite', () => {
    expect(evaluar([])).toEqual({ permitido: true, bloqueadoHasta: null, fallosRecientes: 0 });
  });

  it('cuatro fallos en la ventana todavia permiten: el umbral es cinco', () => {
    const decision = evaluar(fallos(1, 2, 3, 4));

    expect(decision.permitido).toBe(true);
    expect(decision.bloqueadoHasta).toBeNull();
    expect(decision.fallosRecientes).toBe(4);
  });

  it('cinco fallos abren el primer bloqueo, de un minuto', () => {
    // El bloqueo cuenta desde el ULTIMO fallo, que aqui es hace 1 minuto.
    const decision = evaluar(fallos(5, 4, 3, 2, 1));

    expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() - 1 * MINUTO + 1 * MINUTO));
    expect(decision.permitido).toBe(true); // el minuto ya paso justo
  });

  it('durante el bloqueo NO permite, y dice hasta cuando', () => {
    const decision = evaluar(fallos(4, 3, 2, 1, 0));

    expect(decision.permitido).toBe(false);
    expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 1 * MINUTO));
  });

  describe('la escalada 1 → 5 → 15 → 60', () => {
    it.each([
      ['segunda ronda', 10, 5],
      ['tercera ronda', 15, 15],
      ['cuarta ronda', 20, 60],
    ])('%s: %i fallos bloquean %i minutos', (_caso, cuantos, minutosEsperados) => {
      const lista = fallos(...Array.from({ length: cuantos }, () => 0));

      const decision = evaluar(lista);

      expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + minutosEsperados * MINUTO));
    });

    it('mas alla de la cuarta ronda se queda en 60 minutos, no crece sin limite', () => {
      const lista = fallos(...Array.from({ length: 100 }, () => 0));

      expect(evaluar(lista).bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 60 * MINUTO));
    });
  });

  describe('las dos ventanas', () => {
    it('un fallo de hace 20 minutos NO cuenta para el disparo', () => {
      const decision = evaluar(fallos(20, 3, 2, 1));

      expect(decision.fallosRecientes).toBe(3);
    });

    it('...pero SI cuenta para la escalada', () => {
      // Es lo que impide el ataque por goteo: esperar a que caduquen los quince
      // minutos para volver a empezar en el escalon mas bajo, indefinidamente.
      const decision = evaluar(fallos(50, 45, 40, 35, 30, 4, 3, 2, 1, 0));

      expect(decision.permitido).toBe(false);
      expect(decision.bloqueadoHasta).toEqual(new Date(AHORA.getTime() + 5 * MINUTO));
    });

    it('un fallo de hace dos horas ya no cuenta para nada', () => {
      const lista = fallos(...Array.from({ length: 10 }, (_v, i) => 120 + i));

      expect(evaluar(lista)).toEqual({ permitido: true, bloqueadoHasta: null, fallosRecientes: 0 });
    });
  });

  describe('insistir durante el bloqueo lo alarga', () => {
    it('un intento nuevo reinicia la cuenta atras', () => {
      const sinInsistir = evaluar(fallos(5, 4, 3, 2, 1));
      const insistiendo = evaluar(fallos(5, 4, 3, 2, 1, 0));

      const antes = sinInsistir.bloqueadoHasta?.getTime() ?? 0;
      const despues = insistiendo.bloqueadoHasta?.getTime() ?? 0;

      expect(despues).toBeGreaterThan(antes);
    });
  });

  it('la ventana que el adaptador debe consultar cubre la escalada entera', () => {
    // Si la consulta mirase solo los 15 minutos del disparo, la escalada nunca
    // pasaria de la primera ronda y el bloqueo se quedaria en un minuto.
    expect(VENTANA_A_CONSULTAR_MS).toBe(60 * MINUTO);
  });
});

describe('bloqueoEfectivo', () => {
  const PRONTO = new Date('2026-09-03T12:01:00.000Z');
  const TARDE = new Date('2026-09-03T13:00:00.000Z');

  const permitido: DecisionDeAcceso = { permitido: true, bloqueadoHasta: null, fallosRecientes: 0 };

  it('sin bloqueos devuelve null', () => {
    expect(bloqueoEfectivo([permitido, permitido])).toBeNull();
  });

  it('con uno bloqueado, manda ese aunque el otro permita', () => {
    const porIp: DecisionDeAcceso = { permitido: false, bloqueadoHasta: PRONTO, fallosRecientes: 5 };

    expect(bloqueoEfectivo([permitido, porIp])).toBe(PRONTO);
  });

  it('con los dos bloqueados manda el que termina MAS TARDE', () => {
    const a: DecisionDeAcceso = { permitido: false, bloqueadoHasta: PRONTO, fallosRecientes: 5 };
    const b: DecisionDeAcceso = { permitido: false, bloqueadoHasta: TARDE, fallosRecientes: 20 };

    expect(bloqueoEfectivo([a, b])).toBe(TARDE);
  });
});

describe('cruzaUmbralDeBloqueo', () => {
  it('el quinto fallo abre el bloqueo', () => {
    expect(cruzaUmbralDeBloqueo(4)).toBe(true);
  });

  it('los cuatro primeros no', () => {
    expect([0, 1, 2, 3].map(cruzaUmbralDeBloqueo)).toEqual([false, false, false, false]);
  });

  it('el decimo escala, y avisa otra vez', () => {
    expect(cruzaUmbralDeBloqueo(9)).toBe(true);
  });

  it('el sexto NO avisa: el aviso es de transicion, no de cada intento', () => {
    expect(cruzaUmbralDeBloqueo(5)).toBe(false);
  });
});

describe('el umbral depende del eje', () => {
  /** Cinco fallos, todos ahora mismo: el bloqueo cuenta desde el ultimo. */
  const CINCO = fallos(0, 0, 0, 0, 0);

  it('cinco fallos bloquean una CUENTA', () => {
    expect(evaluarIntentos({ fallos: CINCO, ahora: AHORA, eje: 'cuenta' }).permitido).toBe(false);
  });

  it('los mismos cinco NO bloquean una IP: detras hay una cocina entera', () => {
    // Con el umbral de cuenta, cinco errores repartidos entre cinco empleados
    // del mismo local dejarian al LOCAL COMPLETO fuera, y la escalada lo
    // mantendria una hora. Cualquiera podria dispararlo desde la acera.
    expect(evaluarIntentos({ fallos: CINCO, ahora: AHORA, eje: 'ip' }).permitido).toBe(true);
  });

  it('veinticinco si bloquean la IP: eso ya es rociado de contrasenas', () => {
    const veinticinco = fallos(...Array.from({ length: 25 }, () => 0));

    expect(evaluarIntentos({ fallos: veinticinco, ahora: AHORA, eje: 'ip' }).permitido).toBe(false);
  });
});
