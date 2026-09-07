/**
 * Un descriptor por tipo de importación: qué columnas, qué es válido.
 *
 * LOS CINCO SON DATOS, NO PROGRAMAS. El motor de `analisis.ts` es el mismo para
 * todos; aquí solo se declara qué espera cada uno. Sin esta separación,
 * «importar ítems» e «importar recetas» serían dos programas parecidos y cada
 * arreglo habría que hacerlo cinco veces — que es exactamente cómo se pudren
 * los importadores.
 *
 * LAS REGLAS SON LAS DEL ENDPOINT, NO UNAS PROPIAS. Un ítem importado tiene que
 * ser indistinguible de uno creado a mano: mismo `tipo`, misma `confianza`,
 * mismo rendimiento entre 0 y 1. Si el importador fuera más permisivo, sería
 * una puerta trasera al catálogo, y CLAUDE.md §2 dice que el catálogo es fuente
 * única de verdad. Lo que sí cambia es **cómo se dice el error**: por endpoint
 * basta un 400; aquí hay que decir en qué fila y en qué columna.
 *
 * `LNK` SE RECHAZA FILA A FILA, Y AHORA SE SABE POR QUÉ. **D4 está cerrada**:
 * `LNK` no era un tipo de insumo, era el apaño con el que el Excel original
 * armaba un COMBO — la celda de precio de esas filas es un `INDEX/MATCH` al
 * costo por porción de un producto de venta. En este sistema eso es un
 * `combo_component` (SPEC §8, ADR-014), no un ítem. Así que la fila se rechaza
 * y el mensaje dice dónde va de verdad, en vez de pedir que alguien adivine.
 *
 * ES DOMINIO PURO: entran celdas de texto, salen problemas o valores.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import type { ProblemaDeFilaCruda, Descriptor } from './analisis';
import { celda, type Columna } from './columnas';

/** Un decimal tal como puede venir de una hoja: con coma o con punto. */
const DECIMAL = /^\d+(?:[.,]\d+)?$/u;

const TIPOS_DE_ITEM = new Set(['COMPRADO', 'PRODUCIDO']);
const CONFIANZAS = new Set(['FACTURA', 'ESTIMADO']);
const BASES = new Set(['AP', 'EP']);
const TIPOS_DE_MOVIMIENTO = new Set(['COMPRA', 'MERMA', 'AJUSTE']);

/** El tipo del Excel original que resultó ser un componente de combo. Ver D4. */
const TIPO_SIN_RESOLVER = 'LNK';

const NOMBRE_MAXIMO = 200;

/** El techo del rendimiento: nada aprovecha mas de lo que entra. */
const UNO = Ratio.fromDecimalString('1');

/** Un dia y un mes ocupan dos digitos: `3/7/2026` es `2026-07-03`. */
const DIGITOS_DE_FECHA = 2;

/**
 * Normaliza el decimal de una hoja de cálculo.
 *
 * **Excel en español escribe `1,20`.** Rechazarlo obligaría al usuario a
 * reformatear doscientas celdas, y aceptarlo mal —tratando la coma como
 * separador de miles— convertiría 1,20 en 120. La coma se cambia por punto y
 * ya: en una celda de importe no hay separador de miles que valga, porque
 * `1.234,50` tampoco casa con `DECIMAL` y se rechaza con su motivo.
 */
function comoDecimal(valor: string): string {
  return valor.replace(',', '.');
}

function texto(clave: string, alias: readonly string[], obligatoria = true): Columna {
  return { clave, alias, obligatoria };
}

// --- validadores reutilizables ---------------------------------------------

function exigirNombre(valor: string): ProblemaDeFilaCruda | null {
  if (valor === '') return { columna: 'nombre', motivo: 'El nombre no puede estar vacío.' };
  if (valor.length > NOMBRE_MAXIMO) {
    return { columna: 'nombre', motivo: `El nombre pasa de ${String(NOMBRE_MAXIMO)} caracteres.` };
  }
  return null;
}

function exigirDecimal(
  columna: string,
  valor: string,
  opcional = false,
): ProblemaDeFilaCruda | null {
  if (valor === '') {
    return opcional ? null : { columna, motivo: 'Falta el valor.' };
  }
  return DECIMAL.test(comoDecimal(valor))
    ? null
    : { columna, motivo: `"${valor}" no es un número. Escríbelo como 1.20 o 1,20.` };
}

