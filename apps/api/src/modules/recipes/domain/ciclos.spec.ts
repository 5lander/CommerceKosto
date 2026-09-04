/**
 * R9 y el criterio E14, con la base apagada.
 *
 * «Una receta que se referencia a sí misma a dos niveles se rechaza al guardar
 * con error de dominio.» Está en el segundo `describe`.
 */

import { describe, expect, it } from 'vitest';

import { itemId, type ItemId } from '../../../shared/domain/identity/identificadores';
import { cicloAlGuardar, CicloEnRecetaError, type GrafoDeItems } from './ciclos';

/** Identificadores legibles: el UUID no aporta nada a una prueba de grafos. */
function id(n: number): ItemId {
  return itemId(`018f2b8c-0000-7000-8000-${String(n).padStart(12, '0')}`);
}

const MAYONESA = id(1);
const HUEVO = id(2);
const ACEITE = id(3);
const SALSA = id(4);
const ADEREZO = id(5);
const AJO = id(6);

function grafo(entradas: readonly (readonly [ItemId, readonly ItemId[]])[]): GrafoDeItems {
  return new Map(entradas);
}

describe('ciclos en recetas', () => {
  describe('recetas legítimas', () => {
    it('una receta de insumos comprados no crea ciclo', () => {
      expect(
        cicloAlGuardar({ destino: MAYONESA, referencias: [HUEVO, ACEITE], grafo: grafo([]) }),
      ).toBeNull();
    });

    it('una subpreparación que usa otra tampoco', () => {
      // SALSA usa MAYONESA, y MAYONESA usa huevo y aceite. Dos niveles, sin ciclo.
      const actual = grafo([[MAYONESA, [HUEVO, ACEITE]]]);

      expect(cicloAlGuardar({ destino: SALSA, referencias: [MAYONESA, AJO], grafo: actual })).toBeNull();
    });

    it('un rombo no es un ciclo: dos ramas que llegan al mismo insumo', () => {
      // ADEREZO usa MAYONESA y SALSA; las dos usan ACEITE. Se visita dos veces
      // por caminos distintos y no hay ciclo.
      const actual = grafo([
        [MAYONESA, [ACEITE]],
        [SALSA, [ACEITE]],
      ]);

      expect(
        cicloAlGuardar({ destino: ADEREZO, referencias: [MAYONESA, SALSA], grafo: actual }),
      ).toBeNull();
    });
  });

  describe('EL CRITERIO E14: el ciclo se rechaza AL GUARDAR', () => {
    it('directo: una receta que se lleva a sí misma', () => {
      const ciclo = cicloAlGuardar({
        destino: MAYONESA,
        referencias: [HUEVO, MAYONESA],
        grafo: grafo([]),
      });

      expect(ciclo).not.toBeNull();
      expect(ciclo?.camino).toEqual([MAYONESA, MAYONESA]);
    });

    it('A DOS NIVELES, que es el caso que el criterio nombra', () => {
      // Ya existe: SALSA usa MAYONESA. Se intenta guardar MAYONESA usando SALSA.
      const actual = grafo([[SALSA, [MAYONESA]]]);

      const ciclo = cicloAlGuardar({ destino: MAYONESA, referencias: [SALSA], grafo: actual });

      expect(ciclo?.camino).toEqual([MAYONESA, SALSA, MAYONESA]);
    });

    it('a tres niveles', () => {
      const actual = grafo([
        [SALSA, [ADEREZO]],
        [ADEREZO, [MAYONESA]],
      ]);

      const ciclo = cicloAlGuardar({ destino: MAYONESA, referencias: [SALSA], grafo: actual });

      expect(ciclo?.camino).toEqual([MAYONESA, SALSA, ADEREZO, MAYONESA]);
    });

    it('el camino sale en el mensaje del error: buscarlo a mano no es opción', () => {
      const actual = grafo([[SALSA, [MAYONESA]]]);
      const ciclo = cicloAlGuardar({ destino: MAYONESA, referencias: [SALSA], grafo: actual });

      if (ciclo === null) {
        throw new Error('se esperaba un ciclo');
      }

      expect(new CicloEnRecetaError(ciclo).message).toContain('→');
    });
  });

  describe('robustez del recorrido', () => {
    it('no se cuelga con un ciclo PREEXISTENTE que no pasa por el destino', () => {
      // Un dato heredado o una carga inicial podrían traerlo. Colgarse no es
      // una forma aceptable de descubrirlo.
      const enfermo = grafo([
        [SALSA, [ADEREZO]],
        [ADEREZO, [SALSA]],
      ]);

      expect(cicloAlGuardar({ destino: MAYONESA, referencias: [SALSA], grafo: enfermo })).toBeNull();
    });

    it('una cadena larga se recorre sin desbordar', () => {
      const largo = 500;
      const cadena = Array.from({ length: largo }, (_, i) => id(i + 100));
      const entradas = cadena
        .slice(0, -1)
        .map((actual, i): readonly [ItemId, readonly ItemId[]] => [actual, [cadena[i + 1] ?? actual]]);

      expect(
        cicloAlGuardar({ destino: MAYONESA, referencias: [cadena[0] ?? MAYONESA], grafo: grafo(entradas) }),
      ).toBeNull();
    });

    it('la memorización evita el coste exponencial del rombo repetido', () => {
      // Cada nivel duplica los caminos: sin memorizar, 2^30 visitas. Con
      // memorización, 60. Si esta prueba tarda, la memorización se rompió.
      const niveles = 30;
      const entradas: (readonly [ItemId, readonly ItemId[]])[] = [];
      for (let n = 0; n < niveles; n += 1) {
        entradas.push([id(1000 + n), [id(1000 + n + 1), id(1000 + n + 1)]]);
      }

      const antes = performance.now();
      const ciclo = cicloAlGuardar({
        destino: MAYONESA,
        referencias: [id(1000)],
        grafo: grafo(entradas),
      });
      const transcurrido = performance.now() - antes;

      expect(ciclo).toBeNull();
      expect(transcurrido).toBeLessThan(150);
    });
  });
});
