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

import {
  importJobId as aImportJobId,
  type CompanyId,
  type ImportJobId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  ImportacionParaAnular,
  RepositorioDeImportaciones,
} from '../application/ports/repositorio-de-importaciones.port';
import type { Analisis, TipoDeImportacion } from '../domain/analisis';

const SUBIDA = 'SUBIDA';
const ANALIZADA = 'ANALIZADA';
const CONFIRMADA = 'CONFIRMADA';
const ANULADA = 'ANULADA';

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
  }): Promise<ImportJobId> {
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

      return aImportJobId(fila.id);
    });
  }

  public async guardarAnalisis(entrada: {
    readonly companyId: CompanyId;
    readonly id: ImportJobId;
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
    readonly id: ImportJobId;
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

  public async buscarParaAnular(entrada: {
    readonly companyId: CompanyId;
    readonly id: ImportJobId;
  }): Promise<ImportacionParaAnular | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.importJob.findFirst({
        where: { id: entrada.id, companyId: entrada.companyId },
        select: { id: true, kind: true, status: true },
      });

      if (fila === null) return null;
      return {
        id: aImportJobId(fila.id),
        tipo: fila.kind as TipoDeImportacion,
        estado: fila.status,
      };
    });
  }

  public async marcarAnulada(entrada: {
    readonly companyId: CompanyId;
    readonly id: ImportJobId;
    readonly userId: UserId;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      // Los dos campos a la vez, que es lo que exige el `CHECK`
      // `import_job_anulada_es_coherente`: anulada si y solo si hay fecha, y el
      // autor va con la fecha.
      //
      // `status: CONFIRMADA` en el `WHERE` no es adorno: si dos operadores
      // pulsan a la vez, el segundo `UPDATE` no encuentra fila y no hay dos
      // autores para la misma anulación. Lo que ya no puede pasar por aquí es
      // una segunda tanda de filas contrarias — de eso se encarga el libro,
      // saltándose lo ya corregido.
      await tx.importJob.updateMany({
        where: { id: entrada.id, companyId: entrada.companyId, status: CONFIRMADA },
        data: { status: ANULADA, voidedAt: new Date(), voidedBy: entrada.userId },
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
