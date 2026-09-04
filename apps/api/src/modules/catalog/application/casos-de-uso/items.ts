/**
 * Ítems y grupos — SPEC §5.
 *
 * EL ORDEN ES: dominio primero, base después. `problemaDeItem` corre antes de
 * tocar PostgreSQL, así que un rendimiento de 1.2 se rechaza con una frase que
 * explica por qué —limpiar no crea materia— en vez de con un `23514` del
 * driver. La base sigue teniendo su `CHECK`: es la que garantiza, esto es lo
 * que explica.
 *
 * NO HAY BORRADO. Un ítem se marca `INACTIVE` (CLAUDE.md §5). Borrarlo dejaría
 * huérfanas las líneas de receta de P4 y los movimientos de inventario de P6,
 * que es justamente lo que las claves foráneas `RESTRICT` impiden — y el rol de
 * la aplicación no tiene `DELETE` sobre estas tablas.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { ItemGroupId, ItemId } from '../../../../shared/domain/identity/identificadores';
import { Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { ConflictoDeCatalogoError, EntradaDeCatalogoInvalidaError, ItemNoEncontradoError } from '../../domain/errores';
import {
  mensajeDelProblemaDeItem,
  problemaDeItem,
  type ConfianzaDePrecio,
  type TipoDeItem,
} from '../../domain/item';
import type {
  EstadoDeCatalogo,
  GrupoLeido,
  ItemLeido,
  RepositorioDeCatalogo,
} from '../ports/repositorio-de-catalogo.port';

export interface DependenciasDeCatalogo {
  readonly repositorio: RepositorioDeCatalogo;
  readonly auditoria: AuditLogPort;
}

export interface DatosDeAltaDeItem {
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly unidadDeUso: string;
  readonly rendimiento: string;
  readonly grupoId: ItemGroupId | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly llevaStock: boolean | null;
}

export class CrearItem {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDeAltaDeItem): Promise<ItemId> {
    exigirItemValido(datos);

    const resultado = await this.deps.repositorio.crearItem({
      companyId: sesion.companyId,
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      unidadDeUso: unidadDeUso(datos.unidadDeUso),
      rendimiento: datos.rendimiento,
      grupoId: datos.grupoId,
      confianzaDePrecio: datos.confianzaDePrecio,
      llevaStock: datos.llevaStock,
    });

    if (resultado.clase === 'nombre_en_uso') {
      throw new ConflictoDeCatalogoError('Ya existe un ítem con ese nombre.');
    }

    await this.deps.auditoria.record({
      eventType: 'catalog.item.created',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { itemId: resultado.id, tipo: datos.tipo, unidad: datos.unidadDeUso },
    });

    return resultado.id;
  }
}

export interface DatosDeCambioDeItem {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly rendimiento: string;
  readonly grupoId: ItemGroupId | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly estado: EstadoDeCatalogo;
  readonly llevaStock: boolean | null;
}

export class ActualizarItem {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  /**
   * El TIPO y la UNIDAD DE USO no se pueden cambiar, y no es una omisión.
   * Cambiar la unidad de uso de un ítem que ya tiene recetas y movimientos
   * convertiría cada cantidad histórica en otra magnitud sin tocarla: 200 «g»
   * pasarían a ser 200 «kg» y el costo se multiplicaría por mil en silencio.
   * Si hace falta, se crea un ítem nuevo y se archiva el viejo.
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeCambioDeItem): Promise<void> {
    const actual = await this.deps.repositorio.buscarItem({
      companyId: sesion.companyId,
      itemId: datos.itemId,
    });
    if (actual === null) {
      throw new ItemNoEncontradoError();
    }

    exigirItemValido({
      nombre: datos.nombre,
      tipo: actual.tipo === 'PRODUCIDO' ? 'PRODUCIDO' : 'COMPRADO',
      rendimiento: datos.rendimiento,
      // EL INTERRUPTOR DE STOCK SÍ SE PUEDE CAMBIAR (P6), y `problemaDeItem`
      // sigue exigiendo lo mismo que al crear: obligatorio en una preparación,
      // prohibido en un comprado. Es la guarda del CHECK
      // `item_keeps_stock_solo_en_producido`.
      llevaStock: datos.llevaStock,
    });

    await this.deps.repositorio.actualizarItem({
      companyId: sesion.companyId,
      itemId: datos.itemId,
      nombre: datos.nombre.trim(),
      rendimiento: datos.rendimiento,
      grupoId: datos.grupoId,
      confianzaDePrecio: datos.confianzaDePrecio,
      estado: datos.estado,
      llevaStock: datos.llevaStock,
    });

    await this.deps.auditoria.record({
      eventType: datos.estado === 'INACTIVE' ? 'catalog.item.archived' : 'catalog.item.updated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { itemId: datos.itemId, estado: datos.estado },
    });
  }
}

/**
 * Un item por su identificador.
 *
 * EXISTE PARA QUE OTROS MODULOS NO TOQUEN LAS TABLAS DEL CATALOGO. CLAUDE.md §2
 * dice que los demas «referencian por ID y leen a traves de sus puertos», y
 * este es el puerto. `pricing` lo usa para el rendimiento del item, que es un
 * factor de la cadena de costo de SPEC §12; sin esto tendria que consultar
 * `item` a mano, que es justo lo que la regla `tablas-de-catalogo-solo-en-catalog`
 * impide.
 */
export class LeerItem {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  /** `null` si no existe en esa company. */
  public async ejecutar(sesion: SesionActiva, itemId: ItemId): Promise<ItemLeido | null> {
    return this.deps.repositorio.buscarItem({ companyId: sesion.companyId, itemId });
  }
}

export class ListarItems {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  public async ejecutar(sesion: SesionActiva, soloActivos: boolean): Promise<readonly ItemLeido[]> {
    return this.deps.repositorio.listarItems({ companyId: sesion.companyId, soloActivos });
  }
}

export class CrearGrupo {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  public async ejecutar(sesion: SesionActiva, nombre: string): Promise<ItemGroupId> {
    const resultado = await this.deps.repositorio.crearGrupo({
      companyId: sesion.companyId,
      nombre: nombre.trim(),
    });

    if (resultado.clase === 'nombre_en_uso') {
      throw new ConflictoDeCatalogoError('Ya existe un grupo con ese nombre.');
    }

    await this.deps.auditoria.record({
      eventType: 'catalog.group.created',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { grupoId: resultado.id },
    });

    return resultado.id;
  }
}

export class ListarGrupos {
  public constructor(private readonly deps: DependenciasDeCatalogo) {}

  public async ejecutar(sesion: SesionActiva): Promise<readonly GrupoLeido[]> {
    return this.deps.repositorio.listarGrupos(sesion.companyId);
  }
}

/** @throws {EntradaDeCatalogoInvalidaError} */
function exigirItemValido(datos: {
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly rendimiento: string;
  readonly llevaStock: boolean | null;
}): void {
  const problema = problemaDeItem({
    nombre: datos.nombre,
    tipo: datos.tipo,
    // La cadena entra al dominio como decimal exacto. Si no lo es, `Ratio`
    // lanza aquí y no seis capas más abajo con un valor ya redondeado.
    rendimiento: Ratio.fromDecimalString(datos.rendimiento),
    llevaStock: datos.llevaStock,
  });

  if (problema !== null) {
    throw new EntradaDeCatalogoInvalidaError(mensajeDelProblemaDeItem(problema));
  }
}
