/**
 * Escritura EN LOTE de productos y de recetas.
 *
 * **AQUÍ SE DECIDE SI UNA LÍNEA ES RECETA O ES COMBO**, y la regla es la de
 * SPEC §8: lo dice el tipo del producto destino, no la fila. Un `SIMPLE`
 * consume ítems; un `COMBO` consume productos simples ya costeados.
 *
 * **UN COMBO QUE CONTENGA OTRO COMBO SE RECHAZA.** Es lo que «componentes que
 * son productos simples» significa, y sin esa comprobación un combo podría
 * referirse a sí mismo por un camino indirecto. La validación de ciclos de R9
 * cubre las subpreparaciones, no esto: son dos tablas distintas.
 *
 * **LA MERMA NO SE APLICA DOS VECES.** El combo suma componentes **ya
 * costeados** (ADR-008 §14, R12), que es exactamente por lo que sus líneas van a
 * `combo_component` y no a `recipe_line`: capturar un combo como producto simple
 * con receta a ítems volvería a aplicarle el rendimiento y la provisión de
 * merma, y el número saldría plausible y bajo.
 */

import { auditarLote } from '../../../../shared/application/auditoria-de-lote';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { ItemId, LocationId, ProductId } from '../../../../shared/domain/identity/identificadores';
import {
  PRIMERA_POSICION,
  clavePorNombre,
  type ProblemaDelLote,
} from '../../../../shared/domain/lote/problemas';
import type { ListarItems } from '../../../catalog/application/casos-de-uso/items';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import { RecetaInvalidaError } from '../../domain/errores';
import {
  problemasDelLoteDeProductos,
  problemasDelLoteDeRecetas,
  type LineaDelLote,
  type ProductoDelLote,
} from '../../domain/lote';
import type {
  ComponenteEnLote,
  DatosDeProductoEnLote,
  ProductoLeido,
  RecetaEnLote,
  RepositorioDeRecetas,
} from '../ports/repositorio-de-recetas.port';

const TIPO_COMBO = 'COMBO';
const LINEA_ACTIVA = 'ACTIVA';

export interface DependenciasDeLotesDeRecetas {
  readonly repositorio: RepositorioDeRecetas;
  readonly auditoria: AuditLogPort;
  readonly listarItems: ListarItems;
}

export class CrearProductosEnLote {
  public constructor(private readonly deps: DependenciasDeLotesDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId; readonly productos: readonly ProductoDelLote[] },
  ): Promise<number> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const problemas = problemasDelLoteDeProductos(entrada.productos);
    if (problemas.length > 0) throw new RecetaInvalidaError(mensaje(problemas));

    const empaques = await this.empaques(sesion, entrada.productos);

    const resultado = await this.deps.repositorio.crearProductosEnLote({
      companyId: sesion.companyId,
      locationId: entrada.locationId,
      productos: entrada.productos.map((producto) => conEmpaque(producto, empaques)),
    });

    if (resultado.clase === 'nombres_en_uso') {
      throw new RecetaInvalidaError(
        `Estos productos ya existen en tu company: ${resultado.nombres.join(', ')}.`,
      );
    }

    await auditarLote({ auditoria: this.deps.auditoria, sesion, eventType: 'product.bulk_created', filas: resultado.filas });
    return resultado.filas;
  }

  /**
   * El empaque es un ÍTEM (ADR-008 §12), así que traducir su nombre exige leer
   * el catálogo — una vez para todo el lote, no una por producto.
   */
  private async empaques(
    sesion: SesionActiva,
    productos: readonly ProductoDelLote[],
  ): Promise<ReadonlyMap<string, ItemId>> {
    if (productos.every((p) => p.empaque === null)) return new Map();

    const items = await this.deps.listarItems.ejecutar(sesion, false);
    const porNombre = new Map(items.map((i) => [clavePorNombre(i.nombre), i.id]));

    const faltan = productos
      .flatMap((p) => (p.empaque === null ? [] : [p.empaque]))
      .filter((nombre) => !porNombre.has(clavePorNombre(nombre)));

    if (faltan.length > 0) {
      throw new RecetaInvalidaError(
        `Estos empaques no existen como ítem: ${[...new Set(faltan)].join(', ')}.`,
      );
    }
    return porNombre;
  }
}

