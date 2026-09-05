/**
 * El conteo físico — SPEC §3 y §16, D6 y D7.
 *
 * **DOS LECTURAS DISTINTAS, NO UNA FILTRADA.** `LeerHojaDeConteo` devuelve la
 * hoja para contar: los ítems y lo que se lleva anotado, y **nada más**.
 * `LeerConciliacion` devuelve el stock teórico, la diferencia y su
 * valorización. Son dos casos de uso, dos permisos y dos consultas, porque
 * CLAUDE.md §4.3 exige proyecciones por rol y no un filtro sobre una respuesta
 * completa: un campo que se calcula y luego se quita ya viajó por el cable
 * alguna vez, y basta con que alguien retire el filtro para publicarlo.
 *
 * **LA HOJA LISTA TODOS LOS ÍTEMS ALMACENABLES, TENGAN SALDO O NO.** Es lo que
 * hace el conteo verdaderamente ciego: si trajera solo los ítems con saldo, la
 * sola presencia de una fila diría «de esto el libro cree que hay algo» y su
 * ausencia diría «cero». Además es lo correcto operativamente — se cuenta lo
 * que hay en el estante, incluido lo que el libro no sabe que existe.
 *
 * **CONFIRMAR CONGELA.** El stock teórico y el costo de cada línea se guardan
 * en la fila. Dependen de precios con vigencia (R5), así que recalcularlos
 * mañana podría dar otro número para un mes ya informado. Es la misma decisión
 * que P6 tomó con el costo estándar de una producción (ADR-009).
 */

import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type {
  ItemId,
  LocationId,
  PeriodId,
  PhysicalCountId,
} from '../../../../shared/domain/identity/identificadores';
import { Money, Quantity, type Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso, type UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import type {
  AsegurarPeriodo,
  CerrarPeriodo,
  ConsultarPeriodo,
} from '../../../periods/application/casos-de-uso/periodos';
import type { CalendarioDePeriodos } from '../../../periods/domain/periodo';
import type { CostosDeItems } from '../../../pricing/application/casos-de-uso/costos-de-items';
import {
  conciliar,
  consumoReal,
  type Conciliacion,
  type EntradaDeConciliacion,
  type LineaConciliada,
} from '../../domain/conciliacion';
import { CONFIRMADO, exigirBorrador, exigirLineasValidas } from '../../domain/conteo';
import {
  ConteoDelPeriodoYaConfirmadoError,
  ConteoNoConfirmadoError,
  ConteoNoEncontradoError,
  ItemDelLibroNoEncontradoError,
} from '../../domain/errores';
import type {
  ConteoLeido,
  LineaCongelada,
  LineaLeida,
  RepositorioDeConteos,
} from '../ports/repositorio-de-conteos.port';
import type { DependenciasDeInventario } from './movimientos';

export interface DependenciasDeConteo extends DependenciasDeInventario {
  readonly conteos: RepositorioDeConteos;
  readonly costosDeItems: CostosDeItems;
  readonly asegurarPeriodo: AsegurarPeriodo;
  readonly consultarPeriodo: ConsultarPeriodo;
  readonly cerrarPeriodo: CerrarPeriodo;
  readonly calendario: CalendarioDePeriodos;
}

/** Una fila de la hoja: qué contar y qué se lleva anotado. Nada más. */
export interface FilaDeHoja {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly cantidad: string | null;
}

export interface HojaDeConteo {
  readonly conteo: ConteoLeido;
  readonly filas: readonly FilaDeHoja[];
}

/** Una fila conciliada, con todo lo que `BODEGA` no puede ver. */
export interface FilaConciliada {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly contado: string | null;
  readonly teorico: string;
  readonly diferencia: string | null;
  readonly valorDeDiferencia: string | null;
  readonly costoUnitario: string;
}

export interface ConciliacionDeConteo {
  readonly conteo: ConteoLeido;
  readonly filas: readonly FilaConciliada[];
  readonly valorTeorico: string;
  readonly valorCubierto: string;
  readonly valorFisico: string;
  /** `null` cuando no había nada que verificar. No es «0 %». */
  readonly cobertura: string | null;
  readonly comprasDelPeriodo: string;
  /** El valor físico del conteo confirmado del mes anterior. `null` si no lo hubo. */
  readonly valorInicial: string | null;
  /** SPEC §16. `null` sin inventario inicial: no se inventa. */
  readonly consumoReal: string | null;
}

export class CrearConteo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {MesInvalidoError}
   * @throws {ConteoDelPeriodoYaConfirmadoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: {
      readonly locationId: LocationId;
      readonly anio: number;
      readonly mes: number;
      readonly note: string | null;
    },
  ): Promise<PhysicalCountId> {
    const periodo = await this.deps.asegurarPeriodo.ejecutar(sesion, datos);
    await exigirPeriodoSinConteoConfirmado(this.deps, sesion, periodo);

    const id = await this.deps.conteos.crear({
      companyId: sesion.companyId,
      periodId: periodo.id,
      userId: sesion.userId,
      // El corte es el FIN DEL PERÍODO, no el día en que se cuenta: «el conteo
      // de marzo» significa el estado al cerrar marzo, se levante el 2 de abril
      // o el 5. La fecha real de captura vive en `created_at`.
      corteEn: periodo.finEn,
      note: datos.note,
    });

    await registrarEventoDeConteo({ deps: this.deps, sesion, eventType: 'count.created', id });
    return id;
  }
}

