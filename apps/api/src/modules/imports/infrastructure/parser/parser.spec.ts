/**
 * Los tres lectores, con la base apagada.
 *
 * **LA PRUEBA QUE MANDA AQUÍ ES LA DE LA ZIP BOMB.** Las demás comprueban que
 * se lee bien lo que está bien; esa comprueba que lo que está mal **no tumba el
 * proceso**, que es la única de las dos cosas que un atacante va a intentar.
 *
 * El lector vive en `parser/lector.mjs` —JavaScript plano, por una razón de
 * ejecución que ese archivo explica— y se prueba desde aquí con sus tipos
 * declarados: estar en JavaScript no lo saca del alcance de `tsc`.
 *
 * El `.xlsx` de las pruebas se construye aquí, byte a byte. Meter un binario de
 * ejemplo en el repositorio sería más corto y bastante peor: nadie podría ver
 * qué contiene, y un archivo opaco que decide si una prueba pasa es lo
 * contrario de una prueba.
 */

import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  ErrorDeLectura,
  formatoDe,
  leerDelimitado,
  leerEntradas,
  leerXlsx,
} from '../../../../../parser/lector.mjs';

const LIMITES = { bytesDescomprimidos: 16 * 1024 * 1024, entradas: 100 };

/** Un ZIP de verdad, escrito a mano: cabecera local, directorio y fin. */
function zipCon(entradas: readonly { nombre: string; contenido: string }[]): Uint8Array {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.nombre, 'latin1');
    const crudo = Buffer.from(entrada.contenido, 'utf8');
    const comprimido = deflateRawSync(crudo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, comprimido);

    const fila = Buffer.alloc(46);
    fila.writeUInt32LE(0x0201_4b50, 0);
    fila.writeUInt16LE(8, 10);
    fila.writeUInt32LE(comprimido.length, 20);
    fila.writeUInt32LE(crudo.length, 24);
    fila.writeUInt16LE(nombre.length, 28);
    fila.writeUInt32LE(desplazamiento, 42);
    central.push(fila, nombre);

    desplazamiento += local.length + nombre.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const indice = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x0605_4b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(indice.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);

  return new Uint8Array(Buffer.concat([cuerpo, indice, fin]));
}

function hojaCon(filas: readonly (readonly string[])[]): string {
  const celdas = filas
    .map((fila, f) => {
      const cs = fila
        .map(
          (valor, c) =>
            `<c r="${String.fromCharCode(65 + c)}${String(f + 1)}" t="inlineStr">` +
            `<is><t>${valor}</t></is></c>`,
        )
        .join('');
      return `<row r="${String(f + 1)}">${cs}</row>`;
    })
    .join('');

  return `<?xml version="1.0"?><worksheet><sheetData>${celdas}</sheetData></worksheet>`;
}

function xlsxCon(filas: readonly (readonly string[])[]): Uint8Array {
  return zipCon([{ nombre: 'xl/worksheets/sheet1.xml', contenido: hojaCon(filas) }]);
}

describe('magic bytes — qué es realmente el archivo', () => {
  it('un ZIP se reconoce por su firma, no por la extensión', () => {
    expect(formatoDe(xlsxCon([['a']]))).toBe('XLSX');
  });

  it('un CSV es texto plano y se acepta como delimitado', () => {
    expect(formatoDe(new Uint8Array(Buffer.from('nombre,precio\nTomate,1.20')))).toBe('DELIMITADO');
  });

  it('un binario con byte nulo se rechaza aunque lo llamen .csv', () => {
    const binario = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00]);
    expect(() => formatoDe(binario)).toThrow(ErrorDeLectura);
  });

  it('un archivo vacío no es texto: se rechaza', () => {
    expect(() => formatoDe(new Uint8Array())).toThrow(ErrorDeLectura);
  });

  it('el mensaje NO dice qué se detectó: no regala un detector de tipos', () => {
    try {
      formatoDe(new Uint8Array([0x00, 0x01]));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('Solo se admiten archivos .xlsx, .csv y .tsv.');
    }
  });
});

describe('ZIP — los topes son la defensa', () => {
  it('lee solo las entradas pedidas y deja el resto sin tocar', () => {
    const zip = zipCon([
      { nombre: 'quiero.txt', contenido: 'esto sí' },
      { nombre: 'no-quiero.txt', contenido: 'esto no' },
    ]);

    const leidas = leerEntradas(zip, ['quiero.txt'], LIMITES);

    expect([...leidas.keys()]).toEqual(['quiero.txt']);
    expect(Buffer.from(leidas.get('quiero.txt') ?? new Uint8Array()).toString()).toBe('esto sí');
  });

  /**
   * LA PRUEBA QUE JUSTIFICA HABER ESCRITO EL LECTOR A MANO.
   *
   * Un megabyte de ceros comprime a poco más de mil bytes. Con un tope de 1 KB
   * descomprimido, el lector tiene que negarse **sin haber reservado el mega**.
   */
  it('una zip bomb se corta por el tope, no por la memoria de la máquina', () => {
    const bomba = zipCon([{ nombre: 'bomba', contenido: '0'.repeat(1024 * 1024) }]);

    expect(() => leerEntradas(bomba, ['bomba'], { bytesDescomprimidos: 1024, entradas: 10 })).toThrow(
      ErrorDeLectura,
    );
  });

  it('demasiadas entradas también se rechazan', () => {
    const muchas = zipCon(
      Array.from({ length: 5 }, (_, i) => ({ nombre: `f${String(i)}`, contenido: 'x' })),
    );

    expect(() => leerEntradas(muchas, ['f0'], { bytesDescomprimidos: 1024, entradas: 3 })).toThrow(
      ErrorDeLectura,
    );
  });

  it('lo que no es un ZIP se rechaza con un mensaje que ayuda', () => {
    expect(() => leerEntradas(new Uint8Array([1, 2, 3, 4]), [], LIMITES)).toThrow(
      ErrorDeLectura,
    );
  });
});

