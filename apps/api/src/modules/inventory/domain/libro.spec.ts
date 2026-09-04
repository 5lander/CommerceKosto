/**
 * El libro de inventario, probado con PostgreSQL apagado.
 *
 * Es el criterio arquitectónico de CLAUDE.md §2 aplicado a P6: si para
 * comprobar que una transferencia deja el total de la company intacto hiciera
 * falta levantar la base, las capas estarían mal.
 */

import { describe, expect, it } from 'vitest';

import {
  Money,
  Quantity,
  Ratio,
} from '../../../shared/domain/money/tipos-monetarios';
import { itemId, locationId } from '../../../shared/domain/identity/identificadores';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { corregir, type MovimientoRegistrado } from './correccion';
import {
  CantidadNulaError,
  CicloEnConsumoError,
  CorreccionDeCorreccionError,
  FechaFuturaError,
  ProduccionSinInsumosError,
  SignoIncoherenteError,
  TransferenciaSinDestinoError,
} from './errores';
import { explotarConsumo, type CatalogoDeConsumo, type ItemConsumible } from './explosion';
import {
  DIRECCION_DE,
  conSignoDelTipo,
  exigirFechaPasada,
  exigirSignoCoherente,
  TIPOS_DE_MOVIMIENTO,
  type MovimientoDelLibro,
  type TipoDeMovimiento,
} from './movimiento';
import { producirLote } from './produccion';
import { proyectarSaldoDe, proyectarSaldos } from './saldo';
import { construirTransferencia } from './transferencia';

const KG = unidadDeUso('kg');
const LT = unidadDeUso('lt');

const BODEGA = locationId('11111111-1111-4111-8111-111111111111');
const LOCAL = locationId('22222222-2222-4222-8222-222222222222');

const HARINA = itemId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACEITE = itemId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const SALSA = itemId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const CEBOLLA = itemId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

const EL_DIA_3 = new Date('2026-09-03T12:00:00Z');
const AHORA = new Date('2026-09-04T12:00:00Z');

function kg(valor: string): Quantity {
  return Quantity.of(valor, KG);
}

function movimiento(
  tipo: TipoDeMovimiento,
  ubicacion: typeof BODEGA,
  cantidad: Quantity,
): MovimientoDelLibro {
  return { locationId: ubicacion, itemId: HARINA, tipo, cantidad, ocurridoEn: EL_DIA_3 };
}

describe('el signo lo impone el tipo, no quien captura', () => {
  it('los siete tipos del SPEC, con las dos direcciones bidireccionales exactas', () => {
    expect(TIPOS_DE_MOVIMIENTO).toHaveLength(7);
    // La lista de bidireccionales es la que más caro sale equivocar: un tipo de
    // más aquí desactiva la comprobación de signo para ese tipo.
    expect(TIPOS_DE_MOVIMIENTO.filter((tipo) => DIRECCION_DE[tipo] === 'AMBAS')).toEqual([
      'PRODUCCION',
      'AJUSTE',
    ]);
  });

  it.each([
    ['COMPRA', '10'],
    ['TRANSFERENCIA_ENTRADA', '10'],
  ] as const)('%s entra: la magnitud se conserva positiva', (tipo, valor) => {
    expect(conSignoDelTipo(tipo, kg(valor)).toExactString()).toBe('10');
  });

  it.each([
    ['MERMA', '2.5', '-2.5'],
    ['CONSUMO_POR_VENTA', '0.4', '-0.4'],
    ['TRANSFERENCIA_SALIDA', '7', '-7'],
  ] as const)('%s sale: la magnitud se vuelve negativa sola', (tipo, capturado, esperado) => {
    expect(conSignoDelTipo(tipo, kg(capturado)).toExactString()).toBe(esperado);
  });

  it('AJUSTE respeta el signo que le den, porque es el único bidireccional de captura', () => {
    expect(conSignoDelTipo('AJUSTE', kg('-3')).toExactString()).toBe('-3');
    expect(conSignoDelTipo('AJUSTE', kg('3')).toExactString()).toBe('3');
  });

  it('una compra en negativo se rechaza en vez de restar del saldo', () => {
    expect(() => conSignoDelTipo('COMPRA', kg('-10'))).toThrow(SignoIncoherenteError);
  });

  it.each(TIPOS_DE_MOVIMIENTO)('un movimiento de cero es un hecho que no ocurrió (%s)', (tipo) => {
    expect(() => conSignoDelTipo(tipo, kg('0'))).toThrow(CantidadNulaError);
  });

  it('exigirSignoCoherente valida lo ya firmado, sin cambiarlo', () => {
    expect(exigirSignoCoherente('MERMA', kg('-2')).toExactString()).toBe('-2');
    expect(() => exigirSignoCoherente('MERMA', kg('2'))).toThrow(SignoIncoherenteError);
  });

  it('el libro no admite fecha futura, con un minuto de holgura de reloj', () => {
    const dentroDeLaHolgura = new Date(AHORA.getTime() + 30_000);
    const fuera = new Date(AHORA.getTime() + 120_000);

    expect(exigirFechaPasada(dentroDeLaHolgura, AHORA)).toBe(dentroDeLaHolgura);
    expect(() => exigirFechaPasada(fuera, AHORA)).toThrow(FechaFuturaError);
  });
});

