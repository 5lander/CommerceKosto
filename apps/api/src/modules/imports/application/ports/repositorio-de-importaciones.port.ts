/**
 * Lo que `imports` necesita de la persistencia: su propia tabla y nada más.
 *
 * **NO ESCRIBE ÍTEMS, NI ARTÍCULOS, NI RECETAS.** Eso lo hacen los casos de uso
 * de lote de cada módulo dueño, y no es ceremonia: un ítem creado desde aquí
 * sería un ítem que no pasó por las reglas del catálogo —rendimiento, unidad,
 * tipo— y del que nadie sabría de dónde salió. CLAUDE.md §2 lo dice y
 * `audit:forbidden` lo hace cumplir.
 *
 * Lo que sí guarda este puerto es el **rastro**: qué archivo se subió, quién lo
 * subió, qué decía el análisis y qué se acabó escribiendo.
 */

import type { CompanyId, UserId } from '../../../../shared/domain/identity/identificadores';
import type { Analisis, TipoDeImportacion } from '../../domain/analisis';

export const REPOSITORIO_DE_IMPORTACIONES = 'REPOSITORIO_DE_IMPORTACIONES';

/**
 * **NO HAY `leer()`, Y ES DELIBERADO.** Una version anterior de este puerto lo
 * tenia, y con el un `as unknown as Analisis` para sacar el `jsonb` de vuelta:
 * el analisis se guarda sin esquema, asi que devolverlo tipado era una promesa
 * que la base no respalda. `audit:forbidden` lo paro con la regla
 * `no-as-unknown-as`, y tenia razon dos veces — porque ademas **nadie lo
 * llamaba**: el comando imprime el analisis que acaba de calcular, no uno
 * releido. El dia que exista la pantalla de importaciones, `leer()` vuelve con
 * su validacion de esquema, que es lo que faltaba.
 */
export interface RepositorioDeImportaciones {
  crear(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly tipo: TipoDeImportacion;
    readonly claveDeAlmacenamiento: string;
    readonly nombreOriginal: string;
    readonly bytes: number;
  }): Promise<string>;

  guardarAnalisis(entrada: {
    readonly companyId: CompanyId;
    readonly id: string;
    readonly analisis: Analisis;
  }): Promise<void>;

  /**
   * Marca la importación como confirmada.
   *
   * **NO OCURRE EN LA MISMA TRANSACCIÓN QUE ESCRIBE LAS FILAS, Y NO PUEDE.**
   * Las filas las escribe el módulo dueño —`catalog`, `pricing`, `recipes`,
   * `inventory`— dentro de su propia `TenantTransaction.run()`, y
   * `ClienteDeTransaccion` no expone `$transaction`: no hay forma de que una
   * transacción contenga a otra. Una versión anterior de este puerto prometía
   * esa atomicidad; era falsa y se corrigió en vez de dejarla escrita.
   *
   * **Lo que protege de verdad** es el orden: el lote se valida entero antes de
   * abrir ninguna transacción, así que lo único que cabe entre las dos
   * escrituras es una caída de infraestructura. Si ocurre, quedan las filas
   * escritas y el trabajo en `ANALIZADA`, que es el estado honesto: dice que
   * nadie confirmó, y el operador lo ve al reintentar porque los nombres ya
   * existen.
   */
  marcarConfirmada(entrada: {
    readonly companyId: CompanyId;
    readonly id: string;
    readonly filasEscritas: number;
  }): Promise<void>;
}
