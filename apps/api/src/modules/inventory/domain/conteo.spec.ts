/**
 * El conteo físico y su conciliación — SPEC §16 y §18, D7.
 *
 * **CON LA BASE APAGADA.** Lo que se prueba es la aritmética del hallazgo: qué
 * significa no contar un ítem, y cómo se mide cuánto vale lo que sí se contó.
 */

import { describe, expect, it } from 'vitest';

import { itemId as aItemId } from '../../../shared/domain/identity/identificadores';
import { Money, Quantity } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { conciliar, consumoReal, type EntradaDeConciliacion } from './conciliacion';
import { BORRADOR, CONFIRMADO, exigirBorrador, exigirLineasValidas } from './conteo';
import {
  CantidadDeConteoNegativaError,
  ConteoYaConfirmadoError,
  ItemRepetidoEnConteoError,
} from './errores';

const KG = unidadDeUso('kg');

const CEBOLLA = aItemId('01960000-0000-7000-8000-000000000001');
const ACEITE = aItemId('01960000-0000-7000-8000-000000000002');

function kg(valor: string): Quantity {
  return Quantity.of(valor, KG);
}

function usd(valor: string): Money {
  return Money.fromDecimalString(valor);
}

function entrada(datos: {
  readonly itemId: typeof CEBOLLA;
  readonly teorico: string;
  readonly contado: string | null;
  readonly costo: string;
}): EntradaDeConciliacion {
  return {
    itemId: datos.itemId,
    teorico: kg(datos.teorico),
    contado: datos.contado === null ? null : kg(datos.contado),
    costoDeUso: usd(datos.costo),
  };
}

describe('las líneas que se guardan', () => {
  it('cero es un dato: significa «miré y no había»', () => {
    expect(() => {
      exigirLineasValidas([{ itemId: CEBOLLA, cantidad: kg('0') }]);
    }).not.toThrow();
  });

  it('dos líneas del mismo ítem se rechazan: una de las dos es la buena y nadie sabe cuál', () => {
    expect(() => {
      exigirLineasValidas([
        { itemId: CEBOLLA, cantidad: kg('4') },
        { itemId: CEBOLLA, cantidad: kg('6') },
      ]);
    }).toThrow(ItemRepetidoEnConteoError);
  });

  it('contar en negativo se rechaza: es un error de captura, no un hallazgo', () => {
    expect(() => {
      exigirLineasValidas([{ itemId: CEBOLLA, cantidad: kg('-1') }]);
    }).toThrow(CantidadDeConteoNegativaError);
  });

  it('un conteo confirmado ya no admite cambios', () => {
    expect(() => {
      exigirBorrador(BORRADOR);
    }).not.toThrow();
    expect(() => {
      exigirBorrador(CONFIRMADO);
    }).toThrow(ConteoYaConfirmadoError);
  });
});

describe('la conciliación', () => {
  it('la diferencia es lo contado menos lo teórico, valorizada al costo de uso', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '10', contado: '8.5', costo: '2.00' }),
    ]);

    const linea = resultado.lineas[0];
    expect(linea?.diferencia?.toStorageString()).toBe('-1.500000000000');
    expect(linea?.valorDeDiferencia?.toStorageString()).toBe('-3.000000000000');
  });

  it('un stock teórico negativo se concilia igual: es «faltan compras», no un error', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '-3', contado: '2', costo: '1.00' }),
    ]);

    expect(resultado.lineas[0]?.diferencia?.toStorageString()).toBe('5.000000000000');
  });

  /**
   * EL CASO QUE DEFINE D7, Y EL QUE MÁS FÁCIL SE HACE MAL.
   *
   * Un ítem sin línea no vale cero: vale lo que el libro dice. Si valiera cero,
   * no contarlo equivaldría a declarar que se consumió entero, y el consumo
   * real de un conteo parcial se dispararía por no haber mirado un estante.
   */
  it('un ítem sin contar no genera diferencia y aporta su valor TEÓRICO al inventario físico', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '10', contado: '10', costo: '2.00' }),
      entrada({ itemId: ACEITE, teorico: '4', contado: null, costo: '5.00' }),
    ]);

    const aceite = resultado.lineas.find((linea) => linea.itemId === ACEITE);
    expect(aceite?.contado).toBeNull();
    expect(aceite?.diferencia).toBeNull();
    expect(aceite?.valorDeDiferencia).toBeNull();

    // 20 de cebolla contada + 20 de aceite teórico. No 20 + 0.
    expect(resultado.valorFisico.toStorageString()).toBe('40.000000000000');
  });

  it('la cobertura es el valor verificado sobre el valor total, no el número de ítems', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '10', contado: '9', costo: '2.00' }),
      entrada({ itemId: ACEITE, teorico: '12', contado: null, costo: '5.00' }),
    ]);

    // 20 verificados de 80 en total: un ítem de dos, pero solo el 25 % del valor.
    expect(resultado.valorTeorico.toStorageString()).toBe('80.000000000000');
    expect(resultado.valorCubierto.toStorageString()).toBe('20.000000000000');
    expect(resultado.cobertura?.toStorageString()).toBe('0.250000000000');
  });

  it('sin nada que verificar la cobertura es null, no cero por ciento', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '0', contado: '0', costo: '2.00' }),
    ]);

    expect(resultado.cobertura).toBeNull();
  });

  it('un conteo completo y exacto deja el físico igual al teórico', () => {
    const resultado = conciliar([
      entrada({ itemId: CEBOLLA, teorico: '10', contado: '10', costo: '2.00' }),
      entrada({ itemId: ACEITE, teorico: '4', contado: '4', costo: '5.00' }),
    ]);

    expect(resultado.valorFisico.toStorageString()).toBe(resultado.valorTeorico.toStorageString());
    expect(resultado.cobertura?.toStorageString()).toBe('1.000000000000');
  });
});

describe('el consumo real de SPEC §16', () => {
  it('es inicial + compras − final físico', () => {
    const real = consumoReal({
      valorInicial: usd('1000.00'),
      comprasDelPeriodo: usd('4500.00'),
      valorFisico: usd('1200.00'),
    });

    expect(real.toStorageString()).toBe('4300.000000000000');
  });

  it('una merma no contabilizada aparece como consumo real por encima del teórico', () => {
    const conMerma = consumoReal({
      valorInicial: usd('1000.00'),
      comprasDelPeriodo: usd('4500.00'),
      valorFisico: usd('900.00'),
    });

    expect(conMerma.toStorageString()).toBe('4600.000000000000');
  });
});