function exigirDeLaLista(
  columna: string,
  valor: string,
  admitidos: ReadonlySet<string>,
): ProblemaDeFilaCruda | null {
  if (admitidos.has(valor.toUpperCase())) return null;

  return {
    columna,
    motivo: `"${valor}" no vale aquí. Los valores admitidos son: ${[...admitidos].join(', ')}.`,
  };
}

/** Recoge los problemas y descarta los huecos, que es lo que se repite. */
function reunir(
  ...encontrados: readonly (ProblemaDeFilaCruda | null)[]
): readonly ProblemaDeFilaCruda[] {
  return encontrados.filter((problema): problema is ProblemaDeFilaCruda => problema !== null);
}

// --- ÍTEMS ------------------------------------------------------------------

const COLUMNAS_DE_ITEM: readonly Columna[] = [
  texto('nombre', ['nombre', 'insumo', 'descripcion']),
  texto('tipo', ['tipo']),
  texto('unidadDeUso', ['unidad de uso', 'unidad', 'unidad_de_uso']),
  texto('rendimiento', ['rendimiento', 'aprovechamiento']),
  texto('confianzaDePrecio', ['confianza', 'confianza de precio'], false),
  texto('grupo', ['grupo', 'categoria'], false),
];

export const ITEMS: Descriptor = {
  tipo: 'ITEMS',
  columnas: COLUMNAS_DE_ITEM,

  validar(fila, cabecera) {
    const tipo = celda(fila, cabecera, 'tipo').toUpperCase();

    // EL RECHAZO DE `LNK` VA PRIMERO Y SOLO. Si se dejara caer en la lista de
    // valores admitidos, el usuario leeria «los valores admitidos son
    // COMPRADO, PRODUCIDO» y creeria que se equivoco al escribir. Lo que pasa
    // es otra cosa, y el mensaje tiene que decirla.
    if (tipo === TIPO_SIN_RESOLVER) {
      return [
        {
          columna: 'tipo',
          motivo:
            'LNK no es un tipo de insumo: en el Excel original marcaba un producto de la carta ' +
            'usado dentro de un combo. Aquí eso se carga como producto de tipo COMBO con sus ' +
            'componentes, no como ítem. Quita esta fila.',
        },
      ];
    }

    const rendimiento = celda(fila, cabecera, 'rendimiento');
    const confianza = celda(fila, cabecera, 'confianzaDePrecio');

    return reunir(
      exigirNombre(celda(fila, cabecera, 'nombre')),
      exigirDeLaLista('tipo', tipo, TIPOS_DE_ITEM),
      celda(fila, cabecera, 'unidadDeUso') === ''
        ? { columna: 'unidad de uso', motivo: 'Falta la unidad de uso.' }
        : null,
      exigirDecimal('rendimiento', rendimiento),
      exigirRendimientoEnRango(rendimiento),
      confianza === '' ? null : exigirDeLaLista('confianza', confianza, CONFIANZAS),
    );
  },

  extraer(fila, cabecera) {
    return {
      nombre: celda(fila, cabecera, 'nombre'),
      tipo: celda(fila, cabecera, 'tipo').toUpperCase(),
      unidadDeUso: celda(fila, cabecera, 'unidadDeUso'),
      rendimiento: comoDecimal(celda(fila, cabecera, 'rendimiento')),
      confianzaDePrecio: (celda(fila, cabecera, 'confianzaDePrecio') || 'ESTIMADO').toUpperCase(),
      grupo: celda(fila, cabecera, 'grupo'),
    };
  },
};

/**
 * El rendimiento es una fracción aprovechable: 0 < r ≤ 1.
 *
 * **Un rendimiento de 1,15 no es un error de tecleo, es un ítem que rinde más
 * de lo que entra**, y eso abarataría el costo de uso en vez de encarecerlo
 * (SPEC §12). Se rechaza aquí, en la fila, y no en la base: un `23514` en la
 * fila 150 de un archivo de 200 no le dice nada a nadie. Es la lección de
 * INC-012.
 */
