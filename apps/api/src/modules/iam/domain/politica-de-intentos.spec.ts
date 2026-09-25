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
  evaluarRociadoPorIp,
  type DecisionDeAcceso,
} from './politica-de-intentos';

const AHORA = new Date('2026-09-04T12:00:00.000Z');
const MINUTO = 60_000;

/** @param minutosAtras cuantos minutos antes de `AHORA` ocurrio cada fallo */
function fallos(...minutosAtras: readonly number[]): Date[] {
  return minutosAtras.map((m) => new Date(AHORA.getTime() - m * MINUTO));
}

function evaluar(lista: readonly Date[], ahora: Date = AHORA) {
  return evaluarIntentos({ fallos: lista, ahora });
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

describe('la cuenta se bloquea; la IP solo se limita (D-16.196)', () => {
  /** Cinco fallos, todos ahora mismo: el bloqueo cuenta desde el ultimo. */
  const CINCO = fallos(0, 0, 0, 0, 0);

  /** `cuentas` correos distintos, `porCuenta` fallos cada uno, hace `hace` minutos. */
  const desdeUnaIp = (cuentas: number, porCuenta = 1, hace = 0): { at: Date; email: string }[] =>
    Array.from({ length: cuentas }, (_, n) =>
      Array.from({ length: porCuenta }, () => ({
        at: new Date(AHORA.getTime() - hace * MINUTO),
        email: `empleado${String(n)}@snacklab.ec`,
      })),
    ).flat();

  it('cinco fallos bloquean una CUENTA', () => {
    expect(evaluarIntentos({ fallos: CINCO, ahora: AHORA }).permitido).toBe(false);
  });

  /**
   * 🔴 Lo que hacia antes el eje de IP contando FALLOS: una sola cuenta —mil
   * intentos de un cocinero con la contrasena vieja— dejaba fuera a todo el que
   * saliera por esa IP. Su cuenta ya esta bloqueada por su propio eje.
   */
  it('🔴 mil fallos de UNA cuenta no limitan la IP', () => {
    expect(evaluarRociadoPorIp({ fallos: desdeUnaIp(1, 1000), ahora: AHORA }).permitido).toBe(true);
  });

  it('cinco empleados equivocados tampoco: detras de una IP hay una cocina entera', () => {
    expect(evaluarRociadoPorIp({ fallos: desdeUnaIp(5), ahora: AHORA }).permitido).toBe(true);
  });

  /**
   * 🔴 D-16.199. El umbral se calibra para lo COMPARTIDO: doce cuentas
   * distintas fallando en una hora las junta cualquier lunes por la manana
   * detras de un CGNAT o del wifi de un centro comercial. Si eso limitara, el
   * eje volveria a ser lo que INC-027 quito: una denegacion de servicio para
   * terceros.
   */
  it('🔴 doce cuentas distintas con un fallo cada una NO limitan la IP', () => {
    const limite = evaluarRociadoPorIp({ fallos: desdeUnaIp(12), ahora: AHORA });

    expect(limite.permitido).toBe(true);
    expect(limite.cuentasDistintas).toBe(12);
  });

  it('🔴 cincuenta si limitan: eso ya es rociado de contrasenas', () => {
    const limite = evaluarRociadoPorIp({ fallos: desdeUnaIp(50), ahora: AHORA });

    expect(limite.permitido).toBe(false);
    expect(limite.cuentasDistintas).toBe(50);
  });

  /**
   * 🔴 Cuentas, NUNCA intentos (D-16.199): diez correos insistiendo cuarenta
   * veces cada uno son cuatrocientos fallos y siguen siendo diez cuentas. Si
   * alguien vuelve a contar intentos, esta se pone en rojo.
   */
  it('🔴 cuatrocientos fallos de diez cuentas siguen siendo diez cuentas', () => {
    const limite = evaluarRociadoPorIp({ fallos: desdeUnaIp(10, 40), ahora: AHORA });

    expect(limite.cuentasDistintas).toBe(10);
    expect(limite.permitido).toBe(true);
  });

  it('🔴 y NO escala: cien cuentas esperan lo mismo que cincuenta', () => {
    const cincuenta = evaluarRociadoPorIp({ fallos: desdeUnaIp(50), ahora: AHORA });
    const cien = evaluarRociadoPorIp({ fallos: desdeUnaIp(100), ahora: AHORA });

    expect(cien.hasta?.getTime()).toBe(cincuenta.hasta?.getTime());
  });

  it('el enfriamiento son quince minutos desde el ultimo fallo, y luego se pasa', () => {
    const recien = evaluarRociadoPorIp({ fallos: desdeUnaIp(50, 1, 14), ahora: AHORA });
    const pasado = evaluarRociadoPorIp({ fallos: desdeUnaIp(50, 1, 16), ahora: AHORA });

    expect(recien.permitido).toBe(false);
    expect(pasado.permitido).toBe(true);
  });

  it('fuera de la ventana de una hora, las cuentas ya no cuentan', () => {
    expect(evaluarRociadoPorIp({ fallos: desdeUnaIp(50, 1, 61), ahora: AHORA }).permitido).toBe(true);
  });
});
