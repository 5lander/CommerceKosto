/**
 * Los constructores de identificador son el primer filtro entre el exterior y
 * la base: nada llega a `TenantTransaction` ni a una consulta sin pasar por
 * aqui.
 *
 * La prueba que mas importa es la ultima: **una cadena con forma de inyeccion
 * no llega a ser un identificador.** Es el argumento que sostiene la unica
 * exencion de `no-sql-interpolado` del repositorio — el valor que se interpola
 * en `set_config` no puede ser arbitrario, porque para llegar ahi tuvo que ser
 * un UUID.
 */

import { describe, expect, it } from 'vitest';

import {
  IdentificadorInvalidoError,
  companyId,
  locationId,
  userId,
} from './identificadores';

const UUID_V7 = '0198f3a1-1c2d-7e4f-8a9b-0c1d2e3f4a5b';
const UUID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('identificadores', () => {
  it.each([
    ['companyId', companyId],
    ['locationId', locationId],
    ['userId', userId],
  ])('%s acepta un UUID v7, que es lo que genera la base', (_nombre, construir) => {
    expect(construir(UUID_V7)).toBe(UUID_V7);
  });

  it('acepta tambien un UUID v4', () => {
    // No se comprueba la version a proposito: un identificador venido de una
    // migracion de datos antigua puede ser v4 y sigue siendo legitimo. Lo que
    // se valida es la FORMA.
    expect(companyId(UUID_V4)).toBe(UUID_V4);
  });

  it('normaliza a minusculas, para que dos escrituras del mismo id sean iguales', () => {
    expect(companyId(UUID_V7.toUpperCase())).toBe(UUID_V7);
  });

  describe('lo que rechaza', () => {
    it.each([
      ['vacio', ''],
      ['sin guiones', '0198f3a11c2d7e4f8a9b0c1d2e3f4a5b'],
      ['un digito de menos', '0198f3a1-1c2d-7e4f-8a9b-0c1d2e3f4a5'],
      ['un numero', '12345'],
      ['un correo', 'ana@ejemplo.test'],
      ['con espacios alrededor', ` ${UUID_V7} `],
    ])('rechaza %s', (_caso, valor) => {
      expect(() => companyId(valor)).toThrow(IdentificadorInvalidoError);
    });

    it('RECHAZA una cadena con forma de inyeccion SQL', () => {
      // El identificador acaba viajando a `set_config('app.company_id', $1, TRUE)`
      // como PARAMETRO. Aun asi, la defensa empieza antes: un valor asi no
      // llega a existir como CompanyId.
      const inyeccion = "0198f3a1' , 'x' , TRUE); DROP TABLE company; --";

      expect(() => companyId(inyeccion)).toThrow(IdentificadorInvalidoError);
    });

    it('el mensaje dice que tipo se esperaba y que llego', () => {
      expect(() => locationId('no-soy-un-uuid')).toThrow(/LocationId.*no-soy-un-uuid|no-soy-un-uuid.*LocationId/u);
    });
  });

  describe('la marca nominal', () => {
    it('un CompanyId es una cadena en tiempo de ejecucion', () => {
      // Es lo que permite que viaje al driver de la base sin conversion. La
      // separacion entre CompanyId y LocationId la impone el compilador, no el
      // motor: money.type-contract.ts hace lo propio para el dinero.
      expect(typeof companyId(UUID_V7)).toBe('string');
    });
  });
});