export class GuardarRecetasEnLote {
  public constructor(private readonly deps: DependenciasDeLotesDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly lineas: readonly LineaDelLote[];
      readonly validFrom: Date;
    },
  ): Promise<number> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const problemas = problemasDelLoteDeRecetas(entrada.lineas);
    if (problemas.length > 0) throw new RecetaInvalidaError(mensaje(problemas));

    const armado = await this.armar(sesion, entrada.lineas);

    const filas = await this.deps.repositorio.guardarRecetasEnLote({
      companyId: sesion.companyId,
      locationId: entrada.locationId,
      recetas: armado.recetas,
      combos: armado.combos,
      validFrom: entrada.validFrom,
      createdBy: sesion.userId,
    });

    await auditarLote({ auditoria: this.deps.auditoria, sesion, eventType: 'recipe.bulk_saved', filas: filas });
    return filas;
  }

  /**
   * Agrupa las líneas por producto y las reparte entre recetas y combos.
   *
   * Recoge TODOS los motivos por los que una línea no se puede resolver, no el
   * primero: quien migra 284 líneas quiere la lista completa.
   */
  private async armar(
    sesion: SesionActiva,
    lineas: readonly LineaDelLote[],
  ): Promise<{ readonly recetas: readonly RecetaEnLote[]; readonly combos: readonly ComponenteEnLote[] }> {
    const catalogo = await this.catalogo(sesion);
    const problemas: ProblemaDelLote[] = [];
    const porProducto = new Map<string, LineaParaArmar[]>();

    for (const [indice, linea] of lineas.entries()) {
      const resuelta = resolverLinea(linea, catalogo);
      if (typeof resuelta === 'string') {
        problemas.push({ posicion: indice + PRIMERA_POSICION, motivo: resuelta });
        continue;
      }
      const clave = clavePorNombre(linea.producto);
      porProducto.set(clave, [...(porProducto.get(clave) ?? []), resuelta]);
    }

    if (problemas.length > 0) throw new RecetaInvalidaError(mensaje(problemas));
    return repartir(porProducto);
  }

  private async catalogo(sesion: SesionActiva): Promise<Catalogo> {
    const items = await this.deps.listarItems.ejecutar(sesion, false);
    const productos = await this.deps.repositorio.listarProductos(sesion.companyId);

    return {
      items: new Map(items.map((i) => [clavePorNombre(i.nombre), i.id])),
      productos: new Map(productos.map((p) => [clavePorNombre(p.nombre), p])),
    };
  }
}

interface Catalogo {
  readonly items: ReadonlyMap<string, ItemId>;
  readonly productos: ReadonlyMap<string, ProductoLeido>;
}

type LineaParaArmar =
  | { readonly clase: 'item'; readonly destino: ProductId; readonly itemId: ItemId; readonly cantidad: string; readonly base: LineaDelLote['base'] }
  | { readonly clase: 'combo'; readonly destino: ProductId; readonly componentProductId: ProductId; readonly cantidad: string };

/**
 * Traduce una línea, o dice por qué no se puede.
 *
 * El tipo del producto destino decide contra qué catálogo se busca el
 * componente. Es la regla de SPEC §8 escrita en código.
 */
function resolverLinea(linea: LineaDelLote, catalogo: Catalogo): LineaParaArmar | string {
  const destino = catalogo.productos.get(clavePorNombre(linea.producto));
  if (destino === undefined) return `No existe ningún producto llamado «${linea.producto.trim()}».`;

  if (destino.tipo === TIPO_COMBO) return componenteDeCombo(linea, destino.id, catalogo);

  const itemId = catalogo.items.get(clavePorNombre(linea.componente));
  if (itemId === undefined) return `No existe ningún ítem llamado «${linea.componente.trim()}».`;

  return { clase: 'item', destino: destino.id, itemId, cantidad: linea.cantidad, base: linea.base };
}

function componenteDeCombo(
  linea: LineaDelLote,
  destino: ProductId,
  catalogo: Catalogo,
): LineaParaArmar | string {
  const componente = catalogo.productos.get(clavePorNombre(linea.componente));

  if (componente === undefined) {
    return (
      `«${linea.producto.trim()}» es un combo, así que «${linea.componente.trim()}» tiene que ser ` +
      'un producto de la carta, y no existe ninguno con ese nombre.'
    );
  }
  if (componente.tipo === TIPO_COMBO) {
    return `Un combo no puede contener otro combo: «${linea.componente.trim()}» también es un combo.`;
  }
  if (componente.id === destino) {
    return `«${linea.producto.trim()}» no puede ser componente de sí mismo.`;
  }

  return { clase: 'combo', destino, componentProductId: componente.id, cantidad: linea.cantidad };
}

function repartir(
  porProducto: ReadonlyMap<string, readonly LineaParaArmar[]>,
): { readonly recetas: readonly RecetaEnLote[]; readonly combos: readonly ComponenteEnLote[] } {
  const recetas: RecetaEnLote[] = [];
  const combos: ComponenteEnLote[] = [];

  for (const lineas of porProducto.values()) {
    const deItems = lineas.filter((l) => l.clase === 'item');
    const primera = deItems[0];

    if (primera !== undefined) {
      recetas.push({
        destino: { clase: 'producto', productId: primera.destino },
        lineas: deItems.map((l) => ({
          itemId: l.itemId,
          cantidad: l.cantidad,
          base: l.base,
          estado: LINEA_ACTIVA,
        })),
      });
    }

    for (const linea of lineas) {
      if (linea.clase === 'combo') {
        combos.push({
          comboProductId: linea.destino,
          componentProductId: linea.componentProductId,
          cantidad: linea.cantidad,
        });
      }
    }
  }

  return { recetas, combos };
}

function conEmpaque(
  producto: ProductoDelLote,
  empaques: ReadonlyMap<string, ItemId>,
): DatosDeProductoEnLote {
  return {
    nombre: producto.nombre,
    tipo: producto.tipo,
    categoria: producto.categoria,
    empaqueItemId: producto.empaque === null ? null : (empaques.get(clavePorNombre(producto.empaque)) ?? null),
    activo: producto.activo,
    pvp: producto.pvp,
    rendimientoPorciones: producto.rendimientoPorciones,
  };
}

function mensaje(problemas: readonly ProblemaDelLote[]): string {
  return problemas.map((p) => `fila ${String(p.posicion)}: ${p.motivo}`).join('\n  ');
}
