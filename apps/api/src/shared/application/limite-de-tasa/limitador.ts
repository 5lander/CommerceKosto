/**
 * El limitador de tasa de los endpoints sin sesion o con correo — D-16.17,
 * D-16.24, D-16.50.
 *
 * `exigir()` SE LLAMA ANTES DE HACER NADA: antes de buscar al usuario, antes
 * de gastar el token, antes de encolar. Un limite que corre despues del trabajo
 * limita la respuesta, no el trabajo.
 *
 * EL GOLPE SE REGISTRA SIEMPRE, no solo al bloquear. Es lo que hace que el
 * umbral sea "diez por hora" de verdad: si solo contaran los rechazos, las
 * diez primeras peticiones no dejarian rastro y la undecima nunca llegaria.
 * Y se registra tambien cuando ya esta bloqueado, para que insistir alargue
 * la espera (la regla cuenta desde el ultimo golpe).
 *
 * CONTAR Y ANOTAR SON UN SOLO ACTO POR EJE (`RegistroDeLimites.golpear`): la
 * primera version leia en una transaccion y escribia en otra, y bajo
 * peticiones simultaneas de la misma clave todas leian el mismo recuento y
 * todas pasaban — justo la inundacion de un buzon y el muestreo del canal de
 * tiempo que `politicas.ts` dice impedir. El registro devuelve los golpes
 * anteriores (los mas recientes, `golpesQueDeciden`) ya con el nuevo anotado
 * bajo bloqueo por clave; la decision se toma sobre los anteriores, como
 * siempre: el decimo pasa, el undecimo no.
 *
 * LAS CLAVES NO GUARDAN CORREOS. `ip:<ip>` es la IP que `ipDelCliente`
 * resolvio; `correo:<sha256 hex del correo normalizado>` es un hash, porque
 * quien pide un restablecimiento para un correo que no existe no es usuario
 * de nadie y su direccion no tiene por que quedarse en ninguna tabla
 * (minimizacion, SEGURIDAD.md §10). El hash basta: la clave solo tiene que
 * ser la misma para el mismo correo.
 *
 * LA IP ES LA QUE `ipDelCliente` RESOLVIO (D-16.49): detras de Caddy toda
 * peticion trae la IP del proxy en el socket, y contar por ella seria contar
 * a todos los usuarios juntos. Sin IP (`null`) no hay eje de IP; el
 * destinatario sigue protegiendo por su lado.
 *
 * AL ABRIR UN BLOQUEO DEJA `system.ratelimit.exceeded` EN `audit_log` — en la
 * TRANSICION, no en cada rechazo (`abreBloqueo`, como el aviso de bloqueo del
 * login): `audit_log` es append-only y no se purga, y auditar cada 429 dejaria
 * que un anonimo bloqueado escribiera miles de filas por hora. Sin company
 * —no la hay— y sin el correo en `detail`: solo el `kind`, que ejes bloquearon
 * y hasta cuando. La IP va en su columna, como en los eventos de acceso.
 */

import { createHash } from 'node:crypto';

import {
  abreBloqueo,
  bloqueoEfectivo,
  evaluarIntentos,
  golpesQueDeciden,
  type DecisionDeAcceso,
  type PoliticaDeIntentos,
} from '../../domain/acceso/politica-de-intentos';
import {
  LimiteDeSolicitudesError,
  POLITICAS_DE_LIMITE,
  VENTANA_DE_LIMITE_MS,
  type EjeDeLimite,
  type KindDeLimite,
} from '../../domain/limite-de-tasa/politicas';
import type { AuditLogPort } from '../ports/audit-log.port';
import type { RegistroDeLimites } from '../ports/registro-de-limites.port';

export interface DependenciasDelLimitador {
  readonly registro: RegistroDeLimites;
  readonly auditoria: AuditLogPort;
}

