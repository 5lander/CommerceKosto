/**
 * El movimiento del libro mayor — SPEC §7, R3.
 *
 * LA CANTIDAD LLEVA SIGNO, Y ESA ES LA DECISIÓN QUE SOSTIENE TODO LO DEMÁS.
 * Con signo, el saldo es `Σ cantidad`: una suma, no un `CASE` por tipo repetido
 * en cada consulta y en cada informe. Y «un error se corrige con un movimiento
 * de signo contrario» (R3) deja de ser una frase del reglamento para ser
 * literalmente la operación: `cantidad.negated()`.
 *
 * EL SIGNO NO LO ELIGE QUIEN LLAMA. Lo impone el tipo, a través de su
 * dirección. Una `COMPRA` con cantidad negativa y una `MERMA` con cantidad
 * positiva son saldos equivocados que nadie cuestionaría, porque el número
 * resultante es perfectamente plausible. `AJUSTE` es el único tipo que admite
 * las dos direcciones, y por eso es el único donde el signo viaja desde fuera.
 *
 * LA MISMA REGLA VIVE EN LA BASE, y no por duplicado: la tabla de tipos guarda
 * la dirección, el movimiento la repite, una clave foránea COMPUESTA `(tipo,
 * dirección)` impide que discrepen, y un `CHECK` cruza dirección con signo. El
 * mismo mecanismo con el que P3 ató el artículo de compra a su ítem. Aquí está
 * la guarda de dominio que lo explica antes de que la base lo rechace.
 */

import type { Quantity } from '../../../shared/domain/money/tipos-monetarios';
import type { ItemId, LocationId } from '../../../shared/domain/identity/identificadores';
import { CantidadNulaError, FechaFuturaError, SignoIncoherenteError } from './errores';

export type TipoDeMovimiento =
  | 'COMPRA'
  | 'TRANSFERENCIA_SALIDA'
  | 'TRANSFERENCIA_ENTRADA'
  | 'PRODUCCION'
  | 'MERMA'
  | 'AJUSTE'
  | 'CONSUMO_POR_VENTA';

export type DireccionDeMovimiento = 'ENTRADA' | 'SALIDA' | 'AMBAS';

/**
 * Qué hace cada tipo con el saldo.
 *
 * `PRODUCCION` ES BIDIRECCIONAL, y no por comodidad: una producción mueve el
 * libro en los dos sentidos a la vez —da de alta la preparación terminada y
 * consume sus insumos—, y las dos mitades son el mismo hecho. Lo que impide
 * producir en negativo por descuido no es el signo sino la agrupación: todo
 * movimiento `PRODUCCION` cuelga de una fila de `inventory_production`, que
 * tiene exactamente un alta positiva y al menos un consumo negativo. Esa
 * invariante la sostiene `produccion.ts` y tiene su prueba.
 *
 * `AJUSTE` es el otro bidireccional, y ahí el signo sí lo elige el usuario: un
 * ajuste existe precisamente para mover el saldo en la dirección que haga falta.
 */
export const DIRECCION_DE: Readonly<Record<TipoDeMovimiento, DireccionDeMovimiento>> = {
  COMPRA: 'ENTRADA',
  TRANSFERENCIA_ENTRADA: 'ENTRADA',
  PRODUCCION: 'AMBAS',
  TRANSFERENCIA_SALIDA: 'SALIDA',
  MERMA: 'SALIDA',
  CONSUMO_POR_VENTA: 'SALIDA',
  AJUSTE: 'AMBAS',
};

export const TIPOS_DE_MOVIMIENTO: readonly TipoDeMovimiento[] = Object.keys(
  DIRECCION_DE,
) as TipoDeMovimiento[];

/**
 * Los tipos que un usuario puede registrar directamente.
 *
 * Los otros cuatro existen, pero se emiten desde una operación que los crea en
 * conjunto y mantiene su invariante: las dos patas de una transferencia, el
 * alta y los consumos de una producción, y el consumo que genera una venta.
 * Dejar que se registren sueltos permitiría media transferencia.
 */
export const TIPOS_DIRECTOS: readonly TipoDeMovimiento[] = ['COMPRA', 'MERMA', 'AJUSTE'];

/** Un movimiento tal como entra al libro. Inmutable por definición (R3). */
export interface MovimientoDelLibro {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly tipo: TipoDeMovimiento;
  /** CON SIGNO: positivo entra, negativo sale. */
  readonly cantidad: Quantity;
  readonly ocurridoEn: Date;
}

function esperadoPara(direccion: DireccionDeMovimiento): string {
  return direccion === 'ENTRADA' ? 'entrada (positivas)' : 'salida (negativas)';
}

/**
 * Comprueba que el signo diga lo mismo que el tipo.
 *
 * @throws {CantidadNulaError} si la cantidad es cero
 * @throws {SignoIncoherenteError} si el signo contradice la dirección del tipo
 */
export function exigirSignoCoherente(tipo: TipoDeMovimiento, cantidad: Quantity): Quantity {
  if (cantidad.isZero()) throw new CantidadNulaError();

  const direccion = DIRECCION_DE[tipo];
  if (direccion === 'AMBAS') return cantidad;

  const entra = direccion === 'ENTRADA';
  if (entra !== cantidad.isPositive()) {
    throw new SignoIncoherenteError(tipo, esperadoPara(direccion));
  }
  return cantidad;
}

/**
 * Exige que un valor capturado sea una MAGNITUD: positiva y distinta de cero.
 *
 * Se usa allí donde el sentido lo pone la operación y no quien escribe: la
 * cantidad producida de un lote, la que viaja en una transferencia, la de una
 * merma. `tipo` solo sirve para que el mensaje diga de qué se estaba hablando.
 *
 * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
 */
export function exigirMagnitud(cantidad: Quantity, tipo: TipoDeMovimiento): Quantity {
  if (cantidad.isZero()) throw new CantidadNulaError();
  if (cantidad.isNegative()) throw new SignoIncoherenteError(tipo, 'entrada (positivas)');
  return cantidad;
}

/**
 * Aplica al valor capturado el signo que le corresponde al tipo.
 *
 * ES LA PUERTA DE ENTRADA DESDE LA API. Quien registra una merma escribe «2,5
 * kg», no «−2,5 kg»: pedirle el signo sería pedirle que entienda la convención
 * interna del libro, y quien no la entienda escribirá la mitad de las mermas al
 * revés. Para `AJUSTE`, que es el único bidireccional que se captura a mano, el
 * signo sí es del usuario y se respeta tal cual.
 *
 * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
 */
export function conSignoDelTipo(tipo: TipoDeMovimiento, magnitud: Quantity): Quantity {
  if (DIRECCION_DE[tipo] === 'AMBAS') {
    if (magnitud.isZero()) throw new CantidadNulaError();
    return magnitud;
  }

  const positiva = exigirMagnitud(magnitud, tipo);
  return DIRECCION_DE[tipo] === 'SALIDA' ? positiva.negated() : positiva;
}

/**
 * El libro registra hechos, no planes.
 *
 * El minuto de holgura absorbe la deriva entre el reloj del cliente y el del
 * servidor, igual que en `audit_log`. Sin ella, un portátil dos segundos
 * adelantado no podría registrar una compra.
 */
const HOLGURA_DE_RELOJ_MS = 60_000;

/** @throws {FechaFuturaError} */
export function exigirFechaPasada(ocurridoEn: Date, ahora: Date): Date {
  if (ocurridoEn.getTime() > ahora.getTime() + HOLGURA_DE_RELOJ_MS) throw new FechaFuturaError();
  return ocurridoEn;
}
