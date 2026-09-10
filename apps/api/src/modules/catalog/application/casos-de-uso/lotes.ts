/**
 * Escritura EN LOTE del catálogo — la pieza que P10 necesitaba y no existía.
 *
 * **EL PROBLEMA QUE RESUELVE, DICHO CON NÚMEROS.** Cada método de
 * `RepositorioDeCatalogo` abre su propia transacción con el tenant fijado, que
 * es lo correcto para un alta suelta. Pero un bucle de doscientas altas son
 * doscientas transacciones: la fila 150 mala deja escritas las 149 anteriores, y
 * quien migra un catálogo se queda con medio catálogo dentro y sin forma de
 * saber cuál mitad. `crearItemsEnLote` abre **una**.
 *
 * **EL ORDEN ES: validar TODO, después escribir.** El dominio revisa el lote
 * entero y devuelve todos los problemas con su posición; solo si no hay ninguno
 * se abre la transacción. Un `23514` a mitad de escritura sería INC-012 otra
 * vez, y encima con la mitad del archivo dentro.
 *
 * **UN EVENTO DE AUDITORÍA POR LOTE, NO UNO POR FILA.** Doscientos
 * `catalog.item.created` seguidos no cuentan que hubo una importación: la
 * esconden. Lo que se audita es la acción.
 */

import { auditarLote } from '../../../../shared/application/auditoria-de-lote';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import { elegirTarifa } from '../../../../shared/domain/iva/precedencia';
import { Quantity, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso, type UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ProblemaDelLote } from '../../../../shared/domain/lote/problemas';
import { PRIMERA_POSICION } from '../../../../shared/domain/lote/problemas';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { LimiteDelPlanError } from '../../../iam/domain/errores';
import {
  ConversionInvalidaError,
  factorDeConversion,
  mensajeDelProblemaDeConversion,
  type UnidadDelCatalogo,
} from '../../domain/conversion';
import { ConflictoDeCatalogoError, LoteDeCatalogoInvalidoError } from '../../domain/errores';
import {
  problemasDelLoteDeArticulos,
  problemasDelLoteDeItems,
  type ArticuloDelLote,
  type ItemDelLote,
} from '../../domain/lote';
import type {
  DatosDeArticuloEnLote,
  ItemLeido,
  RepositorioDeCatalogo,
} from '../ports/repositorio-de-catalogo.port';

/** Lo que el lote de artículos lee UNA vez para resolver todas sus filas. */
interface ContextoDeArticulos {
  readonly items: ReadonlyMap<string, ItemLeido>;
  readonly unidades: readonly UnidadDelCatalogo[];
  /** Tarifa de IVA por id de grupo; `null` donde el grupo no la define. */
  readonly tarifasDeGrupo: ReadonlyMap<string, string | null>;
}

export interface DependenciasDeLotesDeCatalogo {
  readonly repositorio: RepositorioDeCatalogo;
  readonly auditoria: AuditLogPort;
}

export class CrearItemsEnLote {
  public constructor(private readonly deps: DependenciasDeLotesDeCatalogo) {}

  public async ejecutar(sesion: SesionActiva, items: readonly ItemDelLote[]): Promise<number> {
    const problemas = problemasDelLoteDeItems(items);
    if (problemas.length > 0) throw new LoteDeCatalogoInvalidoError(problemas);

    await this.exigirUnidadesConocidas(items);

    const resultado = await this.deps.repositorio.crearItemsEnLote({
      companyId: sesion.companyId,
      items: items.map((item) => ({
        nombre: item.nombre,
        tipo: item.tipo,
        unidadDeUso: unidadDeUso(item.unidadDeUso),
        rendimiento: item.rendimiento,
        grupo: item.grupo,
        confianzaDePrecio: item.confianzaDePrecio,
        llevaStock: item.llevaStock,
      })),
    });

    if (resultado.clase === 'nombres_en_uso') {
      throw new ConflictoDeCatalogoError(
        `Estos ítems ya existen en tu company: ${resultado.nombres.join(', ')}.`,
      );
    }
    // El lote ENTERO se para. Escribir los que caben y callar el resto dejaría
    // media importación dentro, que es justo lo que `crearItemsEnLote` existe
    // para impedir.
    if (resultado.clase === 'limite') {
      throw new LimiteDelPlanError('ítems', resultado.maximo);
    }

    await auditarLote({ auditoria: this.deps.auditoria, sesion, eventType: 'catalog.items.bulk_created', filas: resultado.filas });
    return resultado.filas;
  }

