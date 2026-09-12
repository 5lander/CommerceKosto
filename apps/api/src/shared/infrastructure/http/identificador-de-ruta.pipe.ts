/**
 * Un `:id` de ruta que no es un UUID es 400 `ENTRADA_INVALIDA`, antes de llegar
 * al manejador — P16-C, D-16.130.
 *
 * POR QUÉ NO `ParseUUIDPipe`. Lo usaba una ruta de la aplicación y las demás
 * validaban dentro del manejador con el constructor del identificador
 * (`productId(id)`), y las dos formas respondían DISTINTO al mismo error:
 * `BAD_REQUEST` con el mensaje de Nest, o `ENTRADA_INVALIDA` con el del dominio,
 * que es el que documenta `docs/apis/app-cliente.md` (P16-A2, INC-012). Un
 * cliente que distingue errores por `code` tenía dos contratos para un solo
 * fallo. Este pipe lanza el error del dominio, así que la respuesta es la misma
 * venga de donde venga, y deja de depender de que cada manejador se acuerde de
 * construir el identificador antes de usarlo.
 *
 * EL BACK OFFICE SIGUE CON `ParseUUIDPipe`: es otra superficie, con su propio
 * contrato en `docs/apis/back-office.md`, y cambiarle el `code` no le arregla
 * nada a nadie.
 */

import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

import { identificadorDeEntrada } from '../../domain/identity/identificadores';

/** Lo que dice el mensaje cuando Nest no pasa el nombre del parámetro. */
const PARAMETRO_SIN_NOMBRE = 'identificador';

@Injectable()
export class IdentificadorDeRuta implements PipeTransform<string, string> {
  /** @throws {IdentificadorInvalidoError} */
  public transform(valor: string, metadata: ArgumentMetadata): string {
    return identificadorDeEntrada(metadata.data ?? PARAMETRO_SIN_NOMBRE, valor);
  }
}