function exigirRendimientoEnRango(valor: string): ProblemaDeFilaCruda | null {
  if (!DECIMAL.test(comoDecimal(valor))) return null;

  // `Ratio` Y NO `parseFloat`. Un rendimiento es un decimal del dominio, y
  // compararlo en punto flotante es la puerta que `audit:forbidden` cierra:
  // `0.1 + 0.2 > 0.3` es cierto en coma flotante y falso en la realidad.
  const rendimiento = Ratio.fromDecimalString(comoDecimal(valor));
  if (!rendimiento.isZero() && !rendimiento.greaterThan(UNO)) return null;

  return {
    columna: 'rendimiento',
    motivo: `El rendimiento es la fracción que se aprovecha: mayor que 0 y como mucho 1. "${valor}" no lo es.`,
  };
}

// --- ARTÍCULOS DE COMPRA ----------------------------------------------------

const COLUMNAS_DE_ARTICULO: readonly Columna[] = [
  texto('item', ['item', 'insumo', 'nombre del item']),
  texto('nombre', ['nombre', 'articulo', 'presentacion comercial']),
  texto('presentacion', ['presentacion', 'contenido', 'cantidad']),
  texto('unidadDePresentacion', ['unidad de presentacion', 'unidad']),
  texto('marca', ['marca'], false),
  texto('proveedor', ['proveedor'], false),
  texto('factorExplicito', ['factor', 'factor de conversion'], false),
];

export const ARTICULOS: Descriptor = {
  tipo: 'ARTICULOS',
  columnas: COLUMNAS_DE_ARTICULO,

  validar(fila, cabecera) {
    return reunir(
      celda(fila, cabecera, 'item') === ''
        ? { columna: 'item', motivo: 'Falta el ítem al que pertenece este artículo.' }
        : null,
      exigirNombre(celda(fila, cabecera, 'nombre')),
      exigirDecimal('presentacion', celda(fila, cabecera, 'presentacion')),
      celda(fila, cabecera, 'unidadDePresentacion') === ''
        ? { columna: 'unidad de presentacion', motivo: 'Falta la unidad de la presentación.' }
        : null,
      exigirDecimal('factor', celda(fila, cabecera, 'factorExplicito'), true),
    );
  },

  extraer(fila, cabecera) {
    return {
      item: celda(fila, cabecera, 'item'),
      nombre: celda(fila, cabecera, 'nombre'),
      presentacion: comoDecimal(celda(fila, cabecera, 'presentacion')),
      unidadDePresentacion: celda(fila, cabecera, 'unidadDePresentacion'),
      marca: celda(fila, cabecera, 'marca'),
      proveedor: celda(fila, cabecera, 'proveedor'),
      factorExplicito: comoDecimal(celda(fila, cabecera, 'factorExplicito')),
    };
  },
};

// --- PRODUCTOS --------------------------------------------------------------

const COLUMNAS_DE_PRODUCTO: readonly Columna[] = [
  texto('nombre', ['nombre', 'producto', 'plato']),
  texto('tipo', ['tipo'], false),
  texto('categoria', ['categoria', 'grupo'], false),
  texto('pvp', ['pvp', 'precio', 'precio de venta'], false),
  texto('rendimientoPorciones', ['porciones', 'rendimiento porciones'], false),
  texto('empaque', ['empaque', 'envase'], false),
  texto('activo', ['activo', 'se vende'], false),
];

const TIPOS_DE_PRODUCTO = new Set(['SIMPLE', 'COMBO']);

/** Lo que una hoja escribe para decir que si. Todo lo demas es que no. */
const AFIRMATIVOS = new Set(['SI', 'SÍ', 'S', 'TRUE', 'X', '1', 'ACTIVO']);

