import { describe, expect, it } from 'vitest';

import { precioVigenteA, type PrecioConVigencia } from './vigencia';

interface Precio extends PrecioConVigencia {
  readonly etiqueta: string;
}

const ENERO = new Date('2026-01-01T00:00:00.000Z');
const FEBRERO = new Date('2026-02-01T00:00:00.000Z');
const MARZO = new Date('2026-03-01T00:00:00.000Z');

function precio(entrada: {
  etiqueta: string;
  validFrom: Date;
  estado?: string;
  createdAt?: Date;
}): Precio {
  return {
    etiqueta: entrada.etiqueta,
    validFrom: entrada.validFrom,
    estado: entrada.estado ?? 'CONFIRMED',
    createdAt: entrada.createdAt ?? entrada.validFrom,
  };
}

describe('precio vigente a una fecha', () => {
  it('sin precios confirmados devuelve null, que no es lo mismo que cero', () => {
    expect(precioVigenteA([], MARZO)).toBeNull();
  });

  it('elige el confirmado más reciente que ya empezó', () => {
    const precios = [
      precio({ etiqueta: 'enero', validFrom: ENERO }),
      precio({ etiqueta: 'febrero', validFrom: FEBRERO }),
    ];

    expect(precioVigenteA(precios, MARZO)?.etiqueta).toBe('febrero');
  });

  it('el orden de la lista no cambia el resultado', () => {
    const precios = [
      precio({ etiqueta: 'febrero', validFrom: FEBRERO }),
      precio({ etiqueta: 'enero', validFrom: ENERO }),
    ];

    expect(precioVigenteA(precios, MARZO)?.etiqueta).toBe('febrero');
  });

  describe('R5: un sugerido no es vigente', () => {
    it('aunque su fecha ya haya pasado', () => {
      const precios = [
        precio({ etiqueta: 'enero', validFrom: ENERO }),
        precio({ etiqueta: 'febrero', validFrom: FEBRERO, estado: 'SUGGESTED' }),
      ];

      expect(precioVigenteA(precios, MARZO)?.etiqueta).toBe('enero');
    });

    it('un rechazado tampoco', () => {
      const precios = [
        precio({ etiqueta: 'enero', validFrom: ENERO }),
        precio({ etiqueta: 'febrero', validFrom: FEBRERO, estado: 'REJECTED' }),
      ];

      expect(precioVigenteA(precios, MARZO)?.etiqueta).toBe('enero');
    });

    it('si el único que hay está sugerido, no hay vigente', () => {
      expect(precioVigenteA([precio({ etiqueta: 'febrero', validFrom: FEBRERO, estado: 'SUGGESTED' })], MARZO)).toBeNull();
    });
  });

  describe('EL CRITERIO E8: cambiar el precio hoy no altera el costo de antes', () => {
    it('un precio de marzo no afecta a lo que valía en febrero', () => {
      const precios = [
        precio({ etiqueta: 'enero', validFrom: ENERO }),
        precio({ etiqueta: 'marzo', validFrom: MARZO }),
      ];

      expect(precioVigenteA(precios, FEBRERO)?.etiqueta).toBe('enero');
    });

    it('un precio con vigencia FUTURA existe y no afecta a hoy', () => {
      const precios = [
        precio({ etiqueta: 'enero', validFrom: ENERO }),
        precio({ etiqueta: 'marzo', validFrom: MARZO }),
      ];

      expect(precioVigenteA(precios, FEBRERO)?.etiqueta).toBe('enero');
      expect(precioVigenteA(precios, MARZO)?.etiqueta).toBe('marzo');
    });
  });

  describe('bordes', () => {
    it('vigente EXACTAMENTE el día que empieza', () => {
      expect(precioVigenteA([precio({ etiqueta: 'febrero', validFrom: FEBRERO })], FEBRERO)?.etiqueta).toBe('febrero');
    });

    it('un milisegundo antes, todavía no', () => {
      const casi = new Date(FEBRERO.getTime() - 1);

      expect(precioVigenteA([precio({ etiqueta: 'febrero', validFrom: FEBRERO })], casi)).toBeNull();
    });
  });

  describe('dos confirmados con la MISMA vigencia', () => {
    it('gana el capturado después: es la corrección del primero', () => {
      const antes = precio({
        etiqueta: 'equivocado',
        validFrom: FEBRERO,
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
      });
      const despues = precio({
        etiqueta: 'corregido',
        validFrom: FEBRERO,
        createdAt: new Date('2026-01-15T11:00:00.000Z'),
      });

      expect(precioVigenteA([antes, despues], MARZO)?.etiqueta).toBe('corregido');
      // Y el resultado NO depende del orden en que llegue la lista: sin el
      // desempate, un costo cambiaría entre dos corridas idénticas.
      expect(precioVigenteA([despues, antes], MARZO)?.etiqueta).toBe('corregido');
    });
  });
});
