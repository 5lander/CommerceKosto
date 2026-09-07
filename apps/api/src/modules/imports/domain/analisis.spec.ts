/**
 * El análisis de un archivo, con la base apagada.
 *
 * Dos cosas se comprueban aquí y las dos son del criterio de aceptación:
 *
 *   - **Se recogen TODOS los problemas**, no el primero. Cortar en el primero
 *     convierte la importación en un juego de veinte preguntas.
 *   - **El número de fila es el que el usuario ve en Excel.** Un «error en la
 *     fila 149» que en su hoja es la 151 es peor que no decir nada.
 */

import { describe, expect, it } from 'vitest';

import { analizar, esAnalisis, type Analisis } from './analisis';
import { leerCabecera } from './columnas';
import { ARTICULOS, ITEMS, MOVIMIENTOS, PRODUCTOS, RECETAS } from './tipos';

const CABECERA_DE_ITEMS = ['nombre', 'tipo', 'unidad de uso', 'rendimiento'];

function analisisDe(filas: readonly (readonly string[])[]): Analisis {
  const resultado = analizar(filas, ITEMS);
  if (!esAnalisis(resultado)) throw new Error(`faltan columnas: ${resultado.faltantes.join(', ')}`);
  return resultado;
}

describe('cabecera — el usuario no debe pelearse con nombres exactos', () => {
  it('acepta tildes, mayúsculas y guiones bajos indistintamente', () => {
    const cabecera = leerCabecera(['Nombre', 'TIPO', 'unidad_de_uso', 'Rendimiento'], ITEMS.columnas);

    expect(cabecera.faltantes).toEqual([]);
    expect(cabecera.indices.get('unidadDeUso')).toBe(2);
  });

  it('el orden de las columnas da igual', () => {
    const cabecera = leerCabecera(['rendimiento', 'nombre', 'unidad', 'tipo'], ITEMS.columnas);

    expect(cabecera.indices.get('nombre')).toBe(1);
    expect(cabecera.indices.get('tipo')).toBe(3);
  });

  it('dice QUÉ columna falta, no «formato inválido»', () => {
    const resultado = analizar([['nombre', 'tipo']], ITEMS);

    expect(esAnalisis(resultado)).toBe(false);
    if (!esAnalisis(resultado)) {
      expect(resultado.faltantes).toContain('unidad de uso');
      expect(resultado.faltantes).toContain('rendimiento');
    }
  });

  it('una columna que el importador no conoce se devuelve, no se calla', () => {
    // Una columna que el usuario creía que se importaba y no se importaba es
    // una sorpresa cara. La previsualización la enseña.
    const cabecera = leerCabecera([...CABECERA_DE_ITEMS, 'observaciones'], ITEMS.columnas);

    expect(cabecera.ignoradas).toEqual(['observaciones']);
  });
});

describe('análisis — todos los problemas, con su número de fila', () => {
  it('la primera fila de datos es la 2, que es lo que se ve en Excel', () => {
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['', 'COMPRADO', 'kg', '1']]);

    expect(analisis.problemas[0]?.fila).toBe(2);
  });

  it('NO corta en el primer error: los recoge todos', () => {
    const analisis = analisisDe([
      CABECERA_DE_ITEMS,
      ['Tomate', 'COMPRADO', 'kg', '1'],
      ['', 'COMPRADO', 'kg', '1'],
      ['Cebolla', 'INVENTADO', 'kg', '1'],
      ['Ajo', 'COMPRADO', '', '1'],
    ]);

    expect(analisis.problemas.map((p) => p.fila)).toEqual([3, 4, 5]);
    expect(analisis.validas).toHaveLength(1);
  });

  it('una fila con dos problemas los dice los dos', () => {
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['', 'COMPRADO', '', '1']]);

    expect(analisis.problemas).toHaveLength(2);
    expect(analisis.problemas.map((p) => p.columna).sort()).toEqual(['nombre', 'unidad de uso']);
  });

  it('las filas en blanco del final no cuentan como errores', () => {
    // Quien selecciona hasta la fila 5.000 en Excel arrastra cuatro mil vacías.
    const analisis = analisisDe([
      CABECERA_DE_ITEMS,
      ['Tomate', 'COMPRADO', 'kg', '1'],
      ['', '', '', ''],
      ['  ', '', '', ''],
    ]);

    expect(analisis.total).toBe(1);
    expect(analisis.problemas).toEqual([]);
  });
});