export const PRODUCTOS: Descriptor = {
  tipo: 'PRODUCTOS',
  columnas: COLUMNAS_DE_PRODUCTO,

  validar(fila, cabecera) {
    const tipo = celda(fila, cabecera, 'tipo');
    const porciones = celda(fila, cabecera, 'rendimientoPorciones');

    return reunir(
      exigirNombre(celda(fila, cabecera, 'nombre')),
      tipo === '' ? null : exigirDeLaLista('tipo', tipo, TIPOS_DE_PRODUCTO),
      exigirDecimal('pvp', celda(fila, cabecera, 'pvp'), true),
      exigirDecimal('porciones', porciones, true),
      porciones !== '' &&
        DECIMAL.test(comoDecimal(porciones)) &&
        Ratio.fromDecimalString(comoDecimal(porciones)).isZero()
        ? {
            columna: 'porciones',
            motivo: 'Cero porciones dividiría por cero al costear. Deja la celda vacía si no lo sabes.',
          }
        : null,
    );
  },

  extraer(fila, cabecera) {
    return {
      nombre: celda(fila, cabecera, 'nombre'),
      tipo: (celda(fila, cabecera, 'tipo') || 'SIMPLE').toUpperCase(),
      categoria: celda(fila, cabecera, 'categoria'),
      pvp: comoDecimal(celda(fila, cabecera, 'pvp')),
      rendimientoPorciones: comoDecimal(celda(fila, cabecera, 'rendimientoPorciones')),
      empaque: celda(fila, cabecera, 'empaque'),
      // La columna ausente significa ACTIVO. Es lo que un archivo de carta
      // quiere decir: si esta escrito, se vende. Apagarlo se pide a proposito.
      activo: activoDe(celda(fila, cabecera, 'activo')),
    };
  },
};

// --- RECETAS ----------------------------------------------------------------

const COLUMNAS_DE_RECETA: readonly Columna[] = [
  texto('producto', ['producto', 'plato']),
  texto('item', ['item', 'insumo', 'ingrediente']),
  texto('cantidad', ['cantidad']),
  texto('base', ['base'], false),
];

export const RECETAS: Descriptor = {
  tipo: 'RECETAS',
  columnas: COLUMNAS_DE_RECETA,

  validar(fila, cabecera) {
    const base = celda(fila, cabecera, 'base');

    return reunir(
      celda(fila, cabecera, 'producto') === ''
        ? { columna: 'producto', motivo: 'Falta el producto de esta línea de receta.' }
        : null,
      celda(fila, cabecera, 'item') === ''
        ? { columna: 'item', motivo: 'Falta el ítem de esta línea de receta.' }
        : null,
      exigirDecimal('cantidad', celda(fila, cabecera, 'cantidad')),
      // LA BASE DECIDE SI SE APLICA EL RENDIMIENTO (R4), asi que un valor
      // desconocido no puede pasar por AP «por defecto»: cambiaria el costo.
      base === '' ? null : exigirDeLaLista('base', base, BASES),
    );
  },

  extraer(fila, cabecera) {
    return {
      producto: celda(fila, cabecera, 'producto'),
      item: celda(fila, cabecera, 'item'),
      cantidad: comoDecimal(celda(fila, cabecera, 'cantidad')),
      base: (celda(fila, cabecera, 'base') || 'AP').toUpperCase(),
    };
  },
};

// --- MOVIMIENTOS ------------------------------------------------------------

const COLUMNAS_DE_MOVIMIENTO: readonly Columna[] = [
  texto('item', ['item', 'insumo']),
  texto('tipo', ['tipo', 'movimiento']),
  texto('cantidad', ['cantidad']),
  texto('fecha', ['fecha', 'fecha del movimiento']),
  texto('costoTotal', ['importe', 'costo total', 'total'], false),
];

/** `2026-03-15` o `15/03/2026`. Las dos formas que salen de una hoja. */
const ISO = /^\d{4}-\d{2}-\d{2}$/u;
const LATINA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u;

export const MOVIMIENTOS: Descriptor = {
  tipo: 'MOVIMIENTOS',
  columnas: COLUMNAS_DE_MOVIMIENTO,

  validar(fila, cabecera) {
    const tipo = celda(fila, cabecera, 'tipo').toUpperCase();
    const importe = celda(fila, cabecera, 'costoTotal');

    return reunir(
      celda(fila, cabecera, 'item') === ''
        ? { columna: 'item', motivo: 'Falta el ítem del movimiento.' }
        : null,
      exigirDeLaLista('tipo', tipo, TIPOS_DE_MOVIMIENTO),
      exigirDecimal('cantidad', celda(fila, cabecera, 'cantidad')),
      exigirFecha(celda(fila, cabecera, 'fecha')),
      exigirDecimal('importe', importe, true),
      // UNA COMPRA SIN IMPORTE NO ES UN MOVIMIENTO INCOMPLETO: es un agujero en
      // `compras_del_mes`, y de ahi sale el food cost real de SPEC §16.
      tipo === 'COMPRA' && importe === ''
        ? { columna: 'importe', motivo: 'Una compra necesita su importe total.' }
        : null,
    );
  },

  extraer(fila, cabecera) {
    return {
      item: celda(fila, cabecera, 'item'),
      tipo: celda(fila, cabecera, 'tipo').toUpperCase(),
      cantidad: comoDecimal(celda(fila, cabecera, 'cantidad')),
      fecha: comoFechaIso(celda(fila, cabecera, 'fecha')),
      costoTotal: comoDecimal(celda(fila, cabecera, 'costoTotal')),
    };
  },
};

