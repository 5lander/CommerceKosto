/**
 * Mini-conciliacion R7, con tres productos REALES del Excel de referencia.
 *
 * R7 (CLAUDE.md §6): `ROUND(costo_ventas_teorico - costo_ventas_segun_costeo, 2)`
 * debe dar **exactamente 0**. Es la mejor defensa contra un motor de costeo
 * silenciosamente roto — el tipo de fallo que no se ve en pantalla porque
 * produce numeros plausibles y equivocados.
 *
 * La conciliacion completa llega en P8, con el dataset entero. Esta version
 * reducida corre ya en P0, dentro del modulo de aritmetica y antes de que el
 * motor exista, para demostrar que las escalas y el modo de redondeo la
 * sostienen. Si la aritmetica no puede con tres productos, no va a poder con
 * doscientos.
 *
 * PROCEDENCIA DE LOS NUMEROS — docs/pruebas/casos-conocidos.md
 * Todos los valores por producto (`costo_por_porcion`, `empaque_neto`,
 * `venta_neta`, `margen_contribucion`) estan LEIDOS de la hoja `V_COSTEO` de
 * `Modelo_Costeo_Auditado_SNACKLAB.xlsx`, que ya los tenia calculados. No se
 * recalculan aqui: si quien escribe la aritmetica calculara tambien el
 * resultado esperado, no habria verificacion, habria dos veces el mismo error.
 *
 * La UNICA entrada que no sale del Excel son las unidades vendidas: el libro no
 * tiene dimension temporal (SPEC §3) y trae 0 en los 48 productos. Se declaran
 * abajo de forma explicita.
 */

import { describe, expect, it } from 'vitest';

import { PRESENTACION } from '../decimal/escalas';
import { Count, Money, Ratio } from './tipos-monetarios';

/** PARAMETROS del Excel · coincide con DECISIONES.md D3. */
const MERMA_NO_ATRIBUIBLE = Ratio.fromDecimalString('0.02');

interface ProductoDelMes {
  readonly codigo: string;
  readonly nombre: string;
  /** V_COSTEO, columna "Costo neto por porcion". */
  readonly costoPorPorcion: Money;
  /** V_COSTEO, columna "Empaque neto". */
  readonly empaqueNeto: Money;
  /** V_COSTEO, columna "VENTA NETA". */
  readonly ventaNeta: Money;
  /** V_COSTEO, columna "MARGEN DE CONTRIBUCION". */
  readonly margenContribucion: Money;
  /** Unico dato ajeno al Excel. */
  readonly unidadesDelMes: Count;
}

const PRODUCTOS: readonly ProductoDelMes[] = [
  {
    codigo: 'PRD-001',
    nombre: 'Tamal de pollo',
    costoPorPorcion: Money.fromDecimalString('0.51'),
    empaqueNeto: Money.fromDecimalString('0.04347826087'),
    ventaNeta: Money.fromDecimalString('1.565217391'),
    margenContribucion: Money.fromDecimalString('1.00153913'),
    unidadesDelMes: Count.fromInteger(120),
  },
  {
    codigo: 'PRD-006',
    nombre: 'Wuafle de Maduro Lojano',
    costoPorPorcion: Money.fromDecimalString('1.098548462'),
    empaqueNeto: Money.fromDecimalString('0.04347826087'),
    ventaNeta: Money.fromDecimalString('3.043478261'),
    margenContribucion: Money.fromDecimalString('1.879480569'),
    unidadesDelMes: Count.fromInteger(85),
  },
  {
    codigo: 'PRD-018',
    nombre: 'Empanada de Verde con Pollo',
    costoPorPorcion: Money.fromDecimalString('0.4611078936'),
    empaqueNeto: Money.fromDecimalString('0.04347826087'),
    ventaNeta: Money.fromDecimalString('2.173913043'),
    margenContribucion: Money.fromDecimalString('1.660104731'),
    unidadesDelMes: Count.fromInteger(340),
  },
];

/**
 * Lado teorico, SPEC §16:
 *   consumo_teorico      = Sum(costo_por_porcion x unidades)
 *   empaque_teorico_mes  = Sum(empaque_neto x unidades)
 *   provision_merma_mes  = Sum(costo_por_porcion x merma x unidades)
 */