  /**
   * Que cada unidad EXISTA en el catálogo, no solo que esté bien escrita.
   *
   * `problemasDelLoteDeItems` ya comprueba la FORMA del código —minúsculas,
   * corto, sin espacios— y eso deja pasar `"l"`, que está perfectamente formado
   * y no existe: el litro es `lt`. La fila llegaba entonces hasta el `INSERT` y
   * reventaba con `Foreign key constraint violated on the constraint:
   * "item_unit_of_use_fkey"`, un mensaje que no dice qué fila ni qué columna ni
   * cuáles son las unidades buenas.
   *
   * **Es INC-012 —la base rechaza y el dominio no explica— y apareció cargando
   * un catálogo de verdad, no en una prueba.** Con un archivo de cliente delante
   * es el fallo más probable de todos: `l`, `Kg`, `litro`, `und`.
   *
   * Se comprueban TODAS las filas antes de lanzar, no la primera: quien importa
   * un catálogo quiere la lista completa para corregir el archivo de una vez.
   * Y la lectura del catálogo es UNA para todo el lote, como en `conFactor`.
   */
  private async exigirUnidadesConocidas(items: readonly ItemDelLote[]): Promise<void> {
    const catalogo = await this.deps.repositorio.unidades();
    const conocidas = new Set<string>(catalogo.map((unidad) => unidad.codigo));
    const validas = [...conocidas].sort().join(', ');

    const problemas = items.flatMap((item, indice) =>
      conocidas.has(item.unidadDeUso)
        ? []
        : [
            {
              posicion: indice + PRIMERA_POSICION,
              motivo: `La unidad "${item.unidadDeUso}" no está en el catálogo. Las válidas son: ${validas}.`,
            },
          ],
    );

    if (problemas.length > 0) throw new LoteDeCatalogoInvalidoError(problemas);
  }
}

export class CrearArticulosEnLote {
  public constructor(private readonly deps: DependenciasDeLotesDeCatalogo) {}

  public async ejecutar(
    sesion: SesionActiva,
    articulos: readonly ArticuloDelLote[],
  ): Promise<number> {
    const problemas = problemasDelLoteDeArticulos(articulos);
    if (problemas.length > 0) throw new LoteDeCatalogoInvalidoError(problemas);

    const preparados = await this.conFactor(sesion, articulos);

    const resultado = await this.deps.repositorio.crearArticulosEnLote({
      companyId: sesion.companyId,
      articulos: preparados,
    });

    if (resultado.clase === 'nombres_en_uso') {
      throw new ConflictoDeCatalogoError(
        `Estos ítems no existen en tu company: ${resultado.nombres.join(', ')}.`,
      );
    }

    await auditarLote({ auditoria: this.deps.auditoria, sesion, eventType: 'catalog.articles.bulk_created', filas: resultado.filas });
    return resultado.filas;
  }

  /**
   * Calcula el factor y resuelve la tarifa de cada fila con **tres lecturas
   * para todo el lote**, no tres por fila: el catálogo de unidades, los ítems
   * de la company y sus grupos. Es la diferencia entre 4 consultas y 4N, que
   * es lo que `CrearArticulo` hace por fila y aquí sería un N+1 de manual.
   */
  private async conFactor(
    sesion: SesionActiva,
    articulos: readonly ArticuloDelLote[],
  ): Promise<readonly DatosDeArticuloEnLote[]> {
    const contexto = await this.leerContexto(sesion);

    const problemas: ProblemaDelLote[] = [];
    const preparados: DatosDeArticuloEnLote[] = [];

    for (const [indice, articulo] of articulos.entries()) {
      const calculado = prepararArticulo(articulo, contexto);
      if (typeof calculado === 'string') {
        problemas.push({ posicion: indice + PRIMERA_POSICION, motivo: calculado });
        continue;
      }
      preparados.push(calculado);
    }

    if (problemas.length > 0) throw new LoteDeCatalogoInvalidoError(problemas);
    return preparados;
  }

