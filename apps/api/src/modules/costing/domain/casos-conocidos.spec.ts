/**
 * El motor contra `docs/pruebas/casos-conocidos.md`.
 *
 * **LOS VALORES ESPERADOS NO SE CALCULAN AQUÍ.** Salen de la hoja `V_COSTEO` de
 * `Modelo_Costeo_Auditado_SNACKLAB.xlsx`, que ya los tenía calculados antes de
 * que existiera este código. Si quien escribe el motor calculara también el
 * resultado esperado, no habría verificación: habría dos veces el mismo error.
 *
 * Lo único calculado a mano son las mitades que el Excel no tiene, y está
 * marcado caso por caso: la base `AP` de CC-004 (sus 293 líneas están todas en
 * `EP`), la receta de CC-005 y la composición de CC-006.
 *
 * **CORREN CON POSTGRESQL APAGADO.** Es el criterio arquitectónico de
 * CLAUDE.md §2: si para probar el costo de un plato hiciera falta levantar la
 * base, las capas estarían mal.
 *
 * SOBRE LA PRECISIÓN. `V_COSTEO` muestra entre 8 y 11 decimales según la
 * columna. Cada aserción redondea el resultado del motor **a la precisión que
 * el Excel muestra** y compara exacto: ni tolerancias inventadas ni «casi
 * igual». Lo hace `alaPrecisionDelExcel`.
 */

import { describe, expect, it } from 'vitest';

import { escalaDe, PRESENTACION } from '../../../shared/domain/decimal/escalas';
import { itemId, type ItemId } from '../../../shared/domain/identity/identificadores';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { costoDelItem } from '../../pricing/domain/cadena-de-costo';
import {
  costoDeLinea,
  type BaseDeLinea,
  type CostosDelItem,
  type EstadoDeLinea,
} from '../../recipes/domain/linea-de-receta';
import {
  CicloEnCascadaError,
  resolverCostos,
  type CatalogoCosteable,
  type ItemCosteable,
} from './cascada';
import { costearCombo } from './combo';
import {
  costearProducto,
  totalesDelMes,
  type CosteoDeProducto,
  type ResultadoDeVenta,
  type Vendible,
} from './costeo-de-producto';

// --- Parámetros de la company · hoja PARAMETROS, y D3 -----------------------

const IVA_VENTA = Ratio.fromDecimalString('0.15');
const MERMA_NO_ATRIBUIBLE = Ratio.fromDecimalString('0.02');
const UNO = Ratio.UNO;

/** `EMP-E` — Bolsa kraft antigrasa, `T4_EMPAQUES`: precio 0.05, IVA 0.15. */
const EMPAQUE_E = { precio: '0.05', iva: '0.15', factor: '1.0', rendimiento: '1.00' };

// --- Utilidades de la prueba ------------------------------------------------

interface DatosDeItem {
  readonly precio: string;
  readonly iva: string;
  readonly factor: string;
  readonly rendimiento: string;
}

/** La cadena de SPEC §12, tal como P3 la implementó. */
function costosDe(datos: DatosDeItem, ivaRecuperable = true): CostosDelItem {
  return costoDelItem({
    precioDeCompra: Money.fromDecimalString(datos.precio),
    ivaCompra: Ratio.fromDecimalString(datos.iva),
    ivaRecuperable,
    factorDeConversion: Ratio.fromDecimalString(datos.factor),
    rendimiento: Ratio.fromDecimalString(datos.rendimiento),
  });
}

function empaqueNeto(ivaRecuperable = true): Money {
  return costosDe(EMPAQUE_E, ivaRecuperable).costoNetoDeUso;
}

/**
 * Redondea el resultado del motor a la precisión que `V_COSTEO` muestra.
 *
 * Las dos partes pasan por el mismo tipo decimal, así que `0.30` y `0.3` no se
 * distinguen: lo que se compara es el importe, no su escritura.
 */
function alaPrecisionDelExcel(actual: Money | Ratio, esperado: string): string {
  const punto = esperado.indexOf('.');
  const decimales = punto === -1 ? 0 : esperado.length - punto - 1;
  return actual.round(escalaDe(decimales)).toExactString();
}

function comoElExcel(esperado: string): string {
  return Money.fromDecimalString(esperado).toExactString();
}

function esperarValor(actual: Money | Ratio, esperado: string): void {
  expect(alaPrecisionDelExcel(actual, esperado)).toBe(comoElExcel(esperado));
}

function exigirVendible(venta: ResultadoDeVenta): Vendible {
  if (venta.clase !== 'vendible') {
    throw new Error(`Se esperaba un producto vendible: ${venta.motivo}`);
  }
  return venta;
}

interface LineaDelCaso {
  readonly item: DatosDeItem;
  readonly cantidad: string;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
}

