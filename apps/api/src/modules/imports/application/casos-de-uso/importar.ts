/**
 * Importar un archivo: analizarlo y, si alguien lo confirma, escribirlo.
 *
 * **ES UN SOLO CASO DE USO Y NO DOS, PORQUE NO HAY UI.** El plan original tenía
 * subida, previsualización y confirmación en pasos separados, con su pantalla
 * cada uno. Sin esa pantalla, partirlo en dos sería construir la costura de una
 * puerta que nadie va a abrir todavía (OPTIMIZACION.md §1). El rastro en
 * `import_job` sí queda entero: subida, análisis y confirmación son tres estados
 * de la misma fila.
 *
 * **`imports` NO ESCRIBE NI UN ÍTEM.** Traduce las celdas y llama al caso de uso
 * de lote del módulo dueño, que valida con sus propias reglas. Un ítem importado
 * tiene que ser indistinguible de uno creado a mano; si el importador fuera más
 * permisivo, sería una puerta trasera al catálogo.
 *
 * **SIN `confirmar` NO SE ESCRIBE NADA.** El análisis se guarda igual: es lo que
 * permite mirar 149 filas antes de tocar la base.
 */

import type { LocationId } from '../../../../shared/domain/identity/identificadores';
import type { CrearArticulosEnLote, CrearItemsEnLote } from '../../../catalog/application/casos-de-uso/lotes';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { RegistrarMovimientosEnLote } from '../../../inventory/application/casos-de-uso/lotes';
import type { SugerirPreciosEnLote } from '../../../pricing/application/casos-de-uso/lotes';
import type {
  CrearProductosEnLote,
  GuardarRecetasEnLote,
} from '../../../recipes/application/casos-de-uso/lotes';
import { analizar, esAnalisis, type Analisis, type TipoDeImportacion } from '../../domain/analisis';
import {
  ArchivoDemasiadoGrandeError,
  ArchivoIlegibleError,
  DemasiadasFilasError,
} from '../../domain/errores';
import { DESCRIPTORES } from '../../domain/tipos';
import {
  comoArticulo,
  comoItem,
  comoLineaDeReceta,
  comoMovimiento,
  comoPrecio,
  comoProducto,
} from '../traduccion';
import type { LectorDeHoja } from '../ports/lector-de-hoja.port';
import type { RepositorioDeImportaciones } from '../ports/repositorio-de-importaciones.port';

/**
 * Los topes de SEGURIDAD.md §5.1, que llegan por parametro.
 *
 * **NO SE LEEN DE `infrastructure/limites.ts` DESDE AQUI**: `application` no
 * puede mirar hacia `infrastructure`. Y no son constantes de dominio porque son
 * politica de despliegue —una instalacion con mas memoria puede subirlos— y no
 * una regla de negocio.
 */
export interface TopesDelArchivo {
  readonly bytes: number;
  /** El mismo tope en MB, para el mensaje. `limites.ts` ya lo tiene escrito. */
  readonly megabytes: number;
  readonly filas: number;
}

export interface DependenciasDeImportacion {
  readonly repositorio: RepositorioDeImportaciones;
  readonly lector: LectorDeHoja;
  readonly topes: TopesDelArchivo;
  readonly crearItems: CrearItemsEnLote;
  readonly crearArticulos: CrearArticulosEnLote;
  readonly sugerirPrecios: SugerirPreciosEnLote;
  readonly crearProductos: CrearProductosEnLote;
  readonly guardarRecetas: GuardarRecetasEnLote;
  readonly registrarMovimientos: RegistrarMovimientosEnLote;
}

export interface DatosDeImportacion {
  readonly tipo: TipoDeImportacion;
  readonly bytes: Uint8Array;
  readonly nombreOriginal: string;
  readonly claveDeAlmacenamiento: string;
  readonly locationId: LocationId;
  /** Sin esto no se escribe nada. */
  readonly confirmar: boolean;
  /**
   * Solo para `PRECIOS`: si nacen vigentes. R5 exige que lo decida una persona,
   * y esta bandera es esa persona diciéndolo.
   */
  readonly confirmarPrecios: boolean;
  /** La vigencia de precios y recetas, y la fecha del lote. */
  readonly vigenciaDesde: Date;
}

export interface ResultadoDeImportacion {
  readonly id: string;
  readonly analisis: Analisis;
  /** `null` si no se confirmó: el análisis se guardó y no se escribió nada. */
  readonly filasEscritas: number | null;
}

export class ImportarArchivo {
  public constructor(private readonly deps: DependenciasDeImportacion) {}