  private async leerContexto(sesion: SesionActiva): Promise<ContextoDeArticulos> {
    const [unidades, items, grupos] = await Promise.all([
      this.deps.repositorio.unidades(),
      this.deps.repositorio.listarItems({ companyId: sesion.companyId, soloActivos: false }),
      this.deps.repositorio.listarGrupos(sesion.companyId),
    ]);

    return {
      unidades,
      items: new Map(items.map((i) => [i.nombre.trim().toLocaleLowerCase(), i])),
      tarifasDeGrupo: new Map(grupos.map((g) => [g.id, g.ivaTarifa])),
    };
  }
}

/**
 * La fila resuelta, o el motivo por el que no se puede.
 *
 * Devolver `string` para el fallo y no lanzar es lo que permite recoger TODOS
 * los motivos del archivo en una pasada. `ConversionInvalidaError` se captura
 * aquí y **no se silencia**: su mensaje es exactamente lo que se devuelve.
 *
 * **LA TARIFA DE IVA: FILA > GRUPO DEL ÍTEM, Y SIN NINGUNA LA FILA SE RECHAZA**
 * (D-16.44). «Nunca 0.15» vale también para el importador: una columna
 * ausente no es una tarifa, y el mensaje dice qué hacer, como con una unidad
 * desconocida.
 */
function prepararArticulo(
  articulo: ArticuloDelLote,
  contexto: ContextoDeArticulos,
): DatosDeArticuloEnLote | string {
  const item = contexto.items.get(articulo.item.trim().toLocaleLowerCase());
  if (item === undefined) return `No existe ningún ítem llamado «${articulo.item.trim()}».`;

  const ivaTarifa = elegirTarifa({
    cuerpo: articulo.ivaTarifa,
    articulo: null,
    grupo: item.grupoId === null ? null : (contexto.tarifasDeGrupo.get(item.grupoId) ?? null),
  });
  if (ivaTarifa === null) {
    return `Falta la tarifa de IVA de «${articulo.nombre.trim()}»: ponla en la columna «iva» del archivo o en el grupo del ítem. Nunca se asume una.`;
  }

  return conFactor(articulo, { item, unidades: contexto.unidades, ivaTarifa });
}

function conFactor(
  articulo: ArticuloDelLote,
  resuelto: {
    readonly item: ItemLeido;
    readonly unidades: readonly UnidadDelCatalogo[];
    readonly ivaTarifa: string;
  },
): DatosDeArticuloEnLote | string {
  const { item, unidades, ivaTarifa } = resuelto;
  const compra = buscarUnidad(unidades, unidadDeUso(articulo.unidadDePresentacion));
  const uso = buscarUnidad(unidades, unidadDeUso(item.unidadDeUso));
  if (compra === null) return `La unidad «${articulo.unidadDePresentacion}» no está en el catálogo.`;
  if (uso === null) return `La unidad de uso «${item.unidadDeUso}» no está en el catálogo.`;

  try {
    const factor = factorDeConversion({
      presentacion: Quantity.of(articulo.presentacion, compra.codigo),
      unidadDeCompra: compra,
      unidadDeUso: uso,
      factorExplicito:
        articulo.factorExplicito === null
          ? null
          : Ratio.fromDecimalString(articulo.factorExplicito),
    });
    // Campo a campo y no con `...articulo`: el spread arrastraría
    // `factorExplicito`, que ya cumplió su papel y no es columna de nada.
    return {
      item: articulo.item,
      nombre: articulo.nombre,
      marca: articulo.marca,
      proveedor: articulo.proveedor,
      presentacion: articulo.presentacion,
      unidadDePresentacion: compra.codigo,
      factorDeConversion: factor.toStorageString(),
      ivaTarifa: Ratio.fromDecimalString(ivaTarifa).toStorageString(),
    };
  } catch (error) {
    if (error instanceof ConversionInvalidaError) {
      return mensajeDelProblemaDeConversion(error.problema);
    }
    throw error;
  }
}

function buscarUnidad(
  unidades: readonly UnidadDelCatalogo[],
  codigo: UnidadDeUso,
): UnidadDelCatalogo | null {
  return unidades.find((u) => u.codigo === codigo) ?? null;
}
