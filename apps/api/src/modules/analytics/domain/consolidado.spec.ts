/**
 * El consolidado y las comparativas, con la base APAGADA.
 *
 * La prueba que manda aquí es la del promedio ponderado. Todas las demás
 * comprueban que la suma suma; esa comprueba que **el porcentaje no se
 * promedia**, que es el único error de este paquete capaz de sobrevivir a una
 * revisión: da un número plausible y nadie lo mira dos veces.
 */

import { describe, expect, it } from 'vitest';

import type { ItemId, LocationId, ProductId } from '../../../shared/domain/identity/identificadores';
import { DIVISION } from '../../../shared/domain/decimal/escalas';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import {
  compararCompras,
  compararProductos,
  type CompraObservada,
  type ObservacionDeProducto,
} from './comparativas';
import { consolidar, type AporteDeUbicacion } from './consolidado';

const CENTRO = 'ubicacion-centro' as LocationId;
const NORTE = 'ubicacion-norte' as LocationId;
const SUR = 'ubicacion-sur' as LocationId;

const d = (valor: string): Money => Money.fromDecimalString(valor);
const r = (valor: string): Ratio => Ratio.fromDecimalString(valor);

/**
 * El texto de un decimal que puede no estar.
 *
 * Existe para que las aserciones no encadenen tres `?.` cada una: eso sube la
 * complejidad de la prueba por encima del presupuesto de `audit:complexity`,
 * y una prueba ilegible defiende peor que una legible.
 */
const t = (valor: { toExactString: () => string } | null | undefined): string | null =>
  valor === null || valor === undefined ? null : valor.toExactString();

function aporte(datos: Partial<AporteDeUbicacion> & { locationId: LocationId }): AporteDeUbicacion {
  return {
    nombre: 'sin nombre',
    estadoDelPeriodo: 'CERRADO',
    unidades: Count.CERO,
    ventaNeta: Money.CERO,
    mcTotal: Money.CERO,
    consumoTeorico: Money.CERO,
    consumoReal: Money.CERO,
    comprasDelMes: Money.CERO,
    inventarioFinal: Money.CERO,
    costosFijos: Money.CERO,
    valorVerificado: Money.CERO,
    valorInventariado: Money.CERO,
    ...datos,
  };
}

function consolidadoDe(aportes: readonly AporteDeUbicacion[]): ReturnType<typeof consolidar> {
  return consolidar({ anio: 2026, mes: 3, aportes, sinDatos: [] });
}

