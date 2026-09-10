/**
 * El limitador de tasa, probado ENTERO con la base apagada: un registro en
 * memoria y un reloj que entra por parametro. Lo que mas importa aqui no es
 * que bloquee, sino QUE cuenta (todo golpe, no solo los rechazos), CON QUE
 * clave (la IP resuelta y un hash del correo, nunca el correo) y QUE deja en
 * la auditoria (el kind y los ejes, nunca el destinatario).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { LimiteDeSolicitudesError, type KindDeLimite } from '../../domain/limite-de-tasa/politicas';
import type { AuditEvent, AuditLogPort } from '../ports/audit-log.port';
import type { GolpeALimitar, RegistroDeLimites } from '../ports/registro-de-limites.port';
import { LimitadorDeTasa, claveDeCorreo, claveDeIp } from './limitador';

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const MINUTO = 60_000;
const IP = '203.0.113.7';
const CORREO = 'Ana@Snacklab.EC';
const CORREO_NORMALIZADO = 'ana@snacklab.ec';
/** `golpesQueDeciden`: umbral × escalones + 1, con un solo escalon. */
const TOPE_POR_IP = 10 + 1;
const TOPE_POR_DESTINATARIO = 3 + 1;

interface Golpe {
  readonly kind: KindDeLimite;
  readonly clave: string;
  readonly at: Date;
}

/** Hace lo que el puerto promete: anota y devuelve los anteriores, los mas recientes primero, como mucho `maximo`. */
class RegistroEnMemoria implements RegistroDeLimites {
  public readonly golpes: Golpe[] = [];
  public readonly maximosPedidos: number[] = [];

  public golpear(golpe: GolpeALimitar): Promise<readonly Date[]> {
    this.maximosPedidos.push(golpe.maximo);
    const previos = this.golpes
      .filter((g) => g.kind === golpe.kind && g.clave === golpe.clave && g.at >= golpe.desde)
      .map((g) => g.at)
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, golpe.maximo);
    this.golpes.push({ kind: golpe.kind, clave: golpe.clave, at: golpe.at });
    return Promise.resolve(previos);
  }
}

