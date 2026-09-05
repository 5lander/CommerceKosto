/**
 * Las cuatro vistas del dominio — SPEC §15, §16, §17 y §18.
 *
 * **CON LA BASE APAGADA.** Lo que se prueba aquí es la aritmética que un dueño
 * de restaurante usa para decidir si sube un precio, retira un plato o cierra:
 * los cuadrantes, la conciliación R7, el punto de equilibrio y los estados de
 * inventario.
 *
 * Los bordes que se prueban no son caprichos: cada uno es una frase del SPEC
 * («producto activo con 0 unidades → SIN DATOS», «`mc_promedio ≤ 0` → null»)
 * o una división por cero que produciría un `Infinity` viajando hasta una
 * pantalla.
 */

import { describe, expect, it } from 'vitest';

import { productId as aProductId, itemId as aItemId } from '../../../shared/domain/identity/identificadores';
import { Count, Money, Quantity, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { foodCostReal } from './food-cost-real';
import { valorizarInventario, semaforoDe, type EntradaDeItem } from './inventario-valorizado';
import { clasificarMenu, type ProductoParaClasificar } from './menu-engineering';
import { puntoDeEquilibrio, type LineaDeCosto } from './punto-de-equilibrio';
import { resumir, type EntradaDelResumen, type UmbralesDelResumen } from './resumen';

const KG = unidadDeUso('kg');

const P1 = aProductId('01970000-0000-7000-8000-000000000001');
const P2 = aProductId('01970000-0000-7000-8000-000000000002');
const P3 = aProductId('01970000-0000-7000-8000-000000000003');
const CEBOLLA = aItemId('01970000-0000-7000-8000-00000000000a');

/** D3: la regla de Kasavana-Smith que el Excel usa. */
const REGLA = Ratio.fromDecimalString('0.70');

function usd(valor: string): Money {
  return Money.fromDecimalString(valor);
}

function kg(valor: string): Quantity {
  return Quantity.of(valor, KG);
}

function producto(datos: {
  readonly productId: typeof P1;
  readonly unidades: number;
  readonly mc: string | null;
  readonly activo?: boolean;
}): ProductoParaClasificar {
  return {
    productId: datos.productId,
    activo: datos.activo ?? true,
    unidades: Count.fromInteger(datos.unidades),
    margenContribucion: datos.mc === null ? null : usd(datos.mc),
  };
}

describe('menu engineering (SPEC §15)', () => {
  /**
   * EL CRITERIO DE ACEPTACIÓN DEL PAQUETE, construido a mano.
   *
   * Con tres productos activos y la regla en 0.70, un producto necesita una
   * popularidad de `0.70 / 3 = 0.2333…` para que el índice dé exactamente 1.
   * Con 210 unidades de 900, la popularidad es `7/30` y el índice sale
   * `7/30 × 3 / 0.7 = 1` **exacto**, sin arrastre: es el caso que distingue un
   * `>=` de un `>` y una aritmética decimal de una binaria.
   */
  it('un indice EXACTAMENTE 1 es popular, de forma determinista', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [
        producto({ productId: P1, unidades: 210, mc: '5.00' }),
        producto({ productId: P2, unidades: 345, mc: '1.00' }),
        producto({ productId: P3, unidades: 345, mc: '1.00' }),
      ],
    });

    const primero = menu.productos[0];
    expect(primero?.indicePopularidad?.toExactString()).toBe('1');
    // Índice = 1 (popular) y MC por encima del promedio ponderado -> ESTRELLA.
    expect(primero?.cuadrante).toBe('ESTRELLA');
  });

  it('el MC promedio es PONDERADO por unidades, no la media simple', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [
        producto({ productId: P1, unidades: 99, mc: '1.00' }),
        producto({ productId: P2, unidades: 1, mc: '101.00' }),
      ],
    });

    // Media simple: (1 + 101) / 2 = 51. Ponderada: (99 × 1 + 1 × 101) / 100 = 2.
    expect(menu.mcPromedio?.toExactString()).toBe('2');

    // El plato de 99 unidades es popular; con MC 1 contra un promedio de 2 es
    // un CABALLO —hay que trabajar su margen—. Con la media simple de 51 sería
    // un PERRO, que es la conclusión contraria: retirarlo de la carta.
    expect(menu.productos[0]?.cuadrante).toBe('CABALLO');
  });

  it('un producto activo sin unidades es SIN_DATOS, no un PERRO', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [
        producto({ productId: P1, unidades: 10, mc: '5.00' }),
        producto({ productId: P2, unidades: 0, mc: '1.00' }),
      ],
    });

    expect(menu.productos[1]?.cuadrante).toBe('SIN_DATOS');
  });

  it('un producto inactivo no se clasifica ni cuenta para el total', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [
        producto({ productId: P1, unidades: 10, mc: '5.00' }),
        producto({ productId: P2, unidades: 990, mc: '5.00', activo: false }),
      ],
    });

    expect(menu.productos[1]?.cuadrante).toBe('INACTIVO');
    // Las 990 unidades del retirado no diluyen la popularidad del que queda.
    expect(menu.unidadesTotales.toExactString()).toBe('10');
    expect(menu.productos[0]?.popularidad?.toExactString()).toBe('1');
  });

  it('sin ninguna unidad vendida, todo es SIN_DATOS y nada divide por cero', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [producto({ productId: P1, unidades: 0, mc: '5.00' })],
    });

    expect(menu.productos[0]?.popularidad).toBeNull();
    expect(menu.productos[0]?.cuadrante).toBe('SIN_DATOS');
    expect(menu.mcPromedio).toBeNull();
  });

  it('un producto sin PVP no tiene cuadrante ni arrastra el promedio', () => {
    const menu = clasificarMenu({
      reglaPopularidad: REGLA,
      productos: [
        producto({ productId: P1, unidades: 10, mc: '4.00' }),
        producto({ productId: P2, unidades: 10, mc: null }),
      ],
    });

    expect(menu.productos[1]?.cuadrante).toBe('SIN_DATOS');
    // Solo el que tiene margen entra en el promedio: 4, no 2.
    expect(menu.mcPromedio?.toExactString()).toBe('4');
  });
});

