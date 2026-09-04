/**
 * Errores de `inventory`. Todos de dominio: no saben de HTTP.
 *
 * VARIOS DE ESTOS EXISTEN POR INC-012. La tabla de movimientos está cubierta de
 * restricciones —signo contra dirección, cantidad no nula, fecha no futura,
 * origen distinto de destino— y cada una de ellas es alcanzable desde la API.
 * Sin una guarda que las explique, el `23514` de PostgreSQL sale como
 * `INTERNAL_ERROR 500` y nadie sabe qué escribió mal. Su clasificación está en
 * `docs/sistema/guardas-de-dominio.md`.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/**
 * Un movimiento de cantidad cero.
 *
 * No es inofensivo: es una fila en el libro que no mueve nada y que alguien
 * tendrá que interpretar dentro de un año. El libro registra hechos, y «no pasó
 * nada» no es uno.
 */
export class CantidadNulaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('La cantidad de un movimiento no puede ser cero.');
  }
}

/**
 * El signo no concuerda con lo que el tipo de movimiento significa.
 *
 * Una compra que resta y una merma que suma son, cada una, un saldo equivocado
 * que nadie va a cuestionar porque el número es plausible.
 */
export class SignoIncoherenteError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(tipo: string, esperado: string) {
    super(
      `Un movimiento de tipo ${tipo} solo admite cantidades de ${esperado}. ` +
        'Para mover en el otro sentido existe el tipo contrario, o un AJUSTE.',
      { tipo, esperado },
    );
  }
}

/** Registrar hoy algo que "pasará" mañana desordena toda reconstrucción. */
export class FechaFuturaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Un movimiento no puede tener fecha futura: el libro registra lo que ya ocurrió.');
  }
}

export class TransferenciaSinDestinoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Una transferencia necesita dos ubicaciones distintas: origen y destino.');
  }
}

/** Se pidió mover un ítem que no existe en la company. */
export class ItemDelLibroNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese ítem no existe en tu company.');
  }
}

export class MovimientoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese movimiento no existe en tu company.');
  }
}

/** Corregir dos veces el mismo movimiento resta el doble. */
export class MovimientoYaCorregidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super('Ese movimiento ya tiene una corrección registrada.');
  }
}

/** Una corrección de una corrección es una edición con otro nombre. */
export class CorreccionDeCorreccionError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super(
      'Ese movimiento ya es la corrección de otro. Si el saldo sigue mal, ' +
        'registra un AJUSTE con su motivo en vez de encadenar correcciones.',
    );
  }
}

/**
 * Se intentó producir algo que no es una preparación con stock propio.
 *
 * Un ítem `COMPRADO` no se produce: se compra. Y una preparación con
 * `llevaStock = false` no pasa por inventario — al venderse se explota su
 * receta, que es justo lo que significa el interruptor.
 */
export class ItemNoProducibleError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(motivo: string) {
    super(`No se puede registrar producción de ese ítem: ${motivo}`, { motivo });
  }
}

/** Producir sin saber con qué se produjo deja el costo real del lote en blanco. */
export class ProduccionSinInsumosError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super(
      'Una producción necesita al menos un insumo: sin ellos no hay costo real ' +
        'del lote que comparar contra el estándar (R10).',
    );
  }
}

/**
 * Un ciclo en el grafo de subpreparaciones, encontrado al explotar el consumo.
 *
 * NO DEBERÍA PODER PASAR: R9 rechaza los ciclos al guardar la receta, que es lo
 * que hace barata esta comprobación. Existe porque un dato migrado o una fila
 * escrita fuera de la aplicación sí puede traerlo, y sin ella la explosión
 * desborda la pila con un `RangeError` que no dice qué receta mirar.
 */
export class CicloEnConsumoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(itemId: string) {
    super(
      'Hay una subpreparación que se contiene a sí misma y no se puede calcular ' +
        'su consumo. Revisa la receta de ese ítem.',
      { itemId },
    );
  }
}
