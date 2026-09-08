/**
 * El motivo es la tercera condición de SPEC §1, así que se prueba como tal.
 *
 * Sin base de datos: es dominio puro.
 */

import { describe, expect, it } from 'vitest';

import {
  exigirMotivoSuficiente,
  MotivoDemasiadoLargoError,
  MotivoInsuficienteError,
  MAXIMO_DEL_MOTIVO,
  MINIMO_DEL_MOTIVO,
} from './motivo';

const VALIDO = 'El cliente reporta que su food cost salió negativo en marzo';

describe('exigirMotivoSuficiente', () => {
  it('acepta un motivo que de verdad explica algo', () => {
    expect(exigirMotivoSuficiente(VALIDO)).toBe(VALIDO);
  });

  it('recorta los bordes y devuelve lo que se va a guardar', () => {
    expect(exigirMotivoSuficiente(`   ${VALIDO}   `)).toBe(VALIDO);
  });

  it('rechaza lo que se teclea cuando el campo admite cualquier cosa', () => {
    for (const excusa of ['', '-', '.', 'soporte', 'revisar', 'ok']) {
      expect(() => exigirMotivoSuficiente(excusa)).toThrow(MotivoInsuficienteError);
    }
  });

  it('NO cuenta los espacios de los bordes para el mínimo', () => {
    // Veinte espacios y una letra no son un motivo de veintiún caracteres. El
    // `btrim` del CHECK de la base hace exactamente lo mismo, y las dos reglas
    // tienen que coincidir o la base devolvería un 500 donde el dominio dio 400.
    expect(() => exigirMotivoSuficiente(`${' '.repeat(MINIMO_DEL_MOTIVO)}x`)).toThrow(
      MotivoInsuficienteError,
    );
  });

  it('dice cuántos caracteres faltan, no solo que faltan', () => {
    const corto = 'x'.repeat(MINIMO_DEL_MOTIVO - 5);

    expect(() => exigirMotivoSuficiente(corto)).toThrow(/faltan 5/u);
  });

  it('acepta justo el mínimo y rechaza uno menos', () => {
    expect(exigirMotivoSuficiente('x'.repeat(MINIMO_DEL_MOTIVO))).toHaveLength(MINIMO_DEL_MOTIVO);
    expect(() => exigirMotivoSuficiente('x'.repeat(MINIMO_DEL_MOTIVO - 1))).toThrow(
      MotivoInsuficienteError,
    );
  });

  it('acepta justo el máximo y rechaza uno más', () => {
    expect(exigirMotivoSuficiente('x'.repeat(MAXIMO_DEL_MOTIVO))).toHaveLength(MAXIMO_DEL_MOTIVO);
    expect(() => exigirMotivoSuficiente('x'.repeat(MAXIMO_DEL_MOTIVO + 1))).toThrow(
      MotivoDemasiadoLargoError,
    );
  });
});
