/**
 * El adaptador del back office sobre la conexión privilegiada.
 *
 * **EL REGISTRO DE ACCESO SE ESCRIBE ANTES DE LEER, Y EN LA MISMA TRANSACCIÓN.**
 * Ese orden es la pieza entera del módulo: si el `INSERT` falla —motivo corto,
 * operador borrado, tabla llena— la lectura se revierte y quien preguntó no ve
 * nada. Escribir después dejaría una ventana en la que los datos ya salieron y
 * el rastro todavía no existe, y esa ventana es justo el hueco por el que se
 * cuela un acceso sin registrar.
 *
 * **NO HAY MÉTODO DE BORRADO NI DE ACTUALIZACIÓN DEL LOG.** Ni aquí ni en el
 * puerto ni en los privilegios del rol: son las tres mitades de la misma
 * decisión, y la de la base es la que aguanta si las otras dos fallan.
 *
 * **LAS CONSULTAS SON EXPLÍCITAS Y SIN `SELECT *`.** El rol lo ve todo, así que
 * la única forma de no traerse de más es pedir exactamente lo que se necesita.
 */

import { Injectable } from '@nestjs/common';

import type { CompanyId } from '../../../shared/domain/identity/identificadores';
import type {
  Acceso,
  AccesoRegistrado,
  CompanyDetallada,
  CompanyEnLista,
  CredencialDeOperador,
  DatosDeNuevaCompany,
  LineaDeAuditoria,
  OperatorId,
  PlanLeido,
  RepositorioDeBackoffice,
  SesionDeOperador,
} from '../application/ports/repositorio-de-backoffice.port';
import { BackofficeConnection, type ClienteDeBackoffice } from './backoffice-connection';

const ESTADO_ACTIVO = 'ACTIVE';

/** El rol con el que nace el dueño de una company nueva. */
const ROL_DEL_DUENO = 'OWNER';

type Accion =
  | 'company.list'
  | 'company.read'
  | 'company.create'
  | 'company.plan.changed'
  | 'company.status.changed'
  | 'audit.read';

@Injectable()
export class PrismaBackofficeRepositorio implements RepositorioDeBackoffice {
  public constructor(private readonly conexion: BackofficeConnection) {}

  public async buscarCredencial(email: string): Promise<CredencialDeOperador | null> {
    return this.conexion.run(async (tx) => {
      const fila = await tx.backofficeUser.findUnique({
        where: { email },
        select: { id: true, passwordHash: true, status: true },
      });

      return fila === null
        ? null
        : {
            operatorId: fila.id as OperatorId,
            passwordHash: fila.passwordHash,
            status: fila.status,
          };
    });
  }

  public async abrirSesion(entrada: {
    readonly operatorId: OperatorId;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly ip: string | null;
    readonly userAgent: string | null;
  }): Promise<void> {
    await this.conexion.run(async (tx) => {
      await tx.backofficeSession.create({
        data: {
          userId: entrada.operatorId,
          tokenHash: entrada.tokenHash,
          expiresAt: entrada.expiraEn,
          ip: entrada.ip,
          userAgent: entrada.userAgent,
        },
      });
    });
  }

  public async sesionPorToken(tokenHash: string): Promise<SesionDeOperador | null> {
    return this.conexion.run(async (tx) => {
      const fila = await tx.backofficeSession.findUnique({
        where: { tokenHash },
        select: {
          userId: true,
          expiresAt: true,
          revokedAt: true,
          usuario: { select: { email: true, status: true } },
        },
      });

      return fila === null
        ? null
        : {
            operatorId: fila.userId as OperatorId,
            email: fila.usuario.email,
            expiraEn: fila.expiresAt,
            revocadaEn: fila.revokedAt,
            estado: fila.usuario.status,
          };
    });
  }