export interface SolicitudALimitar {
  readonly kind: KindDeLimite;
  /** La IP del cliente, o `null` si no hay socket con direccion. */
  readonly ip: string | null;
  /** El correo al que iria el mensaje. Ausente o `null` cuando no se sabe. */
  readonly destinatario?: string | null;
  readonly ahora: Date;
}

interface EjeAContar {
  readonly eje: EjeDeLimite;
  readonly clave: string;
  readonly politica: PoliticaDeIntentos;
}

interface EjeDecidido extends EjeAContar {
  readonly decision: DecisionDeAcceso;
}

export function claveDeIp(ip: string): string {
  return `ip:${ip}`;
}

export function claveDeCorreo(destinatario: string): string {
  const normalizado = destinatario.trim().toLowerCase();
  return `correo:${createHash('sha256').update(normalizado).digest('hex')}`;
}

function ejesDe(solicitud: SolicitudALimitar): readonly EjeAContar[] {
  const politica = POLITICAS_DE_LIMITE[solicitud.kind];
  const ejes: EjeAContar[] = [];

  if (solicitud.ip !== null) {
    ejes.push({ eje: 'ip', clave: claveDeIp(solicitud.ip), politica: politica.ip });
  }

  const destinatario = solicitud.destinatario ?? null;
  if (destinatario !== null && politica.destinatario !== null) {
    ejes.push({ eje: 'destinatario', clave: claveDeCorreo(destinatario), politica: politica.destinatario });
  }

  return ejes;
}

/** `true` si algun eje bloqueado lo esta por PRIMERA vez en su ronda: es el golpe que se audita. */
function abreAlgunBloqueo(decididos: readonly EjeDecidido[]): boolean {
  return decididos.some((e) => !e.decision.permitido && abreBloqueo(e.decision.fallosRecientes, e.politica));
}

export class LimitadorDeTasa {
  public constructor(private readonly deps: DependenciasDelLimitador) {}

  /** @throws {LimiteDeSolicitudesError} si algun eje esta bloqueado. El golpe ya quedo registrado. */
  public async exigir(solicitud: SolicitudALimitar): Promise<void> {
    const desde = new Date(solicitud.ahora.getTime() - VENTANA_DE_LIMITE_MS);
    const decididos: EjeDecidido[] = [];

    for (const eje of ejesDe(solicitud)) {
      const previos = await this.deps.registro.golpear({
        kind: solicitud.kind,
        clave: eje.clave,
        at: solicitud.ahora,
        desde,
        maximo: golpesQueDeciden(eje.politica),
      });
      const decision = evaluarIntentos({ fallos: previos, ahora: solicitud.ahora, politica: eje.politica });
      decididos.push({ ...eje, decision });
    }

    const bloqueadoHasta = bloqueoEfectivo(decididos.map((e) => e.decision));
    if (bloqueadoHasta === null) {
      return;
    }

    if (abreAlgunBloqueo(decididos)) {
      await this.auditarBloqueo(solicitud, decididos, bloqueadoHasta);
    }
    throw new LimiteDeSolicitudesError({ kind: solicitud.kind, bloqueadoHasta, ahora: solicitud.ahora });
  }

  private async auditarBloqueo(
    solicitud: SolicitudALimitar,
    decididos: readonly EjeDecidido[],
    bloqueadoHasta: Date,
  ): Promise<void> {
    const ejesBloqueados = decididos.filter((e) => !e.decision.permitido).map((e) => e.eje);

    await this.deps.auditoria.record({
      eventType: 'system.ratelimit.exceeded',
      outcome: 'blocked',
      actorType: 'SYSTEM',
      actorId: null,
      companyId: null,
      ip: solicitud.ip,
      userAgent: null,
      // Ni el correo ni su hash: el hash identifica al destinatario tanto como
      // el correo para quien tenga la lista de usuarios delante.
      detail: {
        kind: solicitud.kind,
        ejes: ejesBloqueados.join(','),
        bloqueadoHasta: bloqueadoHasta.toISOString(),
      },
    });
  }
}