  public async ejecutar(
    sesion: SesionActiva,
    datos: DatosDeImportacion,
  ): Promise<ResultadoDeImportacion> {
    // EL TAMAÑO SE COMPRUEBA ANTES DE ESCRIBIR EL RASTRO Y ANTES DE LEER NADA.
    // Un archivo de 400 MB no debe llegar ni a abrir una transacción, y menos
    // aún a cruzar el canal IPC hacia el proceso hijo.
    if (datos.bytes.byteLength > this.deps.topes.bytes) {
      throw new ArchivoDemasiadoGrandeError(this.deps.topes.megabytes);
    }

    const id = await this.deps.repositorio.crear({
      companyId: sesion.companyId,
      userId: sesion.userId,
      tipo: datos.tipo,
      claveDeAlmacenamiento: datos.claveDeAlmacenamiento,
      nombreOriginal: datos.nombreOriginal,
      bytes: datos.bytes.byteLength,
    });

    const analisis = await this.analizar(datos);
    await this.deps.repositorio.guardarAnalisis({ companyId: sesion.companyId, id, analisis });

    if (!datos.confirmar) return { id, analisis, filasEscritas: null };

    const filasEscritas = await this.escribir(sesion, datos, analisis);
    await this.deps.repositorio.marcarConfirmada({
      companyId: sesion.companyId,
      id,
      filasEscritas,
    });

    return { id, analisis, filasEscritas };
  }

  /**
   * Un problema de CABECERA no es un análisis con problemas: es un archivo que
   * no se puede analizar. Sale como error y no como resultado porque no hay nada
   * que previsualizar — ninguna fila se pudo leer.
   */
  private async analizar(datos: DatosDeImportacion): Promise<Analisis> {
    const filas = await this.deps.lector.leer(datos.bytes);

    // El tope de FILAS se comprueba después de leer y antes de analizar: el
    // lector ya acotó lo que descomprime, pero un CSV plano de cinco millones
    // de líneas cabe en 5 MB y analizarlo entero no lo cubre nadie más.
    if (filas.length > this.deps.topes.filas) {
      throw new DemasiadasFilasError(this.deps.topes.filas);
    }

    const resultado = analizar(filas, DESCRIPTORES[datos.tipo]);

    if (!esAnalisis(resultado)) {
      throw new ArchivoIlegibleError(
        `Al archivo le faltan columnas obligatorias: ${resultado.faltantes.join(', ')}.`,
      );
    }
    return resultado;
  }

  /**
   * **NO SE ESCRIBE NADA SI HAY UNA SOLA FILA CON PROBLEMA.** Es el criterio de
   * aceptación de este paquete dicho al revés: la fila 150 mala no escribe las
   * 149 buenas. Se comprueba aquí, antes de llamar a ningún módulo, porque una
   * vez repartido el lote entre cuatro transacciones ya no habría vuelta atrás.
   */
  private async escribir(
    sesion: SesionActiva,
    datos: DatosDeImportacion,
    analisis: Analisis,
  ): Promise<number> {
    if (analisis.problemas.length > 0) {
      throw new ArchivoIlegibleError(
        `El archivo tiene ${String(analisis.problemas.length)} fila(s) con problemas y no se ` +
          'escribió nada. Corrígelas y vuelve a intentarlo.',
      );
    }
    return this.despachar(sesion, datos, analisis);
  }

  private async despachar(
    sesion: SesionActiva,
    datos: DatosDeImportacion,
    analisis: Analisis,
  ): Promise<number> {
    const { validas } = analisis;

    if (datos.tipo === 'ITEMS') {
      return this.deps.crearItems.ejecutar(sesion, validas.map(comoItem));
    }
    if (datos.tipo === 'ARTICULOS') {
      return this.deps.crearArticulos.ejecutar(sesion, validas.map(comoArticulo));
    }
    if (datos.tipo === 'PRECIOS') {
      return this.deps.sugerirPrecios.ejecutar(sesion, {
        precios: validas.map(comoPrecio),
        validFrom: datos.vigenciaDesde,
        confirmar: datos.confirmarPrecios,
      });
    }
    if (datos.tipo === 'PRODUCTOS') {
      return this.deps.crearProductos.ejecutar(sesion, {
        locationId: datos.locationId,
        productos: validas.map(comoProducto),
      });
    }
    if (datos.tipo === 'RECETAS') {
      return this.deps.guardarRecetas.ejecutar(sesion, {
        locationId: datos.locationId,
        lineas: validas.map(comoLineaDeReceta),
        validFrom: datos.vigenciaDesde,
      });
    }
    return this.deps.registrarMovimientos.ejecutar(sesion, {
      locationId: datos.locationId,
      movimientos: validas.map(comoMovimiento),
    });
  }
}