  public async revocarSesion(tokenHash: string): Promise<void> {
    await this.conexion.run(async (tx) => {
      // `updateMany` y no `update`: revocar una sesión que ya no existe no es un
      // error, es cerrar sesión dos veces.
      await tx.backofficeSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  public async listarPlanes(): Promise<readonly PlanLeido[]> {
    return this.conexion.run(async (tx) => {
      const filas = await tx.plan.findMany({
        select: { code: true, name: true, maxLocations: true, maxItems: true, maxProducts: true },
        orderBy: { maxLocations: 'asc' },
      });
      return filas;
    });
  }

  public async listarCompanies(acceso: Acceso): Promise<readonly CompanyEnLista[]> {
    return this.conexion.run(async (tx) => {
      await registrar(tx, { acceso, accion: 'company.list', companyId: null });

      const filas = await tx.company.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          planCode: true,
          createdAt: true,
          _count: { select: { locations: true } },
        },
        orderBy: { name: 'asc' },
      });

      return filas.map((fila) => ({
        id: fila.id as CompanyId,
        nombre: fila.name,
        estado: fila.status,
        plan: fila.planCode,
        creadaEn: fila.createdAt,
        ubicaciones: fila._count.locations,
      }));
    });
  }

  public async leerCompany(entrada: {
    readonly companyId: CompanyId;
    readonly acceso: Acceso;
  }): Promise<CompanyDetallada | null> {
    return this.conexion.run(async (tx) => {
      // PRIMERO EL RASTRO. Si esto falla, no se lee nada.
      await registrar(tx, {
        acceso: entrada.acceso,
        accion: 'company.read',
        companyId: entrada.companyId,
      });

      const fila = await tx.company.findUnique({
        where: { id: entrada.companyId },
        select: {
          id: true,
          name: true,
          status: true,
          planCode: true,
          createdAt: true,
          plan: {
            select: {
              code: true,
              name: true,
              maxLocations: true,
              maxItems: true,
              maxProducts: true,
            },
          },
          _count: { select: { locations: true, items: true, productos: true, usuarios: true } },
        },
      });

      return fila === null ? null : comoFicha(fila);
    });
  }

  public async crearCompany(entrada: {
    readonly datos: DatosDeNuevaCompany;
    readonly acceso: Acceso;
  }): Promise<CompanyId> {
    return this.conexion.run(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: entrada.datos.nombre,
          status: ESTADO_ACTIVO,
          planCode: entrada.datos.plan,
        },
        select: { id: true },
      });

      // El dueño nace INVITED y sin contraseña: la pone él con su invitación
      // (P1). El back office NUNCA fija la contraseña de un cliente — quien
      // puede fijarla puede entrar como él.
      const usuario = await tx.appUser.create({
        data: {
          companyId: company.id,
          email: entrada.datos.emailDelDueno,
          status: 'INVITED',
        },
        select: { id: true },
      });

      await tx.userRole.create({
        data: {
          companyId: company.id,
          userId: usuario.id,
          roleCode: ROL_DEL_DUENO,
          locationId: null,
          hasLocation: false,
        },
      });

      await registrar(tx, {
        acceso: entrada.acceso,
        accion: 'company.create',
        companyId: company.id as CompanyId,
      });

      return company.id as CompanyId;
    });
  }

  public async cambiarPlan(entrada: {
    readonly companyId: CompanyId;
    readonly plan: string;
    readonly acceso: Acceso;
  }): Promise<
    | { readonly clase: 'cambiado' }
    | {
        readonly clase: 'no_cabe';
        readonly recurso: string;
        readonly tiene: number;
        readonly maximo: number;
      }
  > {
    return this.conexion.run(async (tx) => {
      const destino = await tx.plan.findUnique({
        where: { code: entrada.plan },
        select: { maxLocations: true, maxItems: true, maxProducts: true },
      });
      if (destino === null) return { clase: 'no_cabe', recurso: 'plan', tiene: 0, maximo: 0 };

      const actual = await tx.company.findUnique({
        where: { id: entrada.companyId },
        select: { _count: { select: { locations: true, items: true, productos: true } } },
      });
      if (actual === null) return { clase: 'no_cabe', recurso: 'company', tiene: 0, maximo: 0 };

      const estrecho = primerRecursoQueNoCabe(actual._count, destino);
      if (estrecho !== null) return { clase: 'no_cabe', ...estrecho };

      await tx.company.update({
        where: { id: entrada.companyId },
        data: { planCode: entrada.plan },
      });

      await registrar(tx, {
        acceso: entrada.acceso,
        accion: 'company.plan.changed',
        companyId: entrada.companyId,
      });

      return { clase: 'cambiado' };
    });
  }

  public async cambiarEstado(entrada: {
    readonly companyId: CompanyId;
    readonly estado: string;
    readonly acceso: Acceso;
  }): Promise<boolean> {
    return this.conexion.run(async (tx) => {
      const cambiadas = await tx.company.updateMany({
        where: { id: entrada.companyId },
        data: { status: entrada.estado },
      });
      if (cambiadas.count === 0) return false;

      await registrar(tx, {
        acceso: entrada.acceso,
        accion: 'company.status.changed',
        companyId: entrada.companyId,
      });

      return true;
    });
  }

  public async leerAuditoria(entrada: {
    readonly companyId: CompanyId | null;
    readonly limite: number;
    readonly acceso: Acceso;
  }): Promise<readonly LineaDeAuditoria[]> {
    return this.conexion.run(async (tx) => {
      await registrar(tx, {
        acceso: entrada.acceso,
        accion: 'audit.read',
        companyId: entrada.companyId,
      });

      const filas = await tx.auditLog.findMany({
        where: entrada.companyId === null ? {} : { companyId: entrada.companyId },
        select: {
          at: true,
          eventType: true,
          outcome: true,
          actorType: true,
          actorId: true,
          companyId: true,
          ip: true,
          correlationId: true,
        },
        orderBy: { at: 'desc' },
        take: entrada.limite,
      });

      return filas;
    });
  }

  public async accesosRecientes(limite: number): Promise<readonly AccesoRegistrado[]> {
    return this.conexion.run(async (tx) => {
      const filas = await tx.backofficeAccessLog.findMany({
        select: {
          at: true,
          companyId: true,
          action: true,
          reason: true,
          ip: true,
          operador: { select: { email: true } },
        },
        orderBy: { at: 'desc' },
        take: limite,
      });

      return filas.map((fila) => ({
        at: fila.at,
        operador: fila.operador.email,
        companyId: fila.companyId,
        accion: fila.action,
        motivo: fila.reason,
        ip: fila.ip,
      }));
    });
  }
}