describe('el saldo es una proyección del libro, no un campo', () => {
  it('suma los movimientos de un mismo par (ubicación, ítem)', () => {
    const saldos = proyectarSaldos([
      movimiento('COMPRA', BODEGA, kg('10')),
      movimiento('MERMA', BODEGA, kg('-1.5')),
      movimiento('CONSUMO_POR_VENTA', BODEGA, kg('-2')),
    ]);

    expect(saldos).toHaveLength(1);
    expect(saldos[0]?.cantidad.toExactString()).toBe('6.5');
  });

  it('EL ORDEN NO IMPORTA: la suma decimal es exacta y no redondea', () => {
    const movimientos = [
      movimiento('COMPRA', BODEGA, kg('0.1')),
      movimiento('COMPRA', BODEGA, kg('0.2')),
      movimiento('MERMA', BODEGA, kg('-0.3')),
    ];
    const alReves = [...movimientos].reverse();

    expect(proyectarSaldoDe(movimientos, KG).toExactString()).toBe('0');
    expect(proyectarSaldoDe(alReves, KG).toExactString()).toBe('0');
  });

  it('R2 — el saldo de una ubicación es independiente del de otra', () => {
    const saldos = proyectarSaldos([
      movimiento('COMPRA', BODEGA, kg('10')),
      movimiento('COMPRA', LOCAL, kg('4')),
      movimiento('MERMA', LOCAL, kg('-1')),
    ]);

    const porUbicacion = new Map(saldos.map((s) => [s.locationId, s.cantidad.toExactString()]));
    expect(porUbicacion.get(BODEGA)).toBe('10');
    expect(porUbicacion.get(LOCAL)).toBe('3');
  });

  it('un par que se cancela aparece con CERO, no desaparece', () => {
    const saldos = proyectarSaldos([
      movimiento('COMPRA', BODEGA, kg('5')),
      movimiento('MERMA', BODEGA, kg('-5')),
    ]);

    expect(saldos).toHaveLength(1);
    expect(saldos[0]?.cantidad.isZero()).toBe(true);
  });
});

