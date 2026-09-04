/**
 * Lo que `pricing` necesita de la persistencia.
 *
 * TODO DECIMAL VIAJA COMO CADENA. Nunca `number`. Es la misma disciplina de
 * ADR-003 aplicada al borde del puerto: el día que alguien ponga un `number`
 * aquí, el error entra en el costo de cada plato y nadie lo ve.
 *
 * `resolver` NO ES `confirmar` y `rechazar` POR SEPARADO, y no es economía de
 * métodos: las dos operaciones tienen que competir por la misma fila con la
 * misma condición —«sigue sugerido»—, y partirlas invita a que una de las dos
 * se escriba sin esa condición. Con un método, la carrera se cierra una vez.
 */

import type { AjustesCapturados } from '../../domain/ajustes';
import type {
  CompanyId,
  ItemId,
  PurchaseArticleId,
  ReferencePriceId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';

export const REPOSITORIO_DE_PRECIOS = 'REPOSITORIO_DE_PRECIOS';

export type OrigenDePrecio = 'MANUAL' | 'ULTIMA_COMPRA' | 'EXTERNO';
export type DecisionSobrePrecio = 'CONFIRMED' | 'REJECTED';

/**
 * Los parámetros de costeo de D3. Decimales como cadena exacta.
 *
 * **LA FORMA LA DEFINE EL DOMINIO**, no este puerto. Estaba escrita dos veces
 * —aquí y en `domain/ajustes.ts`— y `audit:duplication` lo marcó: once campos
 * repetidos son once sitios donde añadir el doceavo en uno solo y no en el
 * otro. El dominio es el dueño porque es quien tiene las reglas sobre ellos.
 */
export type AjustesDeCompany = AjustesCapturados;

export interface PrecioLeido {
  readonly id: ReferencePriceId;
  readonly itemId: ItemId;
  readonly purchaseArticleId: PurchaseArticleId | null;
  readonly precio: string;
  readonly ivaCompra: string;
  readonly origen: string;
  readonly estado: string;
  readonly validFrom: Date;
  readonly createdAt: Date;
  readonly nota: string | null;
}

export interface DatosParaSugerir {
  readonly companyId: CompanyId;
  readonly itemId: ItemId;
  readonly purchaseArticleId: PurchaseArticleId | null;
  readonly precio: string;
  readonly ivaCompra: string;
  readonly origen: OrigenDePrecio;
  readonly validFrom: Date;
  readonly createdBy: UserId;
  readonly nota: string | null;
}

export type ResultadoDeResolucion = 'resuelto' | 'no_encontrado' | 'ya_resuelto';

export interface RepositorioDePrecios {
  ajustes(companyId: CompanyId): Promise<AjustesDeCompany | null>;

  guardarAjustes(entrada: {
    readonly companyId: CompanyId;
    readonly ajustes: AjustesDeCompany;
  }): Promise<void>;

  sugerir(datos: DatosParaSugerir): Promise<ReferencePriceId>;

  /**
   * Confirma o rechaza, **solo si sigue sugerido**. La condición va en el
   * `WHERE`, no en un `if` previo: dos administradores que confirman a la vez
   * no pueden ganar los dos.
   */
  resolver(entrada: {
    readonly companyId: CompanyId;
    readonly precioId: ReferencePriceId;
    readonly userId: UserId;
    readonly ahora: Date;
    readonly decision: DecisionSobrePrecio;
  }): Promise<ResultadoDeResolucion>;

  historial(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId;
  }): Promise<readonly PrecioLeido[]>;

  /**
   * Todos los precios CONFIRMADOS de la company con vigencia hasta una fecha.
   *
   * EXISTE PARA QUE COSTEAR UNA CARTA NO SEA UN N+1. Con `historial` por item,
   * costear 200 productos con 300 insumos son 300 consultas; el presupuesto de
   * 400 ms de CLAUDE.md §5 no lo aguanta.
   *
   * **DEVUELVE FILAS, NO EL VIGENTE.** Elegir cual esta vigente es R5 y vive en
   * `domain/vigencia.ts`, con su desempate por `created_at`. Un `DISTINCT ON`
   * en SQL seria mas rapido y pondria la regla de negocio en dos sitios; el dia
   * que uno de los dos cambiara, el costo del mes pasado dejaria de coincidir
   * consigo mismo.
   */
  confirmadosHasta(entrada: {
    readonly companyId: CompanyId;
    readonly hasta: Date;
  }): Promise<readonly PrecioLeido[]>;
}