describe('food cost real y la conciliación R7 (SPEC §16)', () => {
  /**
   * R7 CON NÚMEROS A MANO.
   *
   * `costo_ventas_teorico = consumo + empaque + provisión`
   * `costo_ventas_v_costeo = venta_neta − mc`
   *
   * Son dos caminos al mismo costo de ventas. Si el motor está sano coinciden,
   * y la diferencia redondeada a dos decimales da cero.
   */
  it('la conciliación da exactamente cero cuando los dos caminos coinciden', () => {
    const real = foodCostReal({
      inventarioInicial: usd('1000.00'),
      comprasDelMes: usd('4500.00'),
      inventarioFinalFisico: usd('1200.00'),
      consumoTeorico: usd('4000.00'),
      ventaNetaMes: usd('15000.00'),
      empaqueTeoricoMes: usd('300.00'),
      provisionMermaMes: usd('80.00'),
      // venta_neta − mc = 15000 − 10620 = 4380 = 4000 + 300 + 80
      mcMesTotal: usd('10620.00'),
    });

    expect(real.costoVentasTeorico.toExactString()).toBe('4380');
    expect(real.costoVentasSegunCosteo.toExactString()).toBe('4380');
    expect(real.diferenciaConciliacion.isZero()).toBe(true);
  });

  /**
   * Y LO QUE R7 **NO** DETECTA, que es tan importante como lo que sí.
   *
   * Si el consumo teórico está mal calculado, los dos lados se equivocan por
   * igual —el motor de costeo alimenta ambos— y la conciliación sigue dando
   * cero. Aquí se simula moviendo consumo y mc a la vez.
   */
  it('sigue dando cero con un consumo teórico equivocado: R7 no lo detecta', () => {
    const real = foodCostReal({
      inventarioInicial: usd('1000.00'),
      comprasDelMes: usd('4500.00'),
      inventarioFinalFisico: usd('1200.00'),
      // 800 dólares de menos, y el margen sube exactamente lo mismo.
      consumoTeorico: usd('3200.00'),
      ventaNetaMes: usd('15000.00'),
      empaqueTeoricoMes: usd('300.00'),
      provisionMermaMes: usd('80.00'),
      mcMesTotal: usd('11420.00'),
    });

    expect(real.diferenciaConciliacion.isZero()).toBe(true);
    // Lo que sí se mueve es el food cost teórico, que es donde se ve.
    expect(real.foodCostTeoricoPct?.toExactString()).toBe('0.213333333333');
  });

  it('la varianza es consumo real menos teórico, y su porcentaje sale sobre el teórico', () => {
    const real = foodCostReal({
      inventarioInicial: usd('1000.00'),
      comprasDelMes: usd('4500.00'),
      inventarioFinalFisico: usd('1200.00'),
      consumoTeorico: usd('4000.00'),
      ventaNetaMes: usd('15000.00'),
      empaqueTeoricoMes: usd('300.00'),
      provisionMermaMes: usd('80.00'),
      mcMesTotal: usd('10620.00'),
    });

    // 1000 + 4500 − 1200 = 4300 reales contra 4000 teóricos.
    expect(real.consumoReal.toExactString()).toBe('4300');
    expect(real.varianzaUsd.toExactString()).toBe('300');
    expect(real.varianzaPct?.toExactString()).toBe('0.075');
  });

  it('la brecha va en PUNTOS porcentuales, no en fracción', () => {
    const real = foodCostReal({
      inventarioInicial: usd('0.00'),
      comprasDelMes: usd('3000.00'),
      inventarioFinalFisico: usd('0.00'),
      consumoTeorico: usd('2700.00'),
      ventaNetaMes: usd('10000.00'),
      empaqueTeoricoMes: usd('0.00'),
      provisionMermaMes: usd('0.00'),
      mcMesTotal: usd('7300.00'),
    });

    // real 30 %, teórico 27 % -> tres puntos, no 0.03.
    expect(real.brechaEnPuntos?.toExactString()).toBe('3');
  });

  it('sin ventas, los porcentajes son null y no cero por ciento', () => {
    const real = foodCostReal({
      inventarioInicial: usd('100.00'),
      comprasDelMes: usd('0.00'),
      inventarioFinalFisico: usd('100.00'),
      consumoTeorico: usd('0.00'),
      ventaNetaMes: usd('0.00'),
      empaqueTeoricoMes: usd('0.00'),
      provisionMermaMes: usd('0.00'),
      mcMesTotal: usd('0.00'),
    });

    expect(real.foodCostRealPct).toBeNull();
    expect(real.foodCostTeoricoPct).toBeNull();
    expect(real.brechaEnPuntos).toBeNull();
    expect(real.varianzaPct).toBeNull();
  });
});