function costoVentasTeorico(productos: readonly ProductoDelMes[]): Money {
  const consumo = Money.sum(productos.map((p) => p.costoPorPorcion.times(p.unidadesDelMes)));
  const empaque = Money.sum(productos.map((p) => p.empaqueNeto.times(p.unidadesDelMes)));
  const provisionMerma = Money.sum(
    productos.map((p) => p.costoPorPorcion.times(MERMA_NO_ATRIBUIBLE).times(p.unidadesDelMes)),
  );

  return consumo.plus(empaque).plus(provisionMerma);
}

/**
 * Lado del costeo, SPEC §16:
 *   costo_ventas_v_costeo = venta_neta_mes_total - mc_mes_total
 */
function costoVentasSegunCosteo(productos: readonly ProductoDelMes[]): Money {
  const ventaNetaMes = Money.sum(productos.map((p) => p.ventaNeta.times(p.unidadesDelMes)));
  const mcMes = Money.sum(productos.map((p) => p.margenContribucion.times(p.unidadesDelMes)));

  return ventaNetaMes.minus(mcMes);
}

describe('R7 — conciliacion de food cost', () => {
  const teorico = costoVentasTeorico(PRODUCTOS);
  const segunCosteo = costoVentasSegunCosteo(PRODUCTOS);
  const diferencia = teorico.minus(segunCosteo);

  it('DIFERENCIA_CONCILIACION redondeada a 2 decimales da exactamente 0', () => {
    expect(diferencia.round(PRESENTACION).toDisplayString()).toBe('0.00');
  });

  it('el canario: la diferencia sin redondear es despreciable', () => {
    // ESTA es la asercion que de verdad protege.
    //
    // El contrato (0.00) sigue en verde mientras la deriva sea menor que medio
    // centavo, asi que un motor que empieza a derivar puede pasar la prueba
    // durante meses y romperse un dia en produccion, con el dataset completo.
    //
    // El canario se rompe CINCO ORDENES DE MAGNITUD ANTES, en el commit que
    // introdujo la deriva. Si algun dia falla este y no el de arriba, no se
    // relaja el umbral: se busca que paso.
    const UMBRAL_CANARIO = Money.fromDecimalString('0.000001');
    expect(diferencia.abs().compare(UMBRAL_CANARIO)).toBeLessThanOrEqual(0);
  });

  it('la identidad se sostiene termino a termino, no por casualidad', () => {
    // costo_ventas_v_costeo desarrollado ES costo_ventas_teorico:
    //   venta_neta - mc = costo_total_unidad
    //                   = costo_por_porcion x (1 + merma) + empaque_neto
    // Si un termino faltara, la suma cuadraria igual solo con estos numeros.
    for (const producto of PRODUCTOS) {
      const costoTotalUnidad = producto.ventaNeta.minus(producto.margenContribucion);
      const reconstruido = producto.costoPorPorcion
        .times(MERMA_NO_ATRIBUIBLE.onePlus())
        .plus(producto.empaqueNeto);

      const desvio = costoTotalUnidad.minus(reconstruido).abs();
      expect(desvio.compare(Money.fromDecimalString('0.000000001'))).toBeLessThanOrEqual(0);
    }
  });

  it('no concilia por ser cero: los dos lados son importes reales', () => {
    expect(teorico.isZero()).toBe(false);
    expect(segunCosteo.isZero()).toBe(false);
    expect(teorico.compare(Money.fromDecimalString('100'))).toBe(1);
  });

  it('si se olvida la provision de merma, la conciliacion SE ROMPE', () => {
    // Prueba de que la conciliacion discrimina. Un R7 que da 0 con y sin uno de
    // sus terminos no esta comprobando nada.
    const sinMerma = Money.sum(
      PRODUCTOS.map((p) => p.costoPorPorcion.times(p.unidadesDelMes)),
    ).plus(Money.sum(PRODUCTOS.map((p) => p.empaqueNeto.times(p.unidadesDelMes))));

    const diferenciaRota = sinMerma.minus(segunCosteo);
    expect(diferenciaRota.round(PRESENTACION).toDisplayString()).not.toBe('0.00');
  });
});