describe('xlsx — celdas como texto', () => {
  it('lee las filas y sus celdas', () => {
    const filas = leerXlsx(
      xlsxCon([
        ['nombre', 'precio'],
        ['Tomate riñón', '1.20'],
      ]),
      LIMITES,
    );

    expect(filas).toEqual([
      ['nombre', 'precio'],
      ['Tomate riñón', '1.20'],
    ]);
  });

  /**
   * EL DECIMAL LLEGA COMO TEXTO, y esta prueba es la que lo fija.
   *
   * Si el lector devolviera `number`, `2.10` entraría al dominio como
   * `2.0999999999999996` y la barrera de `Money` no habría servido de nada:
   * la habría cruzado el parser. CLAUDE.md §3.
   */
  it('un decimal NO pasa por punto flotante: sale con sus dígitos exactos', () => {
    const filas = leerXlsx(xlsxCon([['0.1'], ['2.10'], ['1234567890123456789']]), LIMITES);

    expect(filas.map((f) => f[0])).toEqual(['0.1', '2.10', '1234567890123456789']);
  });

  it('las celdas vacías NO desplazan la fila', () => {
    // Excel se salta la celda vacía en el XML. Sin colocar cada una en su
    // columna, el validador leería el precio donde esperaba la unidad.
    const xml =
      '<worksheet><sheetData><row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>uno</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t>tres</t></is></c>' +
      '</row></sheetData></worksheet>';
    const zip = zipCon([{ nombre: 'xl/worksheets/sheet1.xml', contenido: xml }]);

    expect(leerXlsx(zip, LIMITES)[0]).toEqual(['uno', '', 'tres']);
  });

  it('resuelve las cinco entidades de XML y deja las demás tal cual', () => {
    const xml =
      '<worksheet><sheetData><row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>Sal &amp; pimienta</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>&foo;</t></is></c>' +
      '</row></sheetData></worksheet>';
    const zip = zipCon([{ nombre: 'xl/worksheets/sheet1.xml', contenido: xml }]);

    // `&foo;` intacto: resolverlo exigiría leer el DOCTYPE, y ahí viven las
    // entidades externas y la expansión exponencial.
    expect(leerXlsx(zip, LIMITES)[0]).toEqual(['Sal & pimienta', '&foo;']);
  });

  it('de una celda con fórmula lee el valor cacheado, sin evaluar nada', () => {
    const xml =
      '<worksheet><sheetData><row r="1">' +
      '<c r="A1"><f>SUM(B1:C1)</f><v>42</v></c>' +
      '</row></sheetData></worksheet>';
    const zip = zipCon([{ nombre: 'xl/worksheets/sheet1.xml', contenido: xml }]);

    expect(leerXlsx(zip, LIMITES)[0]).toEqual(['42']);
  });

  it('un ZIP sin hoja se rechaza con un mensaje accionable', () => {
    const zip = zipCon([{ nombre: 'otra-cosa.xml', contenido: '<a/>' }]);

    expect(() => leerXlsx(zip, LIMITES)).toThrow(/Guárdalo de nuevo como \.xlsx/u);
  });
});

describe('delimitado — el CSV real, no el de los ejemplos', () => {
  const filas = (texto: string): readonly (readonly string[])[] =>
    leerDelimitado(new Uint8Array(Buffer.from(texto, 'utf8'))).filas;

  it('una coma dentro de comillas no parte el campo', () => {
    expect(filas('a,"uno, dos",c')).toEqual([['a', 'uno, dos', 'c']]);
  });

  it('un salto de línea dentro de comillas no parte la fila', () => {
    expect(filas('a,"dos\nlineas",c\nx,y,z')).toEqual([
      ['a', 'dos\nlineas', 'c'],
      ['x', 'y', 'z'],
    ]);
  });

  it('dos comillas seguidas dentro del campo son una comilla literal', () => {
    expect(filas('a,"dice ""hola""",c')).toEqual([['a', 'dice "hola"', 'c']]);
  });

  it('la última fila sin salto final NO se pierde', () => {
    expect(filas('a,b\nc,d')).toHaveLength(2);
  });

  it('detecta el punto y coma aunque haya más comas: manda la regularidad', () => {
    // Excel en español: decimales con coma y campos con punto y coma.
    const leido = leerDelimitado(
      new Uint8Array(Buffer.from('nombre;precio\nTomate;1,20\nCebolla;2,50', 'utf8')),
    );

    expect(leido.delimitador).toBe(';');
    expect(leido.filas[1]).toEqual(['Tomate', '1,20']);
  });

  it('detecta el tabulador de un .tsv', () => {
    expect(leerDelimitado(new Uint8Array(Buffer.from('a\tb\nc\td'))).delimitador).toBe('\t');
  });

  it('el BOM de Excel no arruina la primera cabecera', () => {
    // Sin quitarlo, la primera columna no coincide con ninguna esperada y el
    // archivo se rechaza entero por un carácter invisible.
    expect(filas('﻿nombre,precio\nTomate,1.20')[0]).toEqual(['nombre', 'precio']);
  });
});
