/**
 * El rastro de una importación en PostgreSQL.
 *
 * **ESTE REPOSITORIO NO TOCA NINGUNA TABLA DE NEGOCIO**, solo `import_job`. Las
 * filas importadas las escriben los módulos dueños, y la regla
 * `tablas-de-catalogo-solo-en-catalog` de `audit:forbidden` lo hace cumplir
 * nombrando a `imports` explícitamente.
 *
 * **EL ANÁLISIS SE GUARDA EN `jsonb` Y NO SE LEE DE VUELTA.** Es una caché de
 * algo reproducible —si se pierde, se vuelve a subir el archivo— y dejarlo así
 * evita la única forma de sacarlo tipado sin esquema, que era un
 * `as unknown as`. Lo que sí se comprueba es que exista, y eso lo hace el
 * `CHECK` `import_job_analizada_tiene_analisis` de la migración.
 */

import { Injectable } from '@nestjs/common';

import type { CompanyId, UserId } from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type { RepositorioDeImportaciones } from '../application/ports/repositorio-de-importaciones.port';
import type { Analisis, TipoDeImportacion } from '../domain/analisis';

const SUBIDA = 'SUBIDA';
const ANALIZADA = 'ANALIZADA';
const CONFIRMADA = 'CONFIRMADA';

@Injectable()
export class PrismaImportacionesRepositorio implements RepositorioDeImportaciones {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async crear(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly tipo: TipoDeImportacion;
    readonly claveDeAlmacenamiento: string;
    readonly nombreOriginal: string;
    readonly bytes: number;
  }): Promise<string> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.importJob.create({
        data: {
          companyId: entrada.companyId,
          kind: entrada.tipo,
          status: SUBIDA,
          storageKey: entrada.claveDeAlmacenamiento,
          originalName: entrada.nombreOriginal,
          byteSize: entrada.bytes,
          createdBy: entrada.userId,
        },
        select: { id: true },
      });

      return fila.id;
    });
  }

  public async guardarAnalisis(entrada: {
    readonly companyId: CompanyId;
    readonly id: string;
    readonly analisis: Analisis;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      // `updateMany` y no `update`: sin `RETURNING`, y con `company_id`
      // repetido en el WHERE. RLS ya lo filtra, pero una defensa que solo está
      // en un sitio se cae entera si ese sitio falla.
      await tx.importJob.updateMany({
        where: { id: entrada.id, companyId: entrada.companyId },
        data: { status: ANALIZADA, analysis: comoJson(entrada.analisis) },
      });
    });
  }

  public async marcarConfirmada(entrada: {
    readonly companyId: CompanyId;
    readonly id: string;
    readonly filasEscritas: number;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      // Los tres campos a la vez, que es lo que el `CHECK`
      // `import_job_confirmada_es_coherente` exige: confirmada si y solo si hay
      // fecha y hay recuento.
      await tx.importJob.updateMany({
        where: { id: entrada.id, companyId: entrada.companyId },
        data: { status: CONFIRMADA, writtenRows: entrada.filasEscritas, confirmedAt: new Date() },
      });
    });
  }
}

/**
 * El análisis, listo para `jsonb`.
 *
 * El doble paso por `JSON` no es adorno: `Analisis` lleva arreglos de solo
 * lectura y Prisma espera un valor JSON llano, y serializar es la forma de
 * decir «esto es un dato, no un objeto del dominio».
 */
function comoJson(analisis: Analisis): object {
  return JSON.parse(JSON.stringify(analisis)) as object;
}
