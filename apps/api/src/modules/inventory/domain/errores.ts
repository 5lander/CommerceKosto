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
import { mensajeDeProblemas, type ProblemaDelLote } from '../../../shared/domain/lote/problemas';

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

/* --- Conteo físico (P7) --------------------------------------------------- */

export class ConteoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese conteo físico no existe en tu company.');
  }
}

/**
 * Editar un conteo ya confirmado.
 *
 * Confirmar congela el stock teórico y el costo de cada línea: es lo que hace
 * que la diferencia siga significando lo mismo dentro de un año. Si el conteo
 * salió mal, se abre otro.
 */
export class ConteoYaConfirmadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super(
      'Ese conteo ya está confirmado y no admite cambios. Si hay que rehacerlo, ' +
        'abre un conteo nuevo para el mismo período.',
    );
  }
}

/** Dos líneas del mismo ítem: una de las dos es la buena y nadie sabe cuál. */
export class ItemRepetidoEnConteoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Un conteo no puede tener dos líneas del mismo ítem.');
  }
}

/** Contar en negativo no es un hallazgo: es un error de captura. */
export class CantidadDeConteoNegativaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Lo contado no puede ser negativo. Si no había nada, la cantidad es cero.');
  }
}

/**
 * Ya hay un conteo confirmado para ese mes y esa ubicación.
 *
 * Solo puede haber uno, y no es una limitación arbitraria: `inventario_final_
 * fisico` de SPEC §16 es **el** conteo del mes. Con dos confirmados, el food
 * cost real de ese período dependería de cuál eligiera cada consulta.
 */
export class ConteoDelPeriodoYaConfirmadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(etiqueta: string) {
    super(`Ese período (${etiqueta}) ya tiene un conteo físico confirmado.`, {
      periodo: etiqueta,
    });
  }
}

/**
 * Cerrar el mes con el conteo todavia en borrador.
 *
 * Sellar un periodo cuya medicion no se ha confirmado dejaria un mes que ya no
 * admite movimientos y del que nunca se sabra cuanto habia: el
 * `inventario_final_fisico` de SPEC 16 se quedaria sin dato, y el food cost
 * real de ese mes no se podria calcular jamas.
 */
export class ConteoNoConfirmadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super(
      'Ese conteo todavia esta en borrador. Confirmalo antes de cerrar el periodo: ' +
        'un mes cerrado sin conteo confirmado no puede producir food cost real.',
    );
  }
}

/**
 * Un lote de movimientos que no se puede escribir, con todos sus problemas.
 *
 * El libro es append-only (R3): una vez dentro, una fila mala solo se arregla
 * con otra de signo contrario. Por eso el lote se para ANTES de escribir nada y
 * se devuelven todos los motivos de una vez.
 */
export class MovimientoDeLoteInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(public readonly problemas: readonly ProblemaDelLote[]) {
    super(mensajeDeProblemas(problemas));
  }
}

/**
 * Una COMPRA sin el total de la factura.
 *
 * El esquema del endpoint ya lo exige con un refinamiento de objeto, y un
 * refinamiento de objeto no corre si otro campo falló antes (INC-008): la
 * petición se rechaza igual, pero el dominio no puede fiarse de eso. Sin
 * importe no hay neto, y sin neto `compras_del_mes` (SPEC §16) queda corto.
 */
export class CompraSinImporteError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Una compra necesita el total de la factura: sin él no hay costo que netear.');
  }
}

/**
 * Una COMPRA nueva sin desglose (D-16.25). No la escribe ninguna ruta de hoy:
 * es la guarda para la ruta de mañana que construya una compra sin pasar por
 * `desglosarCompra` (§23 HACCP, back office, un script), porque la base no
 * puede distinguirla de una anterior a P16-A1.
 */
export class CompraSinDesgloseError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super(
      'Una compra se registra con su total de factura y su tarifa de IVA: el libro no acepta ' +
        'una compra nueva sin desglose.',
    );
  }
}

/** Un bruto negativo no es una factura. Guarda de `inventory_movement_desglose_en_rango`. */
export class CompraConImporteInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(importe: string) {
    super(
      `El total de una compra es una magnitud sin signo: «${importe}» no lo es. ` +
        'Para deshacer una compra existe la corrección.',
      { importe },
    );
  }
}