/**
 * El registro de acceso. **Una sola función, para que no haya dos formas.**
 *
 * Es `private` de este módulo a propósito: si estuviera en el puerto, alguien
 * podría llamarla sin la lectura al lado, y el par «leo y dejo rastro» dejaría
 * de ser indivisible.
 */
async function registrar(
  tx: ClienteDeBackoffice,
  datos: {
    readonly acceso: Acceso;
    readonly accion: Accion;
    readonly companyId: CompanyId | null;
  },
): Promise<void> {
  await tx.backofficeAccessLog.create({
    data: {
      operatorId: datos.acceso.operatorId,
      companyId: datos.companyId,
      action: datos.accion,
      reason: datos.acceso.motivo,
      ip: datos.acceso.ip,
    },
  });
}

interface FilaDeCompany {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly planCode: string;
  readonly createdAt: Date;
  readonly plan: PlanLeido;
  readonly _count: {
    readonly locations: number;
    readonly items: number;
    readonly productos: number;
    readonly usuarios: number;
  };
}

/** El mapeo, aparte: la consulta ya era larga y las dos cosas se leen mejor solas. */
function comoFicha(fila: FilaDeCompany): CompanyDetallada {
  return {
    id: fila.id as CompanyId,
    nombre: fila.name,
    estado: fila.status,
    plan: fila.planCode,
    creadaEn: fila.createdAt,
    ubicaciones: fila._count.locations,
    items: fila._count.items,
    productos: fila._count.productos,
    usuarios: fila._count.usuarios,
    limites: fila.plan,
  };
}

interface Recuentos {
  readonly locations: number;
  readonly items: number;
  readonly productos: number;
}

interface Limites {
  readonly maxLocations: number;
  readonly maxItems: number;
  readonly maxProducts: number;
}

/**
 * El primer recurso que no cabría en el plan destino, o `null` si caben los tres.
 *
 * Devuelve el PRIMERO y no todos porque el operador solo necesita saber que no
 * puede y por qué; enumerar los tres no cambia lo que va a hacer.
 */
function primerRecursoQueNoCabe(
  tiene: Recuentos,
  destino: Limites,
): { readonly recurso: string; readonly tiene: number; readonly maximo: number } | null {
  const comparaciones = [
    { recurso: 'ubicaciones', tiene: tiene.locations, maximo: destino.maxLocations },
    { recurso: 'ítems', tiene: tiene.items, maximo: destino.maxItems },
    { recurso: 'productos', tiene: tiene.productos, maximo: destino.maxProducts },
  ];

  return comparaciones.find((c) => c.tiene > c.maximo) ?? null;
}
