/**
 * El desglose sale solo con permiso de leer la receta (D-16.106).
 *
 * **CON LA BASE APAGADA**, y a propósito: hoy los cuatro roles que leen el
 * costeo también leen la receta, así que ninguna prueba de integración llega a
 * la rama sin desglose. Un rol que algún día lea costos sin recetas la
 * encontraría estrenándose en producción. Esta prueba la ejercita hoy, en la
 * única salida del desglose hacia JSON.
 */

import { describe, expect, it } from 'vitest';

import { itemId, locationId, productId } from '../../../../shared/domain/identity/identificadores';
import { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { CosteoDelProducto } from '../../application/casos-de-uso/costear';
import { costearProducto } from '../../domain/costeo-de-producto';
import { comoCarta, comoProducto } from './presentacion';

const HARINA = itemId('0199a0b1-0000-7000-8000-000000000001');

function producto(): CosteoDelProducto {
  const costeo = costearProducto({
    lineas: [
      {
        cantidad: Ratio.fromDecimalString('0.2'),
        base: 'EP',
        estado: 'ACTIVA',
        costos: { costoBrutoDeUso: Money.fromDecimalString('1.00'), costoNetoDeUso: Money.fromDecimalString('1.25') },
      },
    ],
    rendimientoPorciones: Ratio.UNO,
    provisionMerma: Ratio.fromDecimalString('0.02'),
    empaqueNeto: Money.CERO,
    pvp: Money.fromDecimalString('3.00'),
    ivaVenta: Ratio.fromDecimalString('0.15'),
  });
  return {
    productId: productId('0199a0b1-0000-7000-8000-000000000002'),
    nombre: 'Pan de prueba',
    tipo: 'SIMPLE',
    categoria: null,
    activo: true,
    costeo,
    itemsSinCosto: [],
    semaforoFoodCost: 'VERDE',
    lineas: [
      {
        itemId: HARINA,
        nombre: 'Harina',
        cantidad: '0.2',
        base: 'EP',
        estado: 'ACTIVA',
        costo: Money.fromDecimalString('0.25'),
        participacion: Ratio.UNO,
      },
    ],
  };
}

describe('el desglose por línea en la salida del costeo (D-16.106)', () => {
  it('con permiso de receta sale una entrada por línea, con su ítem y su cantidad', () => {
    const dto = comoProducto(producto(), true);

    expect(dto.costos.lineas).toHaveLength(1);
    expect(dto.costos.lineas?.[0]).toMatchObject({ itemId: HARINA, cantidad: '0.2', base: 'EP' });
  });

  it('sin permiso de receta sale null: ni vacío ni recortado, AUSENTE', () => {
    const dto = comoProducto(producto(), false);

    expect(dto.costos.lineas).toBeNull();
    // Sobre la serialización cruda, como en §4.3: la cantidad es la receta misma.
    expect(JSON.stringify(dto)).not.toContain('Harina');
    expect(JSON.stringify(dto)).not.toContain('"cantidad"');
  });

  it('la carta aplica la misma decisión a todos sus productos', () => {
    const carta = comoCarta(
      {
        locationId: locationId('0199a0b1-0000-7000-8000-000000000003'),
        fecha: new Date('2026-03-01T12:00:00Z'),
        productos: [producto(), producto()],
        parametros: {
          ivaVenta: Ratio.fromDecimalString('0.15'),
          umbralVerde: Ratio.fromDecimalString('0.28'),
          foodCostMaximo: Ratio.fromDecimalString('0.32'),
        },
      },
      false,
    );

    expect(carta.productos.map((p) => p.costos.lineas)).toEqual([null, null]);
  });
});