describe('ÍTEMS', () => {
  it('una fila buena sale con sus valores en claro', () => {
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['Tomate riñón', 'comprado', 'kg', '0,85']]);

    expect(analisis.validas[0]?.valores).toMatchObject({
      nombre: 'Tomate riñón',
      tipo: 'COMPRADO',
      unidadDeUso: 'kg',
      // La coma de Excel en español se convierte, y el decimal sigue siendo
      // TEXTO: nunca pasa por punto flotante.
      rendimiento: '0.85',
    });
  });

  /** D4 sigue en 🔴: nadie sabe qué es un `LNK`. Ver DECISIONES.md. */
  it('el tipo LNK se rechaza con SU motivo, no como «valor no admitido»', () => {
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['Algo', 'LNK', 'kg', '1']]);

    expect(analisis.problemas).toHaveLength(1);
    expect(analisis.problemas[0]?.motivo).toContain('LNK');
    // Si cayera en la lista genérica, el usuario leería «los valores admitidos
    // son COMPRADO, PRODUCIDO» y creería que se equivocó al escribir.
    expect(analisis.problemas[0]?.motivo).not.toContain('no vale aquí');
  });

  it('un rendimiento mayor que 1 se rechaza en la FILA, no en la base', () => {
    // 1,15 no es un error de tecleo: es un ítem que rinde más de lo que entra,
    // y eso abarataría el costo de uso. Un 23514 en la fila 150 no dice nada.
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['Algo', 'COMPRADO', 'kg', '1.15']]);

    expect(analisis.problemas[0]?.columna).toBe('rendimiento');
  });

  it('la confianza de precio, si falta, es ESTIMADO — no se inventa FACTURA', () => {
    const analisis = analisisDe([CABECERA_DE_ITEMS, ['Algo', 'COMPRADO', 'kg', '1']]);

    expect(analisis.validas[0]?.valores['confianzaDePrecio']).toBe('ESTIMADO');
  });
});

describe('los otros cuatro descriptores', () => {
  it('ARTÍCULOS exige el ítem al que pertenece', () => {
    const resultado = analizar(
      [
        ['item', 'nombre', 'presentacion', 'unidad de presentacion'],
        ['', 'Caja 10 kg', '10', 'kg'],
      ],
      ARTICULOS,
    );

    expect(esAnalisis(resultado) && resultado.problemas[0]?.columna).toBe('item');
  });

  it('PRODUCTOS rechaza cero porciones: dividiría por cero al costear', () => {
    const resultado = analizar(
      [
        ['nombre', 'porciones'],
        ['Ceviche', '0'],
      ],
      PRODUCTOS,
    );

    expect(esAnalisis(resultado) && resultado.problemas[0]?.columna).toBe('porciones');
  });

  it('RECETAS: la base por defecto es AP, y una base inventada se rechaza', () => {
    const bueno = analizar(
      [
        ['producto', 'item', 'cantidad'],
        ['Ceviche', 'Tomate', '0.2'],
      ],
      RECETAS,
    );
    const malo = analizar(
      [
        ['producto', 'item', 'cantidad', 'base'],
        ['Ceviche', 'Tomate', '0.2', 'XX'],
      ],
      RECETAS,
    );

    // La base decide si se aplica el rendimiento (R4): un valor desconocido no
    // puede pasar por AP «por defecto», porque cambiaría el costo.
    expect(esAnalisis(bueno) && bueno.validas[0]?.valores['base']).toBe('AP');
    expect(esAnalisis(malo) && malo.problemas[0]?.columna).toBe('base');
  });

  it('MOVIMIENTOS: una COMPRA sin importe se rechaza; una MERMA no', () => {
    const cabecera = ['item', 'tipo', 'cantidad', 'fecha', 'importe'];
    const resultado = analizar(
      [
        cabecera,
        ['Tomate', 'COMPRA', '10', '2026-03-15', ''],
        ['Tomate', 'MERMA', '1', '2026-03-15', ''],
      ],
      MOVIMIENTOS,
    );

    expect(esAnalisis(resultado) && resultado.problemas).toHaveLength(1);
    expect(esAnalisis(resultado) && resultado.problemas[0]?.fila).toBe(2);
  });

  it('MOVIMIENTOS acepta la fecha latina y la normaliza a ISO', () => {
    const resultado = analizar(
      [
        ['item', 'tipo', 'cantidad', 'fecha'],
        ['Tomate', 'MERMA', '1', '3/7/2026'],
      ],
      MOVIMIENTOS,
    );

    expect(esAnalisis(resultado) && resultado.validas[0]?.valores['fecha']).toBe('2026-07-03');
  });
});
