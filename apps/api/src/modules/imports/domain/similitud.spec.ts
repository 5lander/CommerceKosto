/**
 * La deduplicación por parecido, con la base apagada.
 *
 * La prueba que manda es la del criterio de aceptación, literal: las tres
 * grafías de "tomate" tienen que dar **un** grupo. Y se corre en las **seis
 * permutaciones**, porque el agrupamiento por enlace simple depende del orden
 * en el caso general y lo que hay que saber es si depende en ESTE caso.
 *
 * El contraste con `pg_trgm` de verdad no está aquí: necesita PostgreSQL, así
 * que vive en la prueba de integración. Aquí se comprueban las propiedades.
 */

import { describe, expect, it } from 'vitest';

import { agruparParecidos, normalizar, parecido, trigramas } from './similitud';

/** Las seis permutaciones de tres elementos. */
function permutaciones<T>(valores: readonly T[]): readonly (readonly T[])[] {
  if (valores.length <= 1) return [valores];

  return valores.flatMap((valor, i) =>
    permutaciones([...valores.slice(0, i), ...valores.slice(i + 1)]).map((resto) => [
      valor,
      ...resto,
    ]),
  );
}

describe('normalizar', () => {
  it('quita tildes, baja a minúsculas y colapsa espacios', () => {
    expect(normalizar('  Tomate   RIÑÓN  ')).toBe('tomate rinon');
  });

  it('«riñón» y «rinon» quedan idénticos', () => {
    expect(normalizar('Tomate riñón')).toBe(normalizar('tomate riñon'));
  });
});

describe('trigramas — el relleno de pg_trgm', () => {
  it('rodea cada palabra de dos espacios delante y uno detrás', () => {
    expect([...trigramas('sal')].sort()).toEqual(['  s', ' sa', 'al ', 'sal']);
  });

  it('una palabra corta SÍ produce trigramas gracias al relleno', () => {
    // Sin el relleno, "de" no daría ninguno y dos ítems de nombre corto nunca
    // se parecerían a nada.
    expect(trigramas('de').size).toBeGreaterThan(0);
  });

  it('parte por lo que no es alfanumérico', () => {
    expect(trigramas('sal-fina')).toEqual(trigramas('sal fina'));
  });
});

describe('parecido', () => {
  it('idénticos dan 1', () => {
    expect(parecido('tomate', 'tomate')).toBe(1);
  });

  it('la diferencia de tildes y mayúsculas no cuenta', () => {
    expect(parecido('Tomate riñón', 'tomate riñon')).toBe(1);
  });

  it('cosas distintas quedan por debajo del umbral', () => {
    expect(parecido('tomate', 'cebolla')).toBeLessThan(0.3);
  });

  it('vacío contra vacío da CERO, no uno', () => {
    // Devolver 1 juntaría todas las filas sin nombre en un ítem fantasma.
    expect(parecido('', '')).toBe(0);
    expect(parecido('tomate', '')).toBe(0);
  });

  it('es simétrico', () => {
    expect(parecido('tomate riñón', 'TOMATE')).toBe(parecido('TOMATE', 'tomate riñón'));
  });
});

describe('EL CRITERIO DE ACEPTACIÓN de P10', () => {
  const TRES = ['Tomate riñón', 'tomate riñon', 'TOMATE'] as const;

  it('las tres grafías proponen UN ítem, no tres', () => {
    const grupos = agruparParecidos(TRES);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.variantes).toHaveLength(3);
  });

  it('y lo hacen en las SEIS permutaciones: el orden del archivo no decide', () => {
    for (const orden of permutaciones(TRES)) {
      expect(agruparParecidos(orden), orden.join(' · ')).toHaveLength(1);
    }
  });

  it('el nombre propuesto es el más largo, no el primero del archivo', () => {
    // "TOMATE" primero no debe ganar: el que sirve para reconocer el ítem
    // dentro de seis meses es el que trae la variedad.
    expect(agruparParecidos(['TOMATE', 'Tomate riñón'])[0]?.canonico).toBe('Tomate riñón');
  });

  it('dos insumos DISTINTOS siguen siendo dos ítems', () => {
    const grupos = agruparParecidos(['Tomate riñón', 'Cebolla perla', 'tomate riñon']);

    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.variantes.length).sort()).toEqual([1, 2]);
  });

  it('un archivo sin repeticiones no agrupa nada', () => {
    const nombres = ['Tomate', 'Cebolla', 'Zanahoria', 'Pimiento'];

    expect(agruparParecidos(nombres)).toHaveLength(nombres.length);
  });
});