/** Base `EP` y estado `ACTIVA`, que es lo que trae el 99 % del Excel. */
function linea(item: DatosDeItem, cantidad: string): LineaDelCaso {
  return { item, cantidad, base: 'EP', estado: 'ACTIVA' };
}

interface EntradaDelCaso {
  readonly lineas: readonly LineaDelCaso[];
  readonly rendimientoPorciones: string;
  /** `null` = producto sin PVP fijado, que es el borde 3 de CC-009. */
  readonly pvp: string | null;
  readonly ivaRecuperable?: boolean;
  /**
   * Costos ya resueltos para un ítem concreto, en vez de derivarlos de su
   * precio. Es como CC-005 mete la cascada dentro del costeo del producto.
   */
  readonly costosResueltos?: ReadonlyMap<DatosDeItem, CostosDelItem>;
}

function costearCaso(entrada: EntradaDelCaso): CosteoDeProducto {
  const ivaRecuperable = entrada.ivaRecuperable ?? true;
  const resueltos = entrada.costosResueltos;

  return costearProducto({
    lineas: entrada.lineas.map((l) => ({
      cantidad: Ratio.fromDecimalString(l.cantidad),
      base: l.base,
      estado: l.estado,
      costos: resueltos?.get(l.item) ?? costosDe(l.item, ivaRecuperable),
    })),
    rendimientoPorciones: Ratio.fromDecimalString(entrada.rendimientoPorciones),
    provisionMerma: MERMA_NO_ATRIBUIBLE,
    empaqueNeto: empaqueNeto(ivaRecuperable),
    pvp: entrada.pvp === null ? null : Money.fromDecimalString(entrada.pvp),
    ivaVenta: IVA_VENTA,
  });
}

// --- CC-001 -----------------------------------------------------------------

const INS_135 = { precio: '0.51', iva: '0.00', factor: '1.0', rendimiento: '1.00' };

const CASO_001: EntradaDelCaso = {
  lineas: [linea(INS_135, '1.0')],
  rendimientoPorciones: '1',
  pvp: '1.80',
};

describe('CC-001 — producto simple, un solo ítem, rendimiento 1', () => {
  const costeo = costearCaso(CASO_001);
  const venta = exigirVendible(costeo.venta);

  it('reproduce las siete columnas de costo de V_COSTEO fila 6', () => {
    esperarValor(costeo.costos.costoBrutoLote, '0.51');
    esperarValor(costeo.costos.costoNetoLote, '0.51');
    esperarValor(costeo.costos.costoPorPorcion, '0.51');
    esperarValor(costeo.costos.costoConMerma, '0.5202');
    esperarValor(costeo.costos.empaqueNeto, '0.04347826087');
    esperarValor(costeo.costos.costoTotalUnidad, '0.5636782609');
  });

  it('reproduce las columnas de venta y margen', () => {
    esperarValor(venta.ventaNeta, '1.565217391');
    esperarValor(venta.ivaEnPrecio, '0.2347826087');
    esperarValor(venta.margenContribucion, '1.00153913');
    esperarValor(venta.mcPct, '0.6398722222');
    esperarValor(venta.foodCostPct, '0.3601277778');
    esperarValor(venta.multiplicador ?? Ratio.CERO, '2.776792188');
  });

  it('impacto_merma es 0: con rendimiento 1 el neto y el bruto coinciden', () => {
    esperarValor(costeo.costos.impactoMerma ?? Ratio.UNO, '0');
  });
});

// --- CC-002 -----------------------------------------------------------------