function exigirFecha(valor: string): ProblemaDeFilaCruda | null {
  if (ISO.test(valor) || LATINA.test(valor)) return null;

  return {
    columna: 'fecha',
    motivo: `"${valor}" no es una fecha. Escríbela como 2026-03-15 o 15/03/2026.`,
  };
}

/**
 * A `AAAA-MM-DD`, que es lo único que el resto del sistema entiende.
 *
 * **La hora la pone el caso de uso, no esta función**, y a las 12:00 de la zona
 * de los períodos. Un `2026-03-01T00:00:00Z` es el 28 de febrero a las 19:00 en
 * Guayaquil, y acabaría en el mes anterior — que es INC-013 exactamente.
 */
function comoFechaIso(valor: string): string {
  const latina = LATINA.exec(valor);
  if (latina === null) return valor;

  const [, dia = '', mes = '', anio = ''] = latina;
  return `${anio}-${mes.padStart(DIGITOS_DE_FECHA, '0')}-${dia.padStart(DIGITOS_DE_FECHA, '0')}`;
}

// --- PRECIOS ----------------------------------------------------------------

const COLUMNAS_DE_PRECIO: readonly Columna[] = [
  texto('item', ['item', 'insumo', 'nombre del item']),
  texto('articulo', ['articulo', 'presentacion comercial', 'articulo de compra'], false),
  texto('precio', ['precio', 'precio de compra', 'costo']),
  texto('ivaCompra', ['iva', 'iva compra', '% iva compra'], false),
  texto('nota', ['nota', 'observacion'], false),
];

/**
 * El precio de referencia de un item.
 *
 * **SIN ESTE DESCRIPTOR EL COSTEO NO DEVUELVE UN NUMERO.** Se puede importar el
 * catalogo entero —items, articulos, productos y recetas— y la carta seguiria
 * costando cero, porque el costo sale del precio vigente y no del articulo.
 *
 * El ORIGEN no se captura: todo lo que entra por aqui es `MANUAL`. `EXTERNO`
 * esta reservado para una integracion que D8 deja fuera de alcance, y
 * `ULTIMA_COMPRA` lo pone el sistema al registrar una compra, no un archivo.
 */
export const PRECIOS: Descriptor = {
  tipo: 'PRECIOS',
  columnas: COLUMNAS_DE_PRECIO,

  validar(fila, cabecera) {
    return reunir(
      celda(fila, cabecera, 'item') === ''
        ? { columna: 'item', motivo: 'Falta el item al que pertenece el precio.' }
        : null,
      exigirDecimal('precio', celda(fila, cabecera, 'precio')),
      exigirDecimal('iva', celda(fila, cabecera, 'ivaCompra'), true),
    );
  },

  extraer(fila, cabecera) {
    return {
      item: celda(fila, cabecera, 'item'),
      articulo: celda(fila, cabecera, 'articulo'),
      precio: comoDecimal(celda(fila, cabecera, 'precio')),
      ivaCompra: comoDecimal(celda(fila, cabecera, 'ivaCompra')),
      nota: celda(fila, cabecera, 'nota'),
    };
  },
};

/** `SI`, `X`, `1`… todo lo demas es que no. La celda vacia es que SI. */
function activoDe(valor: string): string {
  if (valor.trim() === '') return 'SI';
  return AFIRMATIVOS.has(valor.trim().toUpperCase()) ? 'SI' : 'NO';
}

export const DESCRIPTORES = {
  ITEMS,
  ARTICULOS,
  PRECIOS,
  PRODUCTOS,
  RECETAS,
  MOVIMIENTOS,
} as const;

