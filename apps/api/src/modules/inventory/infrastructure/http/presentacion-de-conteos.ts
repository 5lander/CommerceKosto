/**
 * La salida del conteo hacia JSON.
 *
 * **`comoConteoBasicoDto` NO TOCA LOS TRES VALORES, Y ESO ES LO QUE HACE.** El
 * `ConteoLeido` que llega del repositorio sí los trae —el caso de uso los
 * necesita— y esta función es el punto donde dejan de existir. Es la frontera
 * de CLAUDE.md §4.3 escrita como código: lo que no se copia aquí, no sale.
 *
 * Un `...conteo` en su lugar los publicaría todos, y seguiría compilando.
 */

import type {
  ConciliacionDeConteo,
  FilaConciliada,
  FilaDeHoja,
  HojaDeConteo,
} from '../../application/casos-de-uso/conteos';
import type { ConteoLeido } from '../../application/ports/repositorio-de-conteos.port';
import type {
  ConciliacionDto,
  ConteoBasicoDto,
  FilaConciliadaDto,
  FilaDeHojaDto,
  HojaDeConteoDto,
} from './conteos.dto';

const DIGITOS_DEL_MES = 2;

export function comoConteoBasicoDto(conteo: ConteoLeido): ConteoBasicoDto {
  return {
    id: conteo.id,
    locationId: conteo.locationId,
    anio: conteo.anio,
    mes: conteo.mes,
    etiqueta: `${String(conteo.anio)}-${String(conteo.mes).padStart(DIGITOS_DEL_MES, '0')}`,
    estado: conteo.estado,
    corteEn: conteo.corteEn.toISOString(),
    creadoEn: conteo.creadoEn.toISOString(),
    confirmadoEn: conteo.confirmadoEn?.toISOString() ?? null,
    note: conteo.note,
  };
}

export function comoHojaDto(hoja: HojaDeConteo): HojaDeConteoDto {
  return {
    conteo: comoConteoBasicoDto(hoja.conteo),
    filas: hoja.filas.map(comoFilaDeHojaDto),
  };
}

export function comoConciliacionDto(conciliacion: ConciliacionDeConteo): ConciliacionDto {
  return {
    conteo: comoConteoBasicoDto(conciliacion.conteo),
    filas: conciliacion.filas.map(comoFilaConciliadaDto),
    valorTeorico: conciliacion.valorTeorico,
    valorCubierto: conciliacion.valorCubierto,
    valorFisico: conciliacion.valorFisico,
    cobertura: conciliacion.cobertura,
    comprasDelPeriodo: conciliacion.comprasDelPeriodo,
    valorInicial: conciliacion.valorInicial,
    consumoReal: conciliacion.consumoReal,
  };
}

function comoFilaDeHojaDto(fila: FilaDeHoja): FilaDeHojaDto {
  return {
    itemId: fila.itemId,
    nombre: fila.nombre,
    unidadDeUso: fila.unidadDeUso,
    cantidad: fila.cantidad,
  };
}

function comoFilaConciliadaDto(fila: FilaConciliada): FilaConciliadaDto {
  return {
    itemId: fila.itemId,
    nombre: fila.nombre,
    unidadDeUso: fila.unidadDeUso,
    contado: fila.contado,
    teorico: fila.teorico,
    diferencia: fila.diferencia,
    valorDeDiferencia: fila.valorDeDiferencia,
    costoUnitario: fila.costoUnitario,
  };
}
