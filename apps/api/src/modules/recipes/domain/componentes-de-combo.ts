/**
 * Qué lista de componentes puede tener un combo — SPEC §8, D-16.114.
 *
 * **UN COMBO SE COMPONE DE PRODUCTOS SIMPLES**, «las porciones reducidas, no los
 * productos de carta». Un combo dentro de otro no se costea (ADR-008 §14: el
 * combo suma componentes ya costeados, sin volver a aplicar merma), y por eso se
 * rechaza al guardar y no al calcular: un error al costear aparece cuando
 * alguien pide un reporte, lejos de quien lo causó.
 *
 * **LA BASE YA IMPIDE DOS DE ESTAS** —`combo_component_cantidad_positiva` y
 * `combo_component_no_se_contiene`— y la clave primaria impide la tercera, el
 * repetido. Esto las EXPLICA: sin guarda, las tres salían como 500 (INC-012).
 * «Solo productos simples» y «de tu company» no las puede decir un `CHECK`.
 *
 * ES DOMINIO PURO: entra la lista y lo que se sabe de cada producto, sale el
 * primer problema o `null`. La cantidad ya llega validada como decimal positivo
 * por el esquema del borde; aquí se vuelve a comprobar porque el dominio no
 * puede fiarse de quién lo llama.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import type { TipoDeProducto } from './linea-de-receta';

/** Un combo de más de cincuenta platos no es un combo: es una carga mal hecha. */
export const COMPONENTES_MAXIMOS = 50;

export interface ComponentePedido {
  readonly productId: string;
  readonly cantidad: string;
}

export function problemaDeComponentes(entrada: {
  readonly comboId: string;
  readonly tipoDelCombo: TipoDeProducto;
  readonly componentes: readonly ComponentePedido[];
  /** El tipo de cada producto nombrado que EXISTE en la company. Ausente = no existe. */
  readonly tipos: ReadonlyMap<string, TipoDeProducto>;
}): string | null {
  if (entrada.tipoDelCombo !== 'COMBO') {
    return 'Solo un producto de tipo COMBO lleva componentes. Un producto simple lleva receta.';
  }
  if (entrada.componentes.length > COMPONENTES_MAXIMOS) {
    return `Un combo puede tener como mucho ${String(COMPONENTES_MAXIMOS)} componentes.`;
  }

  const vistos = new Set<string>();
  for (const componente of entrada.componentes) {
    const problema = problemaDeUnComponente({ ...entrada, componente, vistos });
    if (problema !== null) return problema;
    vistos.add(componente.productId);
  }

  return null;
}

function problemaDeUnComponente(entrada: {
  readonly comboId: string;
  readonly componente: ComponentePedido;
  readonly tipos: ReadonlyMap<string, TipoDeProducto>;
  readonly vistos: ReadonlySet<string>;
}): string | null {
  const { componente } = entrada;

  if (componente.productId === entrada.comboId) {
    return 'Un combo no puede contenerse a sí mismo.';
  }
  if (entrada.vistos.has(componente.productId)) {
    return 'Un producto no puede aparecer dos veces en el mismo combo: sube su cantidad.';
  }

  const tipo = entrada.tipos.get(componente.productId);
  if (tipo === undefined) {
    return 'Uno de los componentes no existe en tu company.';
  }
  if (tipo === 'COMBO') {
    return 'Un combo no puede contener otro combo: se compone de productos simples (SPEC §8).';
  }
  if (!Ratio.fromDecimalString(componente.cantidad).isPositive()) {
    return 'La cantidad de cada componente tiene que ser mayor que cero.';
  }

  return null;
}
