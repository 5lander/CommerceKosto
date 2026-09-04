/**
 * Validacion por esquema en el limite HTTP — CLAUDE.md §3.
 *
 * TODO ESQUEMA DE ESTE PROYECTO ES `.strict()`, y esa es la decision que
 * importa. El modo por defecto de Zod —ignorar las claves que sobran— convierte
 * la asignacion masiva en un fallo silencioso: un cliente manda `companyId` o
 * `role` de mas, el esquema los tira sin decir nada, y el dia que alguien pase
 * el cuerpo entero a un `update` la clave de mas se escribe. Con `.strict()` la
 * peticion se RECHAZA, y el intento queda registrado en vez de perdido.
 *
 * El pipe no sabe de dominio: recibe un esquema y devuelve el valor tipado. La
 * unica decision que toma es convertir el fallo de Zod en un error de dominio,
 * para que salga por el mismo formato `{ code, message }` que todo lo demas.
 */

import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { EntradaInvalidaError } from '../../domain/errors/entrada-invalida';

/** Cuantos problemas se enumeran. Mas alla es ruido para quien integra. */
const PROBLEMAS_A_MOSTRAR = 5;

@Injectable()
export class EsquemaPipe<T> implements PipeTransform<unknown, T> {
  public constructor(private readonly esquema: ZodType<T>) {}

  public transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) {
      return resultado.data;
    }

    const problemas = resultado.error.issues
      .slice(0, PROBLEMAS_A_MOSTRAR)
      .map((issue) => `${issue.path.join('.') || '(cuerpo)'}: ${issue.message}`);

    throw new EntradaInvalidaError(problemas);
  }
}
