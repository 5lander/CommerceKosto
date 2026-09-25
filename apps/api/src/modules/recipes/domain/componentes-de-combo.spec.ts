import { describe, expect, it } from 'vitest';

import { COMPONENTES_MAXIMOS, problemaDeComponentes } from './componentes-de-combo';
import type { TipoDeProducto } from './linea-de-receta';

const COMBO = 'combo-1';
const PAPAS = 'papas';
const BEBIDA = 'bebida';
const OTRO_COMBO = 'combo-2';

const TIPOS = new Map<string, TipoDeProducto>([
  [COMBO, 'COMBO'],
  [PAPAS, 'SIMPLE'],
  [BEBIDA, 'SIMPLE'],
  [OTRO_COMBO, 'COMBO'],
]);

function problema(
  componentes: readonly { productId: string; cantidad: string }[],
  tipoDelCombo: TipoDeProducto = 'COMBO',
): string | null {
  return problemaDeComponentes({ comboId: COMBO, tipoDelCombo, componentes, tipos: TIPOS });
}

describe('componentes de un combo', () => {
  it('dos productos simples con cantidad positiva son un combo válido', () => {
    expect(problema([{ productId: PAPAS, cantidad: '1' }, { productId: BEBIDA, cantidad: '0.5' }])).toBeNull();
  });

  it('la lista vacía es válida: es un combo al que se le quitaron los componentes', () => {
    expect(problema([])).toBeNull();
  });

  it('un producto SIMPLE no lleva componentes', () => {
    expect(problema([{ productId: PAPAS, cantidad: '1' }], 'SIMPLE')).toContain('Solo un producto de tipo COMBO');
  });

  it('un combo no se contiene a sí mismo (combo_component_no_se_contiene)', () => {
    expect(problema([{ productId: COMBO, cantidad: '1' }])).toContain('a sí mismo');
  });

  it('un combo no contiene otro combo', () => {
    expect(problema([{ productId: OTRO_COMBO, cantidad: '1' }])).toContain('otro combo');
  });

  it('un componente repetido se rechaza con la salida: subir la cantidad', () => {
    expect(
      problema([{ productId: PAPAS, cantidad: '1' }, { productId: PAPAS, cantidad: '2' }]),
    ).toContain('sube su cantidad');
  });

  it('un producto que no está en la company se rechaza sin decir de quién es', () => {
    expect(problema([{ productId: 'ajeno', cantidad: '1' }])).toBe('Uno de los componentes no existe en tu company.');
  });

  it('cantidad cero se rechaza (combo_component_cantidad_positiva)', () => {
    expect(problema([{ productId: PAPAS, cantidad: '0' }])).toContain('mayor que cero');
  });

  it('más componentes que el máximo se rechaza antes de mirar ninguno', () => {
    const muchos = Array.from({ length: COMPONENTES_MAXIMOS + 1 }, (_, i) => ({ productId: `p${String(i)}`, cantidad: '1' }));
    expect(problema(muchos)).toContain(`como mucho ${String(COMPONENTES_MAXIMOS)}`);
  });
});