describe('punto de equilibrio (SPEC §17)', () => {
  const costos: readonly LineaDeCosto[] = [
    { concepto: 'Sueldos cocina', clasificacion: 'MANO_DE_OBRA', importe: usd('3000.00') },
    { concepto: 'Arriendo', clasificacion: 'OTRO_FIJO', importe: usd('1200.00') },
    { concepto: 'Comision tarjeta', clasificacion: 'VARIABLE', importe: usd('0.03') },
  ];

  const base = {
    ventaNetaMes: usd('15000.00'),
    mcMesTotal: usd('10620.00'),
    unidadesTotales: Count.fromInteger(3000),
    costos,
    diasOperativos: Count.fromInteger(22),
    ivaVenta: Ratio.fromDecimalString('0.15'),
  };

  it('la mano de obra suma a los costos fijos Y al prime cost', () => {
    const resultado = puntoDeEquilibrio(base);

    expect(resultado.costosFijos.toExactString()).toBe('4200');
    // costo_alimentos_empaque = 15000 − 10620 = 4380; + 3000 de sueldos.
    expect(resultado.costoAlimentosYEmpaque.toExactString()).toBe('4380');
    expect(resultado.primeCost.toExactString()).toBe('7380');
    expect(resultado.primeCostPct?.toExactString()).toBe('0.492');
  });

  /**
   * EL MOTIVO POR EL QUE T6 NECESITA UNA COLUMNA DE CLASIFICACIÓN.
   *
   * El Excel identifica la mano de obra por el prefijo «Sueldos». Un concepto
   * llamado «Nómina» quedaría fuera del prime cost sin que nada avisara, y el
   * prime cost es el indicador que decide si un local es viable.
   */
  it('un concepto que NO empieza por «Sueldos» cuenta igual si está clasificado', () => {
    const resultado = puntoDeEquilibrio({
      ...base,
      costos: [
        { concepto: 'Nomina', clasificacion: 'MANO_DE_OBRA', importe: usd('3000.00') },
        { concepto: 'Arriendo', clasificacion: 'OTRO_FIJO', importe: usd('1200.00') },
      ],
    });

    expect(resultado.manoDeObra.toExactString()).toBe('3000');
    expect(resultado.primeCost.toExactString()).toBe('7380');
  });

  it('el costo variable escala con la venta, no es un monto', () => {
    const resultado = puntoDeEquilibrio(base);

    // 3 % de 15 000.
    expect(resultado.costosVariables.toExactString()).toBe('450');
    expect(resultado.mcNeto.toExactString()).toBe('10170');
    expect(resultado.utilidadOperativa.toExactString()).toBe('5970');
  });

  it('las unidades de equilibrio salen del MC NETO por unidad', () => {
    const resultado = puntoDeEquilibrio(base);

    // mc_neto/unidad = 10170 / 3000 = 3.39; 4200 / 3.39 = 1238.938...
    expect(resultado.unidadesEquilibrioMes?.toExactString()).toBe('1238.938053097345');
    // venta_neta/unidad = 5; equilibrio = 5 × 1238.938... = 6194.690265486725
    expect(resultado.ventaNetaEquilibrio?.toExactString()).toBe('6194.690265486725');
    expect(resultado.margenDeSeguridad?.toExactString()).toBe('0.587020648968');
  });

  /**
   * Un margen de contribución neto negativo significa que cada unidad vendida
   * pierde dinero: **no hay ninguna cantidad de unidades que alcance el
   * equilibrio.** Un número negativo ahí se leería como una meta alcanzable.
   */
  it('con MC neto negativo no hay equilibrio, y devuelve null en vez de un negativo', () => {
    const resultado = puntoDeEquilibrio({ ...base, mcMesTotal: usd('-500.00') });

    expect(resultado.unidadesEquilibrioMes).toBeNull();
    expect(resultado.ventaNetaEquilibrio).toBeNull();
    expect(resultado.margenDeSeguridad).toBeNull();
    // Lo que sí se calcula: la utilidad operativa, que es la mala noticia.
    expect(resultado.utilidadOperativa.isNegative()).toBe(true);
  });

  it('sin unidades vendidas no hay equilibrio que calcular', () => {
    const resultado = puntoDeEquilibrio({ ...base, unidadesTotales: Count.CERO });

    expect(resultado.unidadesEquilibrioMes).toBeNull();
  });
});

