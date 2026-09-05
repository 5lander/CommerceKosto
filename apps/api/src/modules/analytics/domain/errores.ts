/**
 * Errores de `analytics`. Todos de dominio: no saben de HTTP.
 *
 * Los dos primeros existen por INC-012 y por la misma vía que en P7: aquí no
 * quedan `CHECK` alcanzables, pero sí **índices únicos**, y un `23505` sube al
 * cliente igual de sin traducir que un `23514`.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/** Dos líneas del mismo producto: una de las dos es la buena y nadie sabe cuál. */
export class ProductoRepetidoEnVentasError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('La carga de ventas no puede traer dos veces el mismo producto.');
  }
}

export class ConceptoRepetidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(concepto: string) {
    super(`El concepto «${concepto}» aparece dos veces en los costos del mes.`, { concepto });
  }
}

/**
 * Se pidió una vista de un mes que nadie ha tocado.
 *
 * No es lo mismo que un mes vacío: un mes **abierto** sin ventas cargadas tiene
 * vistas, todas en cero y con sus indicadores en `SIN_DATO`. Esto es que el
 * período no existe, y devolver ceros haría creer que el mes se analizó.
 */
export class PeriodoSinDatosError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor(etiqueta: string) {
    super(
      `No hay nada registrado para el período ${etiqueta} en esa ubicación: ni ventas, ni ` +
        'movimientos, ni conteo. No es un mes en cero, es un mes sin abrir.',
      { periodo: etiqueta },
    );
  }
}