describe('consolidado de company', () => {
  describe('LO QUE SUMA: el total es exactamente la suma de las ubicaciones', () => {
    it('las magnitudes aditivas se suman una a una', () => {
      const resultado = consolidadoDe([
        aporte({
          locationId: CENTRO,
          unidades: Count.fromInteger(120),
          ventaNeta: d('1000.00'),
          mcTotal: d('650.00'),
          consumoTeorico: d('280.00'),
          comprasDelMes: d('400.00'),
          costosFijos: d('300.00'),
        }),
        aporte({
          locationId: NORTE,
          unidades: Count.fromInteger(80),
          ventaNeta: d('500.00'),
          mcTotal: d('300.00'),
          consumoTeorico: d('150.00'),
          comprasDelMes: d('220.00'),
          costosFijos: d('180.00'),
        }),
      ]);

      expect(resultado.totales.unidades.toExactString()).toBe('200');
      expect(resultado.totales.ventaNeta.toExactString()).toBe('1500');
      expect(resultado.totales.mcTotal.toExactString()).toBe('950');
      expect(resultado.totales.consumoTeorico.toExactString()).toBe('430');
      expect(resultado.totales.comprasDelMes.toExactString()).toBe('620');
      expect(resultado.totales.costosFijos.toExactString()).toBe('480');
    });

    it('una sola ubicación consolida a sí misma, sin tocar el número', () => {
      const resultado = consolidadoDe([
        aporte({ locationId: CENTRO, ventaNeta: d('1234.56'), consumoTeorico: d('370.368') }),
      ]);

      expect(resultado.totales.ventaNeta.toExactString()).toBe('1234.56');
      expect(resultado.foodCostTeoricoPct?.toExactString()).toBe('0.3');
    });
  });

  describe('LO QUE NO SUMA: el porcentaje se recalcula, nunca se promedia', () => {
    /**
     * EL CASO QUE JUSTIFICA EL PAQUETE. Un local diminuto con un food cost
     * terrible y otro enorme con uno bueno. La media simple dice 55 %; la
     * verdad —la que decide precios— es 30,1 %.
     *
     * Los dos números son plausibles en pantalla. Solo uno es correcto.
     */
    it('un local diminuto con food cost pésimo NO arrastra al consolidado', () => {
      const resultado = consolidadoDe([
        aporte({ locationId: CENTRO, ventaNeta: d('200.00'), consumoTeorico: d('160.00') }),
        aporte({ locationId: NORTE, ventaNeta: d('100000.00'), consumoTeorico: d('30000.00') }),
      ]);

      // 30160 / 100200 = 0.30099800...
      expect(resultado.foodCostTeoricoPct?.toExactString()).toBe('0.300998003992');

      // Y la media simple —(0.80 + 0.30) / 2 = 0.55— queda a 25 puntos.
      const mediaSimple = r('0.80').plus(r('0.30')).dividedBy(r('2'), DIVISION);
      expect(mediaSimple.toExactString()).toBe('0.55');
      expect(resultado.foodCostTeoricoPct?.lessThan(mediaSimple)).toBe(true);
    });

    it('el margen consolidado sale de los totales, y R6 se sostiene sobre ellos', () => {
      const resultado = consolidadoDe([
        aporte({ locationId: CENTRO, ventaNeta: d('700.00'), mcTotal: d('455.00') }),
        aporte({ locationId: NORTE, ventaNeta: d('300.00'), mcTotal: d('120.00') }),
      ]);

      expect(resultado.margenPct?.toExactString()).toBe('0.575');
    });

    it('la cobertura también es ponderada por valor, no por ubicación (D7)', () => {
      const resultado = consolidadoDe([
        aporte({
          locationId: CENTRO,
          valorVerificado: d('50.00'),
          valorInventariado: d('1000.00'),
        }),
        aporte({
          locationId: NORTE,
          valorVerificado: d('900.00'),
          valorInventariado: d('1000.00'),
        }),
      ]);

      // 950 / 2000, no (0.05 + 0.90) / 2 = 0.475. Aquí coinciden a propósito en
      // el primer decimal: lo que se comprueba es de dónde sale el número.
      expect(resultado.cobertura?.toExactString()).toBe('0.475');
    });

    it('sin venta neta no hay porcentaje: null, nunca cero', () => {
      const resultado = consolidadoDe([
        aporte({ locationId: CENTRO, consumoTeorico: d('80.00') }),
      ]);

      expect(resultado.foodCostTeoricoPct).toBeNull();
      expect(resultado.margenPct).toBeNull();
    });
  });

  describe('el estado del período viaja con el número (ADR-010 §1)', () => {
    it('cuenta cuántas ubicaciones tienen el mes cerrado y cuántas abierto', () => {
      const resultado = consolidadoDe([
        aporte({ locationId: CENTRO, estadoDelPeriodo: 'CERRADO' }),
        aporte({ locationId: NORTE, estadoDelPeriodo: 'ABIERTO' }),
        aporte({ locationId: SUR, estadoDelPeriodo: 'ABIERTO' }),
      ]);

      expect(resultado.cerradas).toBe(1);
      expect(resultado.abiertas).toBe(2);
    });

    it('una ubicación sin datos se aparta y se nombra: NO entra como cero', () => {
      const resultado = consolidar({
        anio: 2026,
        mes: 3,
        aportes: [
          aporte({ locationId: CENTRO, ventaNeta: d('1000.00'), consumoTeorico: d('300.00') }),
        ],
        sinDatos: [{ locationId: NORTE, nombre: 'Norte' }],
      });

      expect(resultado.sinDatos).toHaveLength(1);
      expect(resultado.ubicaciones).toHaveLength(1);
      // Si Norte entrara como cero, el food cost bajaría por no haber mirado.
      expect(resultado.foodCostTeoricoPct?.toExactString()).toBe('0.3');
    });
  });
});