describe('inventario valorizado (SPEC §18)', () => {
  const parametros = {
    diasOperativos: Count.fromInteger(22),
    diasDeCobertura: Count.fromInteger(7),
  };

  function item(datos: Partial<EntradaDeItem> = {}): EntradaDeItem {
    return {
      itemId: CEBOLLA,
      stockInicial: kg('10'),
      compras: kg('100'),
      mermasYAjustes: kg('0'),
      otrosMovimientos: kg('0'),
      consumoTeorico: kg('88'),
      conteoFisico: null,
      costoDeUso: usd('2.00'),
      ...datos,
    };
  }

  /**
   * LA TRADUCCIÓN DEL SIGNO, que es donde el Excel y este sistema difieren.
   *
   * El SPEC **resta** `mermas_ajustes` porque en el Excel se capturan en
   * positivo. Aquí el libro lleva el signo dentro de la cantidad (P6), así que
   * una merma **ya es negativa** y se **suma**. Restarla la sumaría.
   */
  it('una merma del libro llega en negativo y se SUMA', () => {
    const { items } = valorizarInventario({
      items: [item({ mermasYAjustes: kg('-5') })],
      parametros,
    });

    // 10 + 100 − 5 − 88 = 17
    expect(items[0]?.stockTeorico.toExactString()).toBe('17');
  });

  it('la diferencia contra el conteo se valoriza al costo de uso', () => {
    const { items } = valorizarInventario({
      items: [item({ conteoFisico: kg('20') })],
      parametros,
    });

    // teórico 22, contado 20 -> faltan 2 kg = 4 dólares.
    expect(items[0]?.stockTeorico.toExactString()).toBe('22');
    expect(items[0]?.diferencia?.toExactString()).toBe('-2');
    expect(items[0]?.valorDeDiferencia?.toExactString()).toBe('-4');
  });

  it('sin conteo no hay diferencia: null, no cero', () => {
    const { items } = valorizarInventario({ items: [item()], parametros });

    expect(items[0]?.diferencia).toBeNull();
    expect(items[0]?.valorDeDiferencia).toBeNull();
  });

  it('los días de cobertura salen del consumo DIARIO', () => {
    const { items } = valorizarInventario({ items: [item()], parametros });

    // consumo diario = 88 / 22 = 4; stock 22 -> 5.5 días.
    expect(items[0]?.diasCobertura?.toExactString()).toBe('5.5');
    // reorden = 4 × 7 = 28. Con 22 de stock, hay que reponer.
    expect(items[0]?.puntoDeReorden.toExactString()).toBe('28');
    expect(items[0]?.estado).toBe('REPONER');
  });

  it('con stock por encima del reorden el estado es OK', () => {
    const { items } = valorizarInventario({
      items: [item({ compras: kg('200') })],
      parametros,
    });

    expect(items[0]?.estado).toBe('OK');
    expect(items[0]?.diasCobertura?.toExactString()).toBe('30.5');
  });

  it('un stock teórico negativo es FALTAN COMPRAS', () => {
    const { items } = valorizarInventario({
      items: [item({ compras: kg('0') })],
      parametros,
    });

    expect(items[0]?.stockTeorico.isNegative()).toBe(true);
    expect(items[0]?.estado).toBe('FALTAN_COMPRAS');
  });

  /**
   * El orden de las guardas del SPEC no es intercambiable: un ítem que no se
   * consume está siempre por debajo de su reorden —que es cero— y clasificarlo
   * como `OK` escondería que nadie sabe si sobra o falta.
   */
  it('sin consumo el estado es SIN_CONSUMO, y los días de cobertura son null', () => {
    const { items } = valorizarInventario({
      items: [item({ consumoTeorico: kg('0') })],
      parametros,
    });

    expect(items[0]?.estado).toBe('SIN_CONSUMO');
    expect(items[0]?.diasCobertura).toBeNull();
  });

  /**
   * EL SEMÁFORO QUE `BODEGA` RECIBE, y lo que colapsa.
   *
   * `FALTAN_COMPRAS` y `REPONER` son el mismo aviso para quien repone. Que
   * pudiera distinguirlos ya sería un dato sobre el stock teórico (§4.3).
   */
  it('el semáforo de BODEGA colapsa cuatro estados en dos', () => {
    expect(semaforoDe('REPONER')).toBe('REPONER');
    expect(semaforoDe('FALTAN_COMPRAS')).toBe('REPONER');
    expect(semaforoDe('OK')).toBe('OK');
    expect(semaforoDe('SIN_CONSUMO')).toBe('OK');
  });
});