describe('la transferencia deja el total de la company intacto', () => {
  const par = construirTransferencia({
    origen: BODEGA,
    destino: LOCAL,
    itemId: HARINA,
    cantidad: kg('4'),
    ocurridoEn: EL_DIA_3,
  });

  it('el par suma CERO — es el criterio de aceptación de P6, y por construcción', () => {
    expect(proyectarSaldoDe(par, KG).isZero()).toBe(true);
  });

  it('y sin embargo cambia los saldos de las dos ubicaciones', () => {
    const saldos = new Map(
      proyectarSaldos([movimiento('COMPRA', BODEGA, kg('10')), ...par]).map((s) => [
        s.locationId,
        s.cantidad.toExactString(),
      ]),
    );

    expect(saldos.get(BODEGA)).toBe('6');
    expect(saldos.get(LOCAL)).toBe('4');
  });

  it('transferir a la misma ubicación se rechaza', () => {
    expect(() =>
      construirTransferencia({
        origen: BODEGA,
        destino: BODEGA,
        itemId: HARINA,
        cantidad: kg('4'),
        ocurridoEn: EL_DIA_3,
      }),
    ).toThrow(TransferenciaSinDestinoError);
  });

  it('no hay forma de pedir media transferencia: los dos movimientos salen juntos', () => {
    expect(par).toHaveLength(2);
    expect(par[0].tipo).toBe('TRANSFERENCIA_SALIDA');
    expect(par[1].tipo).toBe('TRANSFERENCIA_ENTRADA');
  });
});

describe('R10 — la preparación se valora al estándar y la varianza queda registrada', () => {
  const lote = producirLote({
    locationId: BODEGA,
    itemId: SALSA,
    cantidadProducida: Quantity.of('5', LT),
    costoEstandarDeUso: Money.fromDecimalString('0.20'),
    insumos: [
      {
        itemId: CEBOLLA,
        cantidad: kg('2'),
        costoNetoDeUso: Money.fromDecimalString('0.50'),
      },
      {
        itemId: ACEITE,
        cantidad: Quantity.of('0.5', LT),
        costoNetoDeUso: Money.fromDecimalString('0.60'),
      },
    ],
    ocurridoEn: EL_DIA_3,
  });

  it('el alta lleva el costo ESTÁNDAR: 5 lt × 0,20 = 1,00', () => {
    expect(lote.costoEstandarDelLote.toExactString()).toBe('1');
    expect(lote.movimientos[0]?.costoTotal.toExactString()).toBe('1');
    expect(lote.movimientos[0]?.movimiento.cantidad.toExactString()).toBe('5');
  });

  it('el costo REAL del lote sale de los insumos: 2×0,50 + 0,5×0,60 = 1,30', () => {
    expect(lote.costoRealDelLote.toExactString()).toBe('1.3');
  });

  it('la varianza es real − estándar, y no toca el valor del inventario', () => {
    expect(lote.varianza.toExactString()).toBe('0.3');
  });

  it('los insumos salen en negativo y el alta entra en positivo', () => {
    const cantidades = lote.movimientos.map((m) => m.movimiento.cantidad.toExactString());
    expect(cantidades).toEqual(['5', '-2', '-0.5']);
  });

  it('LA SUMA DE LOS IMPORTES DEL LOTE ES LA VARIANZA: está en el libro, no se reconstruye', () => {
    const consumos = lote.movimientos.slice(1).map((m) => m.costoTotal);
    const alta = lote.movimientos[0];

    expect(Money.sum(consumos).minus(alta?.costoTotal ?? Money.CERO).toExactString()).toBe(
      lote.varianza.toExactString(),
    );
  });

  it('producir sin insumos deja el costo real en blanco, y se rechaza', () => {
    expect(() =>
      producirLote({
        locationId: BODEGA,
        itemId: SALSA,
        cantidadProducida: Quantity.of('5', LT),
        costoEstandarDeUso: Money.fromDecimalString('0.20'),
        insumos: [],
        ocurridoEn: EL_DIA_3,
      }),
    ).toThrow(ProduccionSinInsumosError);
  });

  it('producir una cantidad negativa se rechaza', () => {
    expect(() =>
      producirLote({
        locationId: BODEGA,
        itemId: SALSA,
        cantidadProducida: Quantity.of('-5', LT),
        costoEstandarDeUso: Money.fromDecimalString('0.20'),
        insumos: [{ itemId: CEBOLLA, cantidad: kg('2'), costoNetoDeUso: Money.CERO }],
        ocurridoEn: EL_DIA_3,
      }),
    ).toThrow(SignoIncoherenteError);
  });
});