export class ListarConteos {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /** @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId },
  ): Promise<readonly ConteoLeido[]> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);
    return this.deps.conteos.listarPorUbicacion({
      companyId: sesion.companyId,
      locationId: entrada.locationId,
    });
  }
}

/**
 * La hoja para contar. **Nunca lleva stock teórico ni nada derivado de él.**
 *
 * Es el endpoint que `BODEGA` usa, y el que la prueba de confidencialidad
 * inspecciona sobre la respuesta cruda.
 */
export class LeerHojaDeConteo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /** @throws {ConteoNoEncontradoError} @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly countId: PhysicalCountId },
  ): Promise<HojaDeConteo> {
    const conteo = await exigirConteo(this.deps, sesion, entrada.countId);

    const [items, lineas] = await Promise.all([
      this.deps.listarItems.ejecutar(sesion, true),
      this.deps.conteos.lineas({ companyId: sesion.companyId, countId: conteo.id }),
    ]);

    const anotado = new Map(lineas.map((linea) => [linea.itemId, linea.cantidad]));

    return {
      conteo,
      filas: items.filter(seAlmacena).map((item) => ({
        itemId: item.id,
        nombre: item.nombre,
        unidadDeUso: item.unidadDeUso,
        cantidad: anotado.get(item.id) ?? null,
      })),
    };
  }
}

export class GuardarLineasDeConteo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /**
   * @throws {ConteoNoEncontradoError} @throws {ConteoYaConfirmadoError}
   * @throws {ItemRepetidoEnConteoError} @throws {CantidadDeConteoNegativaError}
   * @throws {ItemDelLibroNoEncontradoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: {
      readonly countId: PhysicalCountId;
      readonly lineas: readonly { readonly itemId: ItemId; readonly cantidad: string }[];
    },
  ): Promise<void> {
    const conteo = await exigirConteo(this.deps, sesion, datos.countId);
    exigirBorrador(conteo.estado);

    const unidades = await unidadesDelCatalogo(this.deps, sesion);
    const validadas = exigirLineasValidas(
      datos.lineas.map((linea) => ({
        itemId: linea.itemId,
        cantidad: Quantity.of(linea.cantidad, exigirUnidad(unidades, linea.itemId)),
      })),
    );

    await this.deps.conteos.reemplazarLineas({
      companyId: sesion.companyId,
      countId: conteo.id,
      lineas: validadas.map((linea) => ({
        itemId: linea.itemId,
        cantidad: linea.cantidad.toStorageString(),
      })),
    });
  }
}

/**
 * Congela el conteo: los tres valores en la cabecera, y el teórico y el costo
 * en cada línea.
 *
 * Materializa una línea **por cada ítem con saldo o con conteo**, incluidas las
 * de lo que nadie contó, con `cantidad = null`. A partir de aquí la
 * conciliación entera es una lectura de esa tabla, y da el mismo número dentro
 * de un año aunque alguien inserte después un precio con vigencia retroactiva.
 */
export class ConfirmarConteo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /**
   * @throws {ConteoNoEncontradoError} @throws {ConteoYaConfirmadoError}
   * @throws {ConteoDelPeriodoYaConfirmadoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly countId: PhysicalCountId },
  ): Promise<void> {
    const conteo = await exigirConteo(this.deps, sesion, entrada.countId);
    exigirBorrador(conteo.estado);
    await exigirPeriodoSinConteoConfirmado(this.deps, sesion, {
      id: conteo.periodId,
      anio: conteo.anio,
      mes: conteo.mes,
    });

    const unidades = await unidadesDelCatalogo(this.deps, sesion);
    const entradas = await entradasDeConciliacion(this.deps, sesion, { conteo, unidades });
    const conciliacion = conciliar(entradas);

    await this.deps.conteos.confirmar({
      companyId: sesion.companyId,
      countId: conteo.id,
      periodId: conteo.periodId,
      userId: sesion.userId,
      ahora: this.deps.reloj.ahora(),
      valorTeorico: conciliacion.valorTeorico.toStorageString(),
      valorCubierto: conciliacion.valorCubierto.toStorageString(),
      valorFisico: conciliacion.valorFisico.toStorageString(),
      lineas: entradas.map(congelar),
    });

    await registrarEventoDeConteo({
      deps: this.deps,
      sesion,
      eventType: 'count.confirmed',
      id: conteo.id,
      cobertura: conciliacion.cobertura,
    });
  }
}

/**
 * La conciliación. **Exige `count.read`, que `BODEGA` no tiene.**
 *
 * Sobre un conteo confirmado lee lo congelado; sobre un borrador lo calcula al
 * vuelo, que es la previsualización que un gerente quiere antes de sellar el
 * mes. Las dos rutas pasan por la misma `conciliar()` del dominio, así que no
 * pueden discrepar.
 */
export class LeerConciliacion {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /** @throws {ConteoNoEncontradoError} @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly countId: PhysicalCountId },
  ): Promise<ConciliacionDeConteo> {
    const conteo = await exigirConteo(this.deps, sesion, entrada.countId);
    const items = await this.deps.listarItems.ejecutar(sesion, false);
    const catalogo = new Map(items.map((item) => [item.id, item]));

    const [entradas, compras, inicial] = await Promise.all([
      entradasDeConciliacion(this.deps, sesion, { conteo, unidades: unidadesDe(catalogo) }),
      comprasDelPeriodo(this.deps, sesion, conteo),
      valorInicialDe(this.deps, sesion, conteo),
    ]);

    return componer({ conteo, conciliacion: conciliar(entradas), catalogo, compras, inicial });
  }
}

/**
 * Cierra el mes de la ubicación del conteo — D6: «se cierra manualmente al
 * cargar el conteo físico».
 *
 * **EXIGE QUE EL CONTEO ESTÉ CONFIRMADO.** Sellar un mes cuya medición sigue en
 * borrador dejaría un período que ya no admite movimientos y del que nunca se
 * sabrá cuánto había: `inventario_final_fisico` de SPEC §16 se quedaría sin su
 * dato y el food cost real de ese mes no se podría calcular jamás.
 */
export class CerrarPeriodoDelConteo {
  public constructor(private readonly deps: DependenciasDeConteo) {}