describe('el resumen gerencial', () => {
  const umbrales: UmbralesDelResumen = {
    umbralVerde: Ratio.fromDecimalString('0.28'),
    foodCostMaximo: Ratio.fromDecimalString('0.32'),
    primeCostMaximo: Ratio.fromDecimalString('0.65'),
    varianzaMaxima: Ratio.fromDecimalString('0.05'),
  };

  function datos(cambios: Partial<EntradaDelResumen> = {}): EntradaDelResumen {
    return {
      ventaNetaMes: usd('15000.00'),
      foodCostTeoricoPct: Ratio.fromDecimalString('0.26'),
      foodCostRealPct: Ratio.fromDecimalString('0.27'),
      brechaEnPuntos: Ratio.fromDecimalString('1'),
      varianzaUsd: usd('150.00'),
      varianzaPct: Ratio.fromDecimalString('0.02'),
      utilidadOperativa: usd('5970.00'),
      primeCostPct: Ratio.fromDecimalString('0.492'),
      margenDeSeguridad: Ratio.fromDecimalString('0.58'),
      coberturaDelConteo: Ratio.fromDecimalString('0.9'),
      itemsPorReponer: 3,
      itemsSinCosto: 0,
      ...cambios,
    };
  }

  it('las tres bandas del food cost usan los umbrales de la company', () => {
    const verde = resumir({ datos: datos(), umbrales });
    const ambar = resumir({
      datos: datos({ foodCostRealPct: Ratio.fromDecimalString('0.30') }),
      umbrales,
    });
    const rojo = resumir({
      datos: datos({ foodCostRealPct: Ratio.fromDecimalString('0.33') }),
      umbrales,
    });

    expect(verde.semaforoFoodCost).toBe('VERDE');
    expect(ambar.semaforoFoodCost).toBe('AMBAR');
    expect(rojo.semaforoFoodCost).toBe('ROJO');
  });

  /**
   * Consumir un 8 % MENOS de lo teórico es tan sospechoso como un 8 % más:
   * significa que la receta, el conteo o las unidades vendidas están mal.
   */
  it('la varianza se juzga en valor absoluto', () => {
    const porDebajo = resumir({
      datos: datos({ varianzaPct: Ratio.fromDecimalString('-0.08') }),
      umbrales,
    });

    expect(porDebajo.semaforoVarianza).toBe('ROJO');
  });

  it('un indicador sin dato NO se pinta de verde', () => {
    const resumen = resumir({
      datos: datos({ foodCostRealPct: null, primeCostPct: null, varianzaPct: null }),
      umbrales,
    });

    expect(resumen.semaforoFoodCost).toBe('SIN_DATO');
    expect(resumen.semaforoPrimeCost).toBe('SIN_DATO');
    expect(resumen.semaforoVarianza).toBe('SIN_DATO');
  });

  it('la utilidad cero es ámbar: no es ganar, y tampoco es perder', () => {
    expect(resumir({ datos: datos({ utilidadOperativa: usd('0') }), umbrales }).semaforoUtilidad).toBe(
      'AMBAR',
    );
    expect(
      resumir({ datos: datos({ utilidadOperativa: usd('-1.00') }), umbrales }).semaforoUtilidad,
    ).toBe('ROJO');
  });
});