const INS_113 = { precio: '0.20', iva: '0.00', factor: '1.0', rendimiento: '0.65' };
const INS_074 = { precio: '3.80', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_017 = { precio: '0.89', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_057 = { precio: '0.12', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_131 = { precio: '0.20', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_048 = { precio: '0.15', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_122 = { precio: '5.50', iva: '0.00', factor: '1.0', rendimiento: '1.00' };

/** `EXCLUIDA` en el Excel es `INACTIVA` en el catálogo del SaaS. */
const LINEAS_CC_002: readonly LineaDelCaso[] = [
  linea(INS_113, '1.5'),
  linea(INS_074, '0.03'),
  linea(INS_017, '0.009'),
  { item: INS_057, cantidad: '0.0', base: 'EP', estado: 'INACTIVA' },
  linea(INS_131, '1.0'),
  linea(INS_048, '1.0'),
  linea(INS_122, '0.03'),
];

const CASO_002: EntradaDelCaso = {
  lineas: LINEAS_CC_002,
  rendimientoPorciones: '1',
  pvp: '3.50',
};

describe('CC-002 — rendimiento < 1 y línea EXCLUIDA', () => {
  const costeo = costearCaso(CASO_002);
  const venta = exigirVendible(costeo.venta);

  it('el costo NETO del lote es MAYOR que el bruto', () => {
    esperarValor(costeo.costos.costoBrutoLote, '0.93701');
    esperarValor(costeo.costos.costoNetoLote, '1.098548462');

    // La afirmación que de verdad discrimina: si R4 estuviera al revés, el neto
    // sería igual o menor que el bruto y este caso pasaría con 0.93701.
    expect(costeo.costos.costoNetoLote.greaterThan(costeo.costos.costoBrutoLote)).toBe(true);
  });

  it('reproduce el resto de V_COSTEO fila 11', () => {
    esperarValor(costeo.costos.costoConMerma, '1.120519431');
    esperarValor(costeo.costos.costoTotalUnidad, '1.163997692');
    esperarValor(venta.ventaNeta, '3.043478261');
    esperarValor(venta.margenContribucion, '1.879480569');
    esperarValor(venta.foodCostPct, '0.3824563844');
    esperarValor(venta.mcPct, '0.6175436156');
    esperarValor(venta.multiplicador ?? Ratio.CERO, '2.614677231');
  });

  it('impacto_merma: el plato cuesta 17,24 % más de lo que el modelo anterior creía', () => {
    esperarValor(costeo.costos.impactoMerma ?? Ratio.CERO, '0.1723977989');
  });

  it('la línea EXCLUIDA no suma nada, ni al neto ni al bruto', () => {
    const sinLaExcluida = costearCaso({
      ...CASO_002,
      lineas: LINEAS_CC_002.filter((l) => l.estado === 'ACTIVA'),
    });

    expect(sinLaExcluida.costos.costoNetoLote.equals(costeo.costos.costoNetoLote)).toBe(true);
    expect(sinLaExcluida.costos.costoBrutoLote.equals(costeo.costos.costoBrutoLote)).toBe(true);
  });
});

// --- CC-003 -----------------------------------------------------------------

const INS_112 = { precio: '0.66', iva: '0.00', factor: '1.0', rendimiento: '0.68' };
const INS_100 = { precio: '4.40', iva: '0.00', factor: '1.0', rendimiento: '0.92' };
const INS_072 = { precio: '4.00', iva: '0.15', factor: '1.0', rendimiento: '1.00' };
const INS_004 = { precio: '4.42', iva: '0.15', factor: '1.0', rendimiento: '1.00' };
const INS_125 = { precio: '0.39', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_029 = { precio: '0.95', iva: '0.00', factor: '1.0', rendimiento: '0.87' };
const INS_109 = { precio: '2.50', iva: '0.00', factor: '1.0', rendimiento: '0.82' };
const INS_063 = { precio: '12.88', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_046 = { precio: '8.38', iva: '0.15', factor: '1.0', rendimiento: '1.00' };
const INS_043 = { precio: '8.32', iva: '0.00', factor: '1.0', rendimiento: '1.00' };
const INS_081 = { precio: '12.00', iva: '0.00', factor: '1.0', rendimiento: '1.00' };

const LINEAS_CC_003: readonly LineaDelCaso[] = [
  linea(INS_112, '18.14'),
  linea(INS_100, '12.5'),
  linea(INS_072, '0.9'),
  linea(INS_004, '0.4'),
  linea(INS_125, '0.1'),
  linea(INS_029, '0.9'),
  linea(INS_109, '0.5'),
  linea(INS_063, '0.002'),
  linea(INS_046, '0.09'),
  linea(INS_043, '0.001'),
  linea(INS_081, '0.001'),
];

const CASO_003: EntradaDelCaso = {
  lineas: LINEAS_CC_003,
  rendimientoPorciones: '185',
  pvp: '2.50',
};

describe('CC-003 — rendimiento por lote de 185 porciones', () => {
  const costeo = costearCaso(CASO_003);
  const venta = exigirVendible(costeo.venta);

  it('reproduce V_COSTEO fila 23 con once líneas y magnitudes de 0.008 a 59.78', () => {
    esperarValor(costeo.costos.costoBrutoLote, '74.48613217');
    esperarValor(costeo.costos.costoNetoLote, '85.30496032');
    esperarValor(costeo.costos.costoPorPorcion, '0.4611078936');
    esperarValor(costeo.costos.costoConMerma, '0.4703300515');
    esperarValor(costeo.costos.costoTotalUnidad, '0.5138083124');
  });

  it('reproduce el margen y el food cost de la fila 23', () => {
    esperarValor(venta.ventaNeta, '2.173913043');
    esperarValor(venta.margenContribucion, '1.660104731');
    esperarValor(venta.foodCostPct, '0.2363518237');
    esperarValor(venta.mcPct, '0.7636481763');
    esperarValor(venta.multiplicador ?? Ratio.CERO, '4.230980681');
    esperarValor(costeo.costos.impactoMerma ?? Ratio.CERO, '0.1452462067');
  });

  it('el orden de las líneas no altera el resultado', () => {
    // Es la propiedad que el punto flotante NO tiene, y aquí hay magnitudes que
    // van de 0.00832 a 59.78 en la misma suma.
    const alReves = costearCaso({ ...CASO_003, lineas: [...LINEAS_CC_003].reverse() });

    expect(alReves.costos.costoNetoLote.equals(costeo.costos.costoNetoLote)).toBe(true);
    expect(alReves.costos.costoTotalUnidad.equals(costeo.costos.costoTotalUnidad)).toBe(true);
  });
});

// --- CC-004 · R4 ------------------------------------------------------------

describe('CC-004 — el mismo ítem en base AP y en base EP (R4)', () => {
  const costos = costosDe(INS_113);
  const cantidad = Ratio.fromDecimalString('1.5');

  const enEP = costoDeLinea({ cantidad, base: 'EP', estado: 'ACTIVA', costos });
  const enAP = costoDeLinea({ cantidad, base: 'AP', estado: 'ACTIVA', costos });

  it('EP aplica el rendimiento — y este número lo tiene el Excel', () => {
    esperarValor(enEP, '0.4615384615');
  });

  it('AP no lo aplica — calculado a mano desde SPEC §13', () => {
    esperarValor(enAP, '0.30');
  });

  it('los dos resultados son DISTINTOS, que es lo que hace válida la prueba', () => {
    expect(enEP.equals(enAP)).toBe(false);
    expect(enEP.greaterThan(enAP)).toBe(true);
    esperarValor(enEP.minus(enAP), '0.161538461538');
  });

  it('con rendimiento 1 los dos coinciden: por eso el caso usa 0.65', () => {
    // Este bloque NO valida R4. Está para dejar constancia de por qué un ítem
    // con rendimiento 1 no sirve de prueba: ahí pasa cualquier implementación,
    // incluida la invertida.
    const sinMerma = costosDe(INS_074);
    const ep = costoDeLinea({ cantidad, base: 'EP', estado: 'ACTIVA', costos: sinMerma });
    const ap = costoDeLinea({ cantidad, base: 'AP', estado: 'ACTIVA', costos: sinMerma });

    expect(ep.equals(ap)).toBe(true);
  });
});

// --- CC-005 · la cascada ----------------------------------------------------

const SALSA_DE_QUESO = itemId('00000000-0000-4000-8000-000000000131');
const QUESO = itemId('00000000-0000-4000-8000-000000000122');
const HUEVO = itemId('00000000-0000-4000-8000-000000000057');

/**
 * La salsa de queso con receta propia — y también con el precio estándar que
 * heredó del Excel. Tener las dos cosas es justo la situación en la que la
 * precedencia importa.
 */
function catalogoDeLaSalsa(precioDelQueso: string): CatalogoCosteable {
  const items = new Map<ItemId, ItemCosteable>();

  items.set(QUESO, {
    rendimiento: UNO,
    costosDePrecio: costosDe({ ...INS_122, precio: precioDelQueso }),
    receta: null,
  });
  items.set(HUEVO, { rendimiento: UNO, costosDePrecio: costosDe(INS_057), receta: null });

  items.set(SALSA_DE_QUESO, {
    rendimiento: UNO,
    costosDePrecio: costosDe(INS_131),
    receta: [
      { itemId: QUESO, cantidad: Ratio.fromDecimalString('0.032'), base: 'EP', estado: 'ACTIVA' },
      { itemId: HUEVO, cantidad: Ratio.fromDecimalString('0.2'), base: 'EP', estado: 'ACTIVA' },
    ],
  });

  return items;
}

function costosDeLaSalsa(precioDelQueso: string): CostosDelItem {
  const costos = resolverCostos(catalogoDeLaSalsa(precioDelQueso)).porItem.get(SALSA_DE_QUESO);
  if (costos === undefined) {
    throw new Error('La cascada no resolvió la subpreparación.');
  }
  return costos;
}

/** CC-002 entero, pero con la salsa costeada por la CASCADA, no por su precio. */
function costearCC002ConCascada(precioDelQueso: string): CosteoDeProducto {
  return costearCaso({
    ...CASO_002,
    costosResueltos: new Map([[INS_131, costosDeLaSalsa(precioDelQueso)]]),
  });
}

describe('CC-005 — subpreparación anidada costeada en cascada', () => {
  it('la cascada reproduce el 0.20 que el Excel tenía escrito a mano', () => {
    esperarValor(costosDeLaSalsa('5.50').costoNetoDeUso, '0.200000');
  });

  it('CC-002 no se mueve ni un decimal al costear la salsa por su receta', () => {
    // ESTA es la aserción fuerte del caso. El número esperado no lo calculo yo:
    // es el `1.098548462` que V_COSTEO ya tenía. Si la cascada estuviera mal,
    // CC-002 dejaría de cuadrar.
    const conCascada = costearCC002ConCascada('5.50');

    esperarValor(conCascada.costos.costoNetoLote, '1.098548462');
    esperarValor(conCascada.costos.costoTotalUnidad, '1.163997692');
    esperarValor(exigirVendible(conCascada.venta).margenContribucion, '1.879480569');
  });

  it('sube el queso y el plato sube con él — lo que el Excel no hacía', () => {
    esperarValor(costosDeLaSalsa('6.00').costoNetoDeUso, '0.216000');

    const conSalsaCara = costearCC002ConCascada('6.00');

    esperarValor(conSalsaCara.costos.costoBrutoLote, '0.95301');
    esperarValor(conSalsaCara.costos.costoNetoLote, '1.114548462');
    esperarValor(conSalsaCara.costos.costoConMerma, '1.136839431');
    esperarValor(conSalsaCara.costos.costoTotalUnidad, '1.180317692');
  });

  it('si hay receta manda la receta; sin receta manda el precio estándar', () => {
    // Con receta: el precio estándar de 0.20 queda ignorado.
    expect(costosDeLaSalsa('6.00').costoNetoDeUso.equals(Money.fromDecimalString('0.20'))).toBe(
      false,
    );

    // Sin receta: manda el precio. Es cómo llegan las 24 filas `SUB` del Excel.
    const sinReceta = new Map<ItemId, ItemCosteable>([
      [SALSA_DE_QUESO, { rendimiento: UNO, costosDePrecio: costosDe(INS_131), receta: null }],
    ]);
    const costos = resolverCostos(sinReceta).porItem.get(SALSA_DE_QUESO);
    esperarValor(costos?.costoNetoDeUso ?? Money.CERO, '0.20');
  });

  it('un ítem sin precio y sin receta cuesta cero, y se AVISA', () => {
    const huerfano = itemId('00000000-0000-4000-8000-000000000999');
    const catalogo = new Map<ItemId, ItemCosteable>([
      [huerfano, { rendimiento: UNO, costosDePrecio: null, receta: null }],
    ]);

    const resueltos = resolverCostos(catalogo);
    expect(resueltos.porItem.get(huerfano)?.costoNetoDeUso.isZero()).toBe(true);
    // El aviso es lo que impide que un plato salga barato en silencio.
    expect(resueltos.sinCosto).toStrictEqual([huerfano]);
  });

  it('un ciclo entre subpreparaciones da error, no un cuelgue', () => {
    const a = itemId('00000000-0000-4000-8000-00000000000a');
    const b = itemId('00000000-0000-4000-8000-00000000000b');
    const conCiclo = new Map<ItemId, ItemCosteable>([
      [
        a,
        {
          rendimiento: UNO,
          costosDePrecio: null,
          receta: [{ itemId: b, cantidad: UNO, base: 'EP', estado: 'ACTIVA' }],
        },
      ],
      [
        b,
        {
          rendimiento: UNO,
          costosDePrecio: null,
          receta: [{ itemId: a, cantidad: UNO, base: 'EP', estado: 'ACTIVA' }],
        },
      ],
    ]);

    expect(() => resolverCostos(conCiclo)).toThrow(CicloEnCascadaError);
  });

  it('un rombo de 25 niveles se resuelve — y da el número exacto', () => {
    // A cada nivel, X{i} usa A{i} y B{i}, y los dos usan X{i+1}. Sin memorizar,
    // el recorrido visitaría 2^25 = 33.554.432 nodos y esta prueba no
    // terminaría; con memorización son 76 y termina en milisegundos.
    //
    // Y no se conforma con terminar: el costo es 2^25 veces la hoja, que es un
    // número exacto. Un recorrido que se saltara ramas terminaría igual de
    // rápido y daría otro número.
    const { catalogo, raiz } = rombosEncadenados(NIVELES_DEL_ROMBO);

    const costos = resolverCostos(catalogo).porItem.get(raiz);

    // 2^25 × 0.12 = 4.026.531,84
    esperarValor(costos?.costoNetoDeUso ?? Money.CERO, '4026531.84');
  });
});

const NIVELES_DEL_ROMBO = 25;

/**
 * Rombos encadenados: la forma que hace exponencial un recorrido sin memorizar.
 *
 * ```
 *   X0 → A0, B0        A0 → X1        B0 → X1
 *   X1 → A1, B1        A1 → X2        B1 → X2        …
 *   X25 = hoja con precio
 * ```
 */
function rombosEncadenados(niveles: number): {
  readonly catalogo: CatalogoCosteable;
  readonly raiz: ItemId;
} {
  const nodo = (etiqueta: string): ItemId =>
    itemId(`00000000-0000-4000-8000-${etiqueta.padStart(12, '0')}`);

  const conHijos = (hijos: readonly ItemId[]): ItemCosteable => ({
    rendimiento: UNO,
    costosDePrecio: null,
    receta: hijos.map((destino) => ({
      itemId: destino,
      cantidad: UNO,
      base: 'EP',
      estado: 'ACTIVA',
    })),
  });

  const catalogo = new Map<ItemId, ItemCosteable>();

  for (let nivel = 0; nivel < niveles; nivel += 1) {
    const [x, a, b, siguiente] = [
      nodo(`1${String(nivel)}`),
      nodo(`2${String(nivel)}`),
      nodo(`3${String(nivel)}`),
      nodo(`1${String(nivel + 1)}`),
    ];

    catalogo.set(x, conHijos([a, b]));
    catalogo.set(a, conHijos([siguiente]));
    catalogo.set(b, conHijos([siguiente]));
  }

  // La hoja: 0.12 por unidad de uso, el huevo de CC-002.
  catalogo.set(nodo(`1${String(niveles)}`), {
    rendimiento: UNO,
    costosDePrecio: costosDe(INS_057),
    receta: null,
  });

  return { catalogo, raiz: nodo('10') };
}

// --- CC-006 · combo ---------------------------------------------------------

describe('CC-006 — combo de dos productos simples', () => {
  const TAMAL = Money.fromDecimalString('0.5636782609');
  const EMPANADA = Money.fromDecimalString('0.5138083124');

  function combinar(empaquePropio: Money): ReturnType<typeof costearCombo> {
    return costearCombo({
      componentes: [
        { cantidad: UNO, costoTotalUnidad: TAMAL },
        { cantidad: UNO, costoTotalUnidad: EMPANADA },
      ],
      empaqueNeto: empaquePropio,
      pvp: Money.fromDecimalString('4.00'),
      ivaVenta: IVA_VENTA,
    });
  }

  const combo = combinar(Money.CERO);
  const venta = exigirVendible(combo.venta);

  it('el costo es la suma exacta de los COSTO_TOTAL_UNIDAD de V_COSTEO', () => {
    esperarValor(combo.costoTotalUnidad, '1.0774865733');
    expect(combo.costoTotalUnidad.equals(TAMAL.plus(EMPANADA))).toBe(true);
  });

  it('calcula venta y margen sobre el PVP del combo, no sobre los sueltos', () => {
    // El PVP del combo (4.00) es menor que la suma de los sueltos (1.80 + 2.50):
    // ese descuento es del combo y NO se prorratea entre los componentes.
    esperarValor(venta.ventaNeta, '3.478260869565');
    esperarValor(venta.ivaEnPrecio, '0.521739130435');
    esperarValor(venta.margenContribucion, '2.400774296265');
    expect(venta.foodCostPct.round(PRESENTACION).toExactString()).toBe('0.31');
    expect(venta.mcPct.round(PRESENTACION).toExactString()).toBe('0.69');
    expect((venta.multiplicador ?? Ratio.CERO).round(PRESENTACION).toExactString()).toBe('3.23');
  });

  it('no vuelve a aplicar la merma: los componentes ya la llevan dentro (R12)', () => {
    const siLaCobraraDosVeces = combo.costoTotalUnidad.times(MERMA_NO_ATRIBUIBLE.onePlus());
    expect(combo.costoTotalUnidad.equals(siLaCobraraDosVeces)).toBe(false);
    esperarValor(combo.costoTotalUnidad, '1.0774865733');
  });

  it('el empaque propio del combo se suma UNA vez', () => {
    const enBandeja = combinar(empaqueNeto());
    expect(enBandeja.costoTotalUnidad.minus(combo.costoTotalUnidad).equals(empaqueNeto())).toBe(
      true,
    );
  });

  it('la suma de control del combo también da 1 (R6)', () => {
    expect(venta.sumaControl.equals(Ratio.UNO)).toBe(true);
    expect(venta.margenContribucion.plus(combo.costoTotalUnidad).equals(venta.ventaNeta)).toBe(
      true,
    );
  });
});

// --- CC-007 · IVA no recuperable --------------------------------------------

describe('CC-007 — iva_recuperable = false (R13)', () => {
  const ITEMS_CC_003: readonly DatosDeItem[] = [
    INS_112,
    INS_100,
    INS_072,
    INS_004,
    INS_125,
    INS_029,
    INS_109,
    INS_063,
    INS_046,
    INS_043,
    INS_081,
  ];

  it('cada ítem sube exactamente el IVA DE SU PROPIO PRECIO', () => {
    for (const item of ITEMS_CC_003) {
      const recuperable = costosDe(item, true).costoNetoDeUso;
      const noRecuperable = costosDe(item, false).costoNetoDeUso;
      const iva = Ratio.fromDecimalString(item.iva);

      const desvio = noRecuperable.minus(recuperable.times(iva.onePlus())).abs();
      expect(desvio.compare(Money.fromDecimalString('0.00000000001'))).toBeLessThanOrEqual(0);
    }
  });

  it('cambian exactamente 3 de los 11: la tasa es del precio, no de la company', () => {
    // ES LA ASERCIÓN QUE DISCRIMINA. Una implementación con una tasa única de
    // company movería los once ítems.
    const cambian = ITEMS_CC_003.filter(
      (item) => !costosDe(item, true).costoNetoDeUso.equals(costosDe(item, false).costoNetoDeUso),
    );

    expect(cambian).toHaveLength(3);
    expect(cambian.map((i) => i.precio)).toStrictEqual(['4.00', '4.42', '8.38']);
  });

  it('el empaque cambia igual que los ítems (R13)', () => {
    esperarValor(empaqueNeto(true), '0.04347826087');
    esperarValor(empaqueNeto(false), '0.05');
  });

  it('el lote sube exactamente la suma de los tres IVA no recuperados', () => {
    const conIva = costearCaso(CASO_003);
    const sinIva = costearCaso({ ...CASO_003, ivaRecuperable: false });

    const delta = sinIva.costos.costoNetoLote.minus(conIva.costos.costoNetoLote);
    esperarValor(delta, '0.798547826087');
  });
});

// --- CC-009 · los bordes ----------------------------------------------------

describe('CC-009 — los bordes que no pueden dividir por cero', () => {
  it('rendimiento_porciones = 0 da costo por porción 0, sin lanzar', () => {
    const costeo = costearCaso({ ...CASO_002, rendimientoPorciones: '0' });

    expect(costeo.costos.costoPorPorcion.isZero()).toBe(true);
    expect(costeo.costos.costoConMerma.isZero()).toBe(true);
    esperarValor(costeo.costos.costoTotalUnidad, '0.04347826087');
    // El lote sí se calculó: lo que falta es en cuántas porciones repartirlo.
    esperarValor(costeo.costos.costoNetoLote, '1.098548462');
  });

  it('factor_conversion = 0 y rendimiento = 0 dan cero, no infinito', () => {
    const sinFactor = costosDe({ ...INS_135, factor: '0' });
    expect(sinFactor.costoBrutoDeUso.isZero()).toBe(true);
    expect(sinFactor.costoNetoDeUso.isZero()).toBe(true);

    const sinRendimiento = costosDe({ ...INS_135, rendimiento: '0' });
    esperarValor(sinRendimiento.costoBrutoDeUso, '0.51');
    expect(sinRendimiento.costoNetoDeUso.isZero()).toBe(true);
  });

  it('sin PVP: los costos se calculan y el lado de venta dice por qué no está', () => {
    const costeo = costearCaso({ ...CASO_002, pvp: null });

    esperarValor(costeo.costos.costoTotalUnidad, '1.163997692');
    expect(costeo.venta.clase).toBe('sin_precio');
    // Ausente, NO cero. Un food cost de 0 % se lee como «este plato no cuesta
    // nada», que es lo contrario de la verdad.
    expect(costeo.venta).not.toHaveProperty('foodCostPct');
  });

  it('costo_bruto_lote = 0 da impacto_merma null, no 0', () => {
    const sinLineas = costearCaso({ ...CASO_001, lineas: [] });
    expect(sinLineas.costos.impactoMerma).toBeNull();
  });
});

// --- R6, sobre los tres casos del Excel -------------------------------------

describe('R6 — la suma de control da exactamente 1', () => {
  const CASOS = [
    { nombre: 'CC-001', caso: CASO_001 },
    { nombre: 'CC-002', caso: CASO_002 },
    { nombre: 'CC-003', caso: CASO_003 },
  ];

  for (const caso of CASOS) {
    it(`${caso.nombre}: margen + costo = venta neta, exacto`, () => {
      const costeo = costearCaso(caso.caso);
      const venta = exigirVendible(costeo.venta);

      // ESTA es la afirmación con contenido. La suma de los porcentajes da 1
      // por construcción —el margen es el complemento del food cost—, así que
      // comprobarla sola no probaría nada. Lo que sí se puede romper es la
      // identidad de importes de la que salen los dos porcentajes.
      expect(
        venta.margenContribucion.plus(costeo.costos.costoTotalUnidad).equals(venta.ventaNeta),
      ).toBe(true);

      expect(venta.sumaControl.equals(Ratio.UNO)).toBe(true);
    });

    it(`${caso.nombre}: el margen calculado por división coincide con el complemento`, () => {
      const costeo = costearCaso(caso.caso);
      const venta = exigirVendible(costeo.venta);

      // Que R6 sea cierta por construcción no puede tapar un error: el margen
      // dividido a mano tiene que dar lo mismo que el complemento.
      const porDivision = venta.margenContribucion.ratioTo(venta.ventaNeta);
      expect(alaPrecisionDelExcel(porDivision, '0.0000000000')).toBe(
        alaPrecisionDelExcel(venta.mcPct, '0.0000000000'),
      );
    });
  }
});

// --- CC-R7 · la conciliación, ahora A TRAVÉS DEL MOTOR ----------------------

/**
 * R7: `ROUND(costo_ventas_teorico − costo_ventas_segun_costeo, 2)` = **0**.
 *
 * **QUÉ CAMBIA RESPECTO DE LA VERSIÓN DE P0.** Aquella corría dentro del módulo
 * de aritmética y sus entradas eran los valores de `V_COSTEO` transcritos a
 * mano: demostraba que las escalas y el redondeo sostienen R7, no que el motor
 * la cumpla. Ésta parte de los ÍTEMS y las LÍNEAS, y `costo_por_porcion`,
 * `venta_neta` y `margen_contribucion` los produce `costearProducto`. Si el
 * motor deriva, aquí se ve.
 *
 * La versión con el dataset completo —compras reales y conteo físico— es de P8,
 * que es donde existen el libro de inventario y el período.
 *
 * LAS UNIDADES SON EL ÚNICO DATO QUE NO SALE DEL EXCEL: `T2_PRODUCTOS` trae 0
 * en los 48 productos porque el libro no tiene dimensión temporal (SPEC §3).
 * Se declaran aquí, igual que en `docs/pruebas/casos-conocidos.md`.
 */
describe('CC-R7 — la conciliación a través del motor', () => {
  const DEL_MES = [
    { costeo: costearCaso(CASO_001), unidades: Count.fromInteger(120) },
    { costeo: costearCaso(CASO_002), unidades: Count.fromInteger(85) },
    { costeo: costearCaso(CASO_003), unidades: Count.fromInteger(340) },
  ];

  /** SPEC §16: consumo + empaque + provisión de merma. */
  const teorico = Money.sum(
    DEL_MES.flatMap(({ costeo, unidades }) => [
      costeo.costos.costoPorPorcion.times(unidades),
      costeo.costos.empaqueNeto.times(unidades),
      costeo.costos.costoPorPorcion.times(MERMA_NO_ATRIBUIBLE).times(unidades),
    ]),
  );

  /** SPEC §16: `venta_neta_mes_total − mc_mes_total`. */
  const segunCosteo = Money.sum(
    DEL_MES.map(({ costeo, unidades }) => {
      const { ventaNetaMes, mcMes } = totalesDelMes({
        venta: exigirVendible(costeo.venta),
        unidades,
      });
      return ventaNetaMes.minus(mcMes);
    }),
  );

  const diferencia = teorico.minus(segunCosteo);

  it('DIFERENCIA_CONCILIACION redondeada a 2 decimales da exactamente 0', () => {
    expect(diferencia.round(PRESENTACION).toDisplayString()).toBe('0.00');
  });

  it('el canario: la diferencia sin redondear es despreciable', () => {
    // El contrato sigue en verde mientras la deriva sea menor que medio
    // centavo, así que un motor que empieza a derivar pasaría la prueba durante
    // meses. El canario se rompe cinco órdenes de magnitud antes, en el commit
    // que introdujo la deriva. Si algún día falla éste y no el de arriba, no se
    // relaja el umbral: se busca qué pasó.
    expect(diferencia.abs().compare(Money.fromDecimalString('0.000001'))).toBeLessThanOrEqual(0);
  });

  it('no concilia por ser cero: los dos lados son importes reales', () => {
    expect(teorico.isZero()).toBe(false);
    expect(teorico.compare(Money.fromDecimalString('300'))).toBe(1);
  });

  it('si se olvida la provisión de merma, la conciliación SE ROMPE', () => {
    // Prueba de que discrimina. Un R7 que da 0 con y sin uno de sus términos no
    // está comprobando nada.
    const sinMerma = Money.sum(
      DEL_MES.flatMap(({ costeo, unidades }) => [
        costeo.costos.costoPorPorcion.times(unidades),
        costeo.costos.empaqueNeto.times(unidades),
      ]),
    );

    expect(sinMerma.minus(segunCosteo).round(PRESENTACION).toDisplayString()).not.toBe('0.00');
  });

  it('si se olvida el empaque, la conciliación SE ROMPE', () => {
    const sinEmpaque = Money.sum(
      DEL_MES.flatMap(({ costeo, unidades }) => [
        costeo.costos.costoPorPorcion.times(unidades),
        costeo.costos.costoPorPorcion.times(MERMA_NO_ATRIBUIBLE).times(unidades),
      ]),
    );

    expect(sinEmpaque.minus(segunCosteo).round(PRESENTACION).toDisplayString()).not.toBe('0.00');
  });
});