describe('LimitadorDeTasa', () => {
  let registro: RegistroEnMemoria;
  let eventos: AuditEvent[];
  let limitador: LimitadorDeTasa;

  beforeEach(() => {
    registro = new RegistroEnMemoria();
    eventos = [];
    const auditoria: AuditLogPort = {
      record: async (evento) => {
        eventos.push(evento);
        return Promise.resolve();
      },
    };
    limitador = new LimitadorDeTasa({ registro, auditoria });
  });

  async function golpear(veces: number, extra: { readonly ip?: string | null; readonly destinatario?: string } = {}) {
    for (let i = 0; i < veces; i += 1) {
      await limitador.exigir({
        kind: 'password.olvido',
        ip: extra.ip === undefined ? IP : extra.ip,
        ahora: new Date(AHORA.getTime() + i),
        ...(extra.destinatario === undefined ? {} : { destinatario: extra.destinatario }),
      });
    }
  }

  describe('las claves', () => {
    it('la IP va tal cual, con su prefijo', () => {
      expect(claveDeIp('10.0.0.1')).toBe('ip:10.0.0.1');
    });

    it('el correo va hasheado y normalizado: mayusculas y espacios dan la misma clave', () => {
      const clave = claveDeCorreo(`  ${CORREO} `);

      expect(clave).toBe(claveDeCorreo(CORREO_NORMALIZADO));
      expect(clave).toMatch(/^correo:[0-9a-f]{64}$/u);
      expect(clave).not.toContain('ana');
      expect(clave).not.toContain('@');
    });
  });

  describe('el golpe se registra SIEMPRE', () => {
    it('una peticion permitida deja su golpe en cada eje presente', async () => {
      await limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA });

      expect(registro.golpes).toEqual([
        { kind: 'password.olvido', clave: claveDeIp(IP), at: AHORA },
        { kind: 'password.olvido', clave: claveDeCorreo(CORREO), at: AHORA },
      ]);
    });

    it('sin IP solo cuenta el destinatario, y sin destinatario solo la IP', async () => {
      await limitador.exigir({ kind: 'password.olvido', ip: null, destinatario: CORREO, ahora: AHORA });
      await limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: AHORA });

      expect(registro.golpes.map((g) => g.clave)).toEqual([claveDeCorreo(CORREO), claveDeIp(IP)]);
    });

    it('un kind sin eje de destinatario ignora el destinatario aunque venga', async () => {
      await limitador.exigir({ kind: 'password.restablecimiento', ip: IP, destinatario: CORREO, ahora: AHORA });

      expect(registro.golpes.map((g) => g.clave)).toEqual([claveDeIp(IP)]);
    });

    it('y tambien se registra el golpe que sale bloqueado: insistir alarga la espera', async () => {
      await golpear(10);

      await expect(golpear(1)).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
      expect(registro.golpes).toHaveLength(11);
    });
  });

  describe('el umbral', () => {
    it('el decimo por IP pasa y el undecimo no (password.olvido: 10/h)', async () => {
      await golpear(10);

      const undecimo = limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: AHORA });

      await expect(undecimo).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
    });

    it('el tercer correo pasa y el cuarto no (destinatario: 3/h), aunque la IP tenga margen', async () => {
      await golpear(3, { destinatario: CORREO });

      const cuarto = limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA });

      await expect(cuarto).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
    });

    it('otro correo desde la misma IP sigue pasando: los ejes son independientes', async () => {
      await golpear(3, { destinatario: CORREO });

      await expect(
        limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: 'otro@snacklab.ec', ahora: AHORA }),
      ).resolves.toBeUndefined();
    });

    it('el mismo correo desde otra IP NO pasa: el destinatario cuenta por si solo', async () => {
      await golpear(3, { destinatario: CORREO });

      await expect(
        limitador.exigir({ kind: 'password.olvido', ip: '198.51.100.9', destinatario: CORREO, ahora: AHORA }),
      ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
    });

    it('los golpes de otro kind no cuentan', async () => {
      for (let i = 0; i < 10; i += 1) {
        await limitador.exigir({ kind: 'usuario.invitar', ip: IP, ahora: AHORA });
      }

      await expect(limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: AHORA })).resolves.toBeUndefined();
    });

    it('una hora despues del ultimo golpe vuelve a pasar', async () => {
      await golpear(10);

      const masTarde = new Date(AHORA.getTime() + 61 * MINUTO);

      await expect(limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: masTarde })).resolves.toBeUndefined();
    });
  });

  describe('el error y la auditoria', () => {
    it('el error trae los segundos que faltan y el mensaje dice el minuto', async () => {
      await golpear(10);

      const error = await limitador
        .exigir({ kind: 'password.olvido', ip: IP, ahora: new Date(AHORA.getTime() + 30 * MINUTO) })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LimiteDeSolicitudesError);
      if (!(error instanceof LimiteDeSolicitudesError)) {
        return;
      }
      // El ultimo golpe fue en AHORA + 9 ms; el bloqueo dura 60 min desde ahi.
      expect(error.reintentarEnSegundos).toBe(30 * 60 + 1);
      expect(error.message).toContain('31 minutos');
    });

    it('al bloquear deja system.ratelimit.exceeded sin company, con la IP, y SIN el correo ni su hash', async () => {
      await golpear(3, { destinatario: CORREO });
      await expect(
        limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA }),
      ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        eventType: 'system.ratelimit.exceeded',
        outcome: 'blocked',
        actorType: 'SYSTEM',
        actorId: null,
        companyId: null,
        ip: IP,
        detail: { kind: 'password.olvido', ejes: 'destinatario' },
      });
      const serializado = JSON.stringify(eventos[0]?.detail);
      expect(serializado).not.toContain(CORREO_NORMALIZADO);
      expect(serializado).not.toContain(claveDeCorreo(CORREO));
    });

    it('una peticion permitida no audita nada', async () => {
      await golpear(2, { destinatario: CORREO });

      expect(eventos).toEqual([]);
    });

    it('audita la TRANSICION, no cada rechazo: tras el undecimo, insistir deja golpes pero no eventos', async () => {
      await golpear(10);

      for (let i = 0; i < 5; i += 1) {
        await expect(
          limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: new Date(AHORA.getTime() + MINUTO + i) }),
        ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
      }

      expect(eventos).toHaveLength(1);
      expect(registro.golpes).toHaveLength(15);
    });

    it('con el destinatario bloqueado y la IP con margen, el evento nombra solo el eje que bloquea', async () => {
      await golpear(3, { destinatario: CORREO });
      await expect(
        limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA }),
      ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
      await expect(
        limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA }),
      ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);

      expect(eventos.map((e) => e.detail['ejes'])).toEqual(['destinatario']);
    });
  });

  describe('lo que pide al registro', () => {
    it('acota la lectura a lo que decide: umbral × escalones + 1 por eje, no toda la hora', async () => {
      await limitador.exigir({ kind: 'password.olvido', ip: IP, destinatario: CORREO, ahora: AHORA });

      expect(registro.maximosPedidos).toEqual([TOPE_POR_IP, TOPE_POR_DESTINATARIO]);
    });

    it('con la lectura acotada, el bloqueo sigue contando desde el ULTIMO golpe aunque haya cientos', async () => {
      await golpear(10);
      for (let i = 0; i < 200; i += 1) {
        await expect(
          limitador.exigir({ kind: 'password.olvido', ip: IP, ahora: new Date(AHORA.getTime() + i * MINUTO) }),
        ).rejects.toBeInstanceOf(LimiteDeSolicitudesError);
      }

      const error = await limitador
        .exigir({ kind: 'password.olvido', ip: IP, ahora: new Date(AHORA.getTime() + 200 * MINUTO) })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LimiteDeSolicitudesError);
      if (error instanceof LimiteDeSolicitudesError) {
        // El ultimo golpe fue en +199 min; una hora desde ahi son 59 min de espera.
        expect(error.reintentarEnSegundos).toBe(59 * 60);
      }
    });
  });
});