  /**
   * @throws {ConteoNoEncontradoError} @throws {ConteoNoConfirmadoError}
   * @throws {PeriodoYaCerradoError} @throws {PeriodoNoTerminadoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly countId: PhysicalCountId },
  ): Promise<PeriodId> {
    const conteo = await exigirConteo(this.deps, sesion, entrada.countId);
    if (conteo.estado !== CONFIRMADO) throw new ConteoNoConfirmadoError();

    return this.deps.cerrarPeriodo.ejecutar(sesion, {
      locationId: conteo.locationId,
      anio: conteo.anio,
      mes: conteo.mes,
    });
  }
}

/* --- Piezas compartidas ---------------------------------------------------- */

/**
 * Un ítem entra al inventario si se compra, o si es una preparación que se
 * produce en lote. Una preparación con `llevaStock = false` no pasa por el
 * inventario —al venderse se explota su receta— y contarla no significa nada.
 */
function seAlmacena(item: ItemLeido): boolean {
  return item.tipo !== 'PRODUCIDO' || item.llevaStock === true;
}

async function unidadesDelCatalogo(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
): Promise<ReadonlyMap<ItemId, UnidadDeUso>> {
  const items = await deps.listarItems.ejecutar(sesion, false);
  return unidadesDe(new Map(items.map((item) => [item.id, item])));
}

function unidadesDe(catalogo: ReadonlyMap<ItemId, ItemLeido>): ReadonlyMap<ItemId, UnidadDeUso> {
  return new Map([...catalogo].map(([id, item]) => [id, unidadDeUso(item.unidadDeUso)]));
}

/**
 * La unidad de un ítem, o el error de que no existe.
 *
 * **NO HAY UNIDAD POR DEFECTO.** Poner «unid» cuando el ítem falta convertiría
 * un id equivocado en un conteo de una unidad que no es la suya, y el error
 * saldría meses después como una diferencia de inventario inexplicable.
 *
 * @throws {ItemDelLibroNoEncontradoError}
 */
function exigirUnidad(unidades: ReadonlyMap<ItemId, UnidadDeUso>, itemId: ItemId): UnidadDeUso {
  const unidad = unidades.get(itemId);
  if (unidad === undefined) throw new ItemDelLibroNoEncontradoError();
  return unidad;
}

/** @throws {ConteoNoEncontradoError} @throws {UbicacionFueraDeAlcanceError} */
async function exigirConteo(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  countId: PhysicalCountId,
): Promise<ConteoLeido> {
  const conteo = await deps.conteos.buscar({ companyId: sesion.companyId, countId });
  if (conteo === null) throw new ConteoNoEncontradoError();

  exigirUbicacionEnAlcance(sesion, conteo.locationId);
  return conteo;
}

/**
 * Solo puede haber un conteo confirmado por período.
 *
 * Sin esta comprobación el índice único subiría como `23505` → 500 (INC-012).
 * Y sin el índice único, dos confirmados harían que `inventario_final_fisico`
 * de SPEC §16 dependiera de cuál eligiera cada consulta.
 *
 * @throws {ConteoDelPeriodoYaConfirmadoError}
 */
async function exigirPeriodoSinConteoConfirmado(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  periodo: { readonly id: PeriodId; readonly anio: number; readonly mes: number },
): Promise<void> {
  const existente = await deps.conteos.confirmadoDe({
    companyId: sesion.companyId,
    periodId: periodo.id,
  });

  if (existente !== null) {
    const etiqueta = deps.calendario.de(periodo.anio, periodo.mes).etiqueta;
    throw new ConteoDelPeriodoYaConfirmadoError(etiqueta);
  }
}

interface ContextoDeConciliacion {
  readonly conteo: ConteoLeido;
  readonly unidades: ReadonlyMap<ItemId, UnidadDeUso>;
}

/**
 * Lo que hace falta para conciliar: el saldo del libro en el corte, lo contado
 * y el costo de uso a esa fecha.
 *
 * **SOBRE UN CONTEO CONFIRMADO NO SE VUELVE A CALCULAR NADA**: se lee lo
 * congelado. Es lo que hace que la diferencia de un mes cerrado siga siendo la
 * misma aunque después cambie un precio o entre un movimiento con fecha vieja.
 */
async function entradasDeConciliacion(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  contexto: ContextoDeConciliacion,
): Promise<readonly EntradaDeConciliacion[]> {
  const lineas = await deps.conteos.lineas({
    companyId: sesion.companyId,
    countId: contexto.conteo.id,
  });

  if (contexto.conteo.estado === CONFIRMADO) {
    return lineas.map((linea) => desdeLineaCongelada(linea, contexto.unidades));
  }
  return calcularEntradas(deps, sesion, { ...contexto, lineas });
}

/** Solo para un borrador: el libro y los precios de hoy, a la fecha del corte. */
async function calcularEntradas(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  datos: ContextoDeConciliacion & { readonly lineas: readonly LineaLeida[] },
): Promise<readonly EntradaDeConciliacion[]> {
  const [saldos, costos] = await Promise.all([
    deps.repositorio.saldos({
      companyId: sesion.companyId,
      locationId: datos.conteo.locationId,
      hasta: datos.conteo.corteEn,
    }),
    deps.costosDeItems.ejecutar(sesion, datos.conteo.corteEn),
  ]);

  const contados = new Map(datos.lineas.map((linea) => [linea.itemId, linea.cantidad]));
  const teoricos = new Map(saldos.map((saldo) => [saldo.itemId, saldo.cantidad]));

  return [...new Set([...teoricos.keys(), ...contados.keys()])].map((itemId) => {
    const unidad = datos.unidades.get(itemId) ?? unidadDeUso('unid');
    const contado = contados.get(itemId) ?? null;

    return {
      itemId,
      teorico: Quantity.fromDatabase(teoricos.get(itemId) ?? '0', unidad),
      contado: contado === null ? null : Quantity.fromDatabase(contado, unidad),
      // UN ÍTEM SIN PRECIO CONFIRMADO VALE CERO, y su cantidad se ve igual. La
      // alternativa —romper la conciliación entera— dejaría sin conteo a quien
      // tenga un solo ítem sin precio, que es cualquiera al empezar. El cero se
      // distingue en la respuesta: `costoUnitario` viaja por línea.
      costoDeUso: costos.porItem.get(itemId)?.costoNetoDeUso ?? Money.CERO,
    };
  });
}

function desdeLineaCongelada(
  linea: LineaLeida,
  unidades: ReadonlyMap<ItemId, UnidadDeUso>,
): EntradaDeConciliacion {
  const unidad = unidades.get(linea.itemId) ?? unidadDeUso('unid');

  return {
    itemId: linea.itemId,
    teorico: Quantity.fromDatabase(linea.teorico ?? '0', unidad),
    contado: linea.cantidad === null ? null : Quantity.fromDatabase(linea.cantidad, unidad),
    costoDeUso: Money.fromDatabase(linea.costoUnitario ?? '0'),
  };
}

function congelar(entrada: EntradaDeConciliacion): LineaCongelada {
  return {
    itemId: entrada.itemId,
    cantidad: entrada.contado?.toStorageString() ?? null,
    teorico: entrada.teorico.toStorageString(),
    costoUnitario: entrada.costoDeUso.toStorageString(),
  };
}

async function comprasDelPeriodo(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  conteo: ConteoLeido,
): Promise<string> {
  const periodo = deps.calendario.de(conteo.anio, conteo.mes);

  return deps.repositorio.comprasEntre({
    companyId: sesion.companyId,
    locationId: conteo.locationId,
    desde: periodo.inicioEn,
    hasta: conteo.corteEn,
  });
}

/**
 * El inventario inicial de SPEC §16: el conteo confirmado del mes anterior.
 *
 * **`null` SI NO LO HUBO, Y NO SE SUSTITUYE POR EL SALDO DEL LIBRO.** La cadena
 * de food cost real se ancla en conteos —«inicial + compras − final físico»— y
 * meter ahí un valor teórico daría un consumo real que no es real. Sin ese
 * dato, la respuesta lo dice en vez de inventarlo.
 */
async function valorInicialDe(
  deps: DependenciasDeConteo,
  sesion: SesionActiva,
  conteo: ConteoLeido,
): Promise<string | null> {
  const anterior = deps.calendario.anterior(deps.calendario.de(conteo.anio, conteo.mes));
  const periodo = await deps.consultarPeriodo.ejecutar(sesion, {
    locationId: conteo.locationId,
    anio: anterior.anio,
    mes: anterior.mes,
  });
  if (periodo === null) return null;

  const previo = await deps.conteos.confirmadoDe({
    companyId: sesion.companyId,
    periodId: periodo.id,
  });
  return previo?.valorFisico ?? null;
}

interface PiezasDeLaConciliacion {
  readonly conteo: ConteoLeido;
  readonly conciliacion: Conciliacion;
  readonly catalogo: ReadonlyMap<ItemId, ItemLeido>;
  readonly compras: string;
  readonly inicial: string | null;
}

function componer(piezas: PiezasDeLaConciliacion): ConciliacionDeConteo {
  const { conciliacion, inicial } = piezas;

  return {
    conteo: piezas.conteo,
    filas: conciliacion.lineas.map((linea) => comoFilaConciliada(linea, piezas.catalogo)),
    valorTeorico: conciliacion.valorTeorico.toStorageString(),
    valorCubierto: conciliacion.valorCubierto.toStorageString(),
    valorFisico: conciliacion.valorFisico.toStorageString(),
    cobertura: conciliacion.cobertura?.toStorageString() ?? null,
    comprasDelPeriodo: piezas.compras,
    valorInicial: inicial,
    consumoReal: inicial === null ? null : realDe(piezas).toStorageString(),
  };
}

function realDe(piezas: PiezasDeLaConciliacion): Money {
  return consumoReal({
    valorInicial: Money.fromDatabase(piezas.inicial ?? '0'),
    comprasDelPeriodo: Money.fromDatabase(piezas.compras),
    valorFisico: piezas.conciliacion.valorFisico,
  });
}

/**
 * El nombre y la unidad de un ítem que ya no está en el catálogo.
 *
 * No debería poder pasar —los ítems se archivan, no se borran (CLAUDE.md §5)—
 * pero una conciliación congelada sobrevive a cualquier cambio del catálogo, y
 * dejar la fila fuera escondería una diferencia real.
 */
function comoSeLlama(item: ItemLeido | undefined): {
  readonly nombre: string;
  readonly unidadDeUso: string;
} {
  return { nombre: item?.nombre ?? '', unidadDeUso: item?.unidadDeUso ?? '' };
}

function comoFilaConciliada(
  linea: LineaConciliada,
  catalogo: ReadonlyMap<ItemId, ItemLeido>,
): FilaConciliada {
  return {
    itemId: linea.itemId,
    ...comoSeLlama(catalogo.get(linea.itemId)),
    contado: linea.contado?.toStorageString() ?? null,
    teorico: linea.teorico.toStorageString(),
    diferencia: linea.diferencia?.toStorageString() ?? null,
    valorDeDiferencia: linea.valorDeDiferencia?.toStorageString() ?? null,
    costoUnitario: linea.costoDeUso.toStorageString(),
  };
}

interface EventoDeConteo {
  readonly deps: DependenciasDeConteo;
  readonly sesion: SesionActiva;
  readonly eventType: string;
  readonly id: PhysicalCountId;
  readonly cobertura?: Ratio | null;
}

async function registrarEventoDeConteo(evento: EventoDeConteo): Promise<void> {
  await registrarEventoDeUsuario({
    auditoria: evento.deps.auditoria,
    actorId: evento.sesion.userId,
    companyId: evento.sesion.companyId,
    eventType: evento.eventType,
    detail: {
      countId: evento.id,
      ...(evento.cobertura === undefined || evento.cobertura === null
        ? {}
        : { cobertura: evento.cobertura.toStorageString() }),
    },
  });
}
