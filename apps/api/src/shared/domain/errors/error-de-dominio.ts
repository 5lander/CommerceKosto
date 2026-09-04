/**
 * Errores tipados de dominio — CLAUDE.md §3.
 *
 * EL CODIGO ES UN TIPO UNION, NO UNA CADENA LIBRE, y esa es la decision que
 * sostiene todo lo demas. La traduccion a HTTP vive en infraestructura, en una
 * tabla declarada como `Record<CodigoDeDominio, HttpStatus>`: si alguien anade
 * un codigo aqui y olvida mapearlo alli, **no compila**. La alternativa —una
 * cadena cualquiera con un `default` de respaldo— convierte el olvido en un
 * 500 en produccion que nadie ve hasta que un cliente lo reporta.
 *
 * EL DOMINIO NO SABE DE HTTP. Aqui no hay codigos 401 ni 403: hay nombres de
 * reglas de negocio. Quien los convierte en respuesta es el filtro, que es
 * infraestructura y puede cambiarse entero sin tocar una regla.
 */

export type CodigoDeDominio =
  | 'CREDENCIALES_INVALIDAS'
  | 'ACCESO_BLOQUEADO'
  | 'SESION_INVALIDA'
  | 'PERMISO_DENEGADO'
  | 'RECURSO_NO_ENCONTRADO'
  | 'LIMITE_DEL_PLAN'
  | 'ENTRADA_INVALIDA';

/**
 * `mensaje` SALE AL CLIENTE TAL CUAL. Todo lo que se escriba aqui es publico:
 * nada de nombres de tabla, rutas, ni pistas sobre por que fallo de verdad.
 * El detalle para diagnosticar va en `detalle`, que solo viaja al log.
 */
export abstract class ErrorDeDominio extends Error {
  public abstract readonly codigo: CodigoDeDominio;

  public constructor(
    mensaje: string,
    public readonly detalle: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(mensaje);
    this.name = new.target.name;
  }
}