describe('comparativa del mismo producto entre ubicaciones', () => {
  const PLATO = 'producto-ceviche' as ProductId;

  function observacion(
    datos: Partial<ObservacionDeProducto> & { locationId: LocationId },
  ): ObservacionDeProducto {
    return {
      productId: PLATO,
      nombre: 'Ceviche',
      ubicacion: 'sin nombre',
      activo: true,
      pvp: null,
      costoPorPorcion: null,
      foodCostPct: null,
      margenUnitario: null,
      unidades: Count.CERO,
      ...datos,
    };
  }

  it('publica la dispersión: mínimo, máximo y brecha', () => {
    const [fila] = compararProductos([
      observacion({ locationId: CENTRO, pvp: d('8.50'), foodCostPct: r('0.28') }),
      observacion({ locationId: NORTE, pvp: d('11.00'), foodCostPct: r('0.41') }),
      observacion({ locationId: SUR, pvp: d('9.25'), foodCostPct: r('0.33') }),
    ]);

    expect(t(fila?.pvpMinimo)).toBe('8.5');
    expect(t(fila?.pvpMaximo)).toBe('11');
    expect(t(fila?.brechaDePvp)).toBe('2.5');
    expect(t(fila?.brechaDeFoodCost)).toBe('0.13');
    expect(fila?.activoEn).toBe(3);
  });

  it('una ubicación INACTIVA no entra en la dispersión, pero sí en la lista', () => {
    const [fila] = compararProductos([
      observacion({ locationId: CENTRO, pvp: d('8.50') }),
      observacion({ locationId: NORTE, pvp: d('40.00'), activo: false }),
    ]);

    expect(fila?.activoEn).toBe(1);
    expect(fila?.enUbicaciones).toHaveLength(2);
    // Con un solo activo no hay nada que comparar: brecha null, no cero.
    expect(fila?.brechaDePvp).toBeNull();
    expect(t(fila?.pvpMaximo)).toBe('8.5');
  });

  it('un producto que existe en una sola ubicación no inventa una brecha', () => {
    const [fila] = compararProductos([observacion({ locationId: CENTRO, pvp: d('8.50') })]);

    expect(fila?.brechaDePvp).toBeNull();
    expect(fila?.brechaDeFoodCost).toBeNull();
  });

  it('agrupa por producto y suma sus unidades', () => {
    const OTRO = 'producto-encebollado' as ProductId;
    const filas = compararProductos([
      observacion({ locationId: CENTRO, unidades: Count.fromInteger(30) }),
      observacion({ locationId: NORTE, unidades: Count.fromInteger(12) }),
      observacion({ locationId: CENTRO, productId: OTRO, nombre: 'Encebollado' }),
    ]);

    expect(filas).toHaveLength(2);
    expect(t(filas[0]?.unidadesTotales)).toBe('42');
  });
});

describe('comparativa de precios de compra', () => {
  const TOMATE = 'item-tomate' as ItemId;

  function compra(datos: Partial<CompraObservada> & { locationId: LocationId }): CompraObservada {
    return {
      itemId: TOMATE,
      item: 'Tomate riñón',
      ubicacion: 'sin nombre',
      purchaseArticleId: null,
      articulo: null,
      importe: Money.CERO,
      cantidad: Ratio.CERO,
      ...datos,
    };
  }

  it('el precio unitario sale del libro: lo pagado dividido por lo recibido', () => {
    const [fila] = compararCompras([
      compra({ locationId: CENTRO, importe: d('120.00'), cantidad: r('100') }),
      compra({ locationId: NORTE, importe: d('168.00'), cantidad: r('100') }),
    ]);

    expect(t(fila?.pagos[0]?.precioUnitario)).toBe('1.2');
    expect(t(fila?.precioMinimo)).toBe('1.2');
    expect(t(fila?.precioMaximo)).toBe('1.68');
    expect(t(fila?.brecha)).toBe('0.48');
    // 0.48 / 1.20 = 40 %: lo que se ahorra el Norte comprando como el Centro.
    expect(t(fila?.brechaPct)).toBe('0.4');
  });

  it('sin cantidad no hay precio unitario: null, no una división por cero', () => {
    const [fila] = compararCompras([
      compra({ locationId: CENTRO, importe: d('50.00'), cantidad: Ratio.CERO }),
    ]);

    expect(fila?.pagos[0]?.precioUnitario).toBeNull();
    expect(fila?.precioMinimo).toBeNull();
    expect(fila?.brechaPct).toBeNull();
  });

  it('distingue marcas: dos artículos del mismo ítem son dos filas de pago', () => {
    const [fila] = compararCompras([
      compra({
        locationId: CENTRO,
        purchaseArticleId: 'art-caja',
        articulo: 'Caja 10 kg',
        importe: d('100.00'),
        cantidad: r('100'),
      }),
      compra({
        locationId: CENTRO,
        purchaseArticleId: 'art-granel',
        articulo: 'Granel',
        importe: d('130.00'),
        cantidad: r('100'),
      }),
    ]);

    expect(fila?.pagos).toHaveLength(2);
    expect(t(fila?.brecha)).toBe('0.3');
  });
});
