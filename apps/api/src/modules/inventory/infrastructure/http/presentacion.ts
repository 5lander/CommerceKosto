/**
 * La única salida del libro hacia JSON.
 *
 * **LAS CANTIDADES SALEN COMO CADENA, con su signo.** El signo no se esconde ni
 * se traduce a «entrada/salida» aquí: el consumidor recibe el mismo número que
 * la base guarda, y sumar la columna da el saldo. Una capa que invirtiera
 * signos por comodidad de la pantalla sería una segunda convención que alguien
 * acabaría aplicando dos veces.
 *
 * **NO EXISTE UN `saldoDto` PARA UNA ESCRITURA.** Las respuestas de `POST` no
 * pasan por aquí porque no tienen nada que presentar salvo un id — ver la
 * cabecera del controlador y CLAUDE.md §4.3.
 */

import type { SaldoConNombre } from '../../application/casos-de-uso/movimientos';
import type { MovimientoLeido } from '../../application/ports/repositorio-de-inventario.port';
import type { MovimientoDto, SaldoDto } from './inventario.dto';

export function comoSaldoDto(saldo: SaldoConNombre): SaldoDto {
  return {
    itemId: saldo.itemId,
    nombre: saldo.nombre,
    unidadDeUso: saldo.unidadDeUso,
    cantidad: saldo.cantidad,
  };
}

export function comoMovimientoDto(movimiento: MovimientoLeido): MovimientoDto {
  return {
    id: movimiento.id,
    locationId: movimiento.locationId,
    itemId: movimiento.itemId,
    tipo: movimiento.tipo,
    cantidad: movimiento.cantidad,
    costoTotal: movimiento.costoTotal,
    occurredAt: movimiento.occurredAt.toISOString(),
    recordedAt: movimiento.recordedAt.toISOString(),
    transferId: movimiento.transferId,
    productionId: movimiento.productionId,
    corrigeA: movimiento.corrigeA,
    corregidoPor: movimiento.corregidoPor,
    note: movimiento.note,
  };
}