describe('R3 — un error se corrige con un movimiento de signo contrario', () => {
  const original: MovimientoRegistrado = {
    ...movimiento('COMPRA', BODEGA, kg('10')),
    corrigeA: null,
  };

  it('la corrección invierte el signo y CONSERVA el tipo', () => {
    const correccion = corregir(original);

    expect(correccion.tipo).toBe('COMPRA');
    expect(correccion.cantidad.toExactString()).toBe('-10');
  });

  it('conservar el tipo es lo que hace que Σ(COMPRA) del mes se cancele solo', () => {
    const saldo = proyectarSaldoDe([original, corregir(original)], KG);
    expect(saldo.isZero()).toBe(true);
  });

  it('la fecha es la del ORIGINAL: corregir no cambia lo que pasó el día 3', () => {
    expect(corregir(original).ocurridoEn).toBe(EL_DIA_3);
  });

  it('corregir una corrección es editar con otro nombre, y se rechaza', () => {
    const yaCorrige: MovimientoRegistrado = { ...original, corrigeA: 'otro-movimiento' };
    expect(() => corregir(yaCorrige)).toThrow(CorreccionDeCorreccionError);
  });
});

describe('el interruptor de stock decide hasta dónde baja el consumo', () => {
  function catalogo(salsaLlevaStock: boolean): CatalogoDeConsumo {
    const salsa: ItemConsumible = {
      llevaStock: salsaLlevaStock,
      receta: [
        { itemId: CEBOLLA, cantidad: Ratio.fromDecimalString('0.3') },
        { itemId: ACEITE, cantidad: Ratio.fromDecimalString('0.1') },
      ],
    };
    return new Map([
      [SALSA, salsa],
      [CEBOLLA, { llevaStock: true, receta: null }],
      [ACEITE, { llevaStock: true, receta: null }],
    ]);
  }

  const recetaDelPlato = [{ itemId: SALSA, cantidad: Ratio.fromDecimalString('2') }];

  it('CON stock propio: se consume la salsa y NO se baja a sus insumos', () => {
    const consumo = explotarConsumo({
      receta: recetaDelPlato,
      unidadesVendidas: Ratio.fromDecimalString('10'),
      catalogo: catalogo(true),
    });

    expect([...consumo.keys()]).toEqual([SALSA]);
    expect(consumo.get(SALSA)?.toExactString()).toBe('20');
  });

  it('SIN stock propio: la salsa desaparece y aparecen su cebolla y su aceite', () => {
    const consumo = explotarConsumo({
      receta: recetaDelPlato,
      unidadesVendidas: Ratio.fromDecimalString('10'),
      catalogo: catalogo(false),
    });

    expect(consumo.has(SALSA)).toBe(false);
    // 10 unidades × 2 de salsa × 0,3 de cebolla
    expect(consumo.get(CEBOLLA)?.toExactString()).toBe('6');
    expect(consumo.get(ACEITE)?.toExactString()).toBe('2');
  });

  it('un ítem que aparece por dos caminos se acumula, no se pisa', () => {
    const consumo = explotarConsumo({
      receta: [
        { itemId: SALSA, cantidad: Ratio.fromDecimalString('2') },
        { itemId: CEBOLLA, cantidad: Ratio.fromDecimalString('1') },
      ],
      unidadesVendidas: Ratio.fromDecimalString('10'),
      catalogo: catalogo(false),
    });

    expect(consumo.get(CEBOLLA)?.toExactString()).toBe('16');
  });

  it('un ciclo se corta con un error que nombra el ítem, no con un desbordamiento', () => {
    const ciclico: CatalogoDeConsumo = new Map([
      [
        SALSA,
        { llevaStock: false, receta: [{ itemId: SALSA, cantidad: Ratio.fromDecimalString('1') }] },
      ],
    ]);

    expect(() =>
      explotarConsumo({
        receta: recetaDelPlato,
        unidadesVendidas: Ratio.fromDecimalString('1'),
        catalogo: ciclico,
      }),
    ).toThrow(CicloEnConsumoError);
  });
});
