/**
 * El restablecimiento, probado ENTERO con la base apagada.
 *
 * Lo que mas se prueba no es el camino feliz: es que SOLICITAR haga el mismo
 * trabajo exista o no el correo —la definer decide, no el caso de uso—, y que
 * RESTABLECER gaste el token antes de mirar la contrasena, revoque todas las
 * sesiones y no distinga un token inexistente de uno usado o caducado.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  datosParaGuardar,
  type CorreoAEncolar,
} from '../../../../shared/application/correo/correo-a-encolar';
import { LimitadorDeTasa } from '../../../../shared/application/limite-de-tasa/limitador';
import type { AuditEvent, AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type {
  GolpeALimitar,
  RegistroDeLimites,
} from '../../../../shared/application/ports/registro-de-limites.port';
import type { KindDeLimite, LimiteDeSolicitudesError } from '../../../../shared/domain/limite-de-tasa/politicas';
import { companyId, userId } from '../../../../shared/domain/identity/identificadores';
import { ContrasenaDebilError, TokenDeRestablecimientoInvalidoError } from '../../domain/errores';
import type { Enlaces } from '../ports/enlaces.port';
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type {
  ContextoDeSesion,
  CredencialDeLogin,
  FallosRecientes,
  NuevaSesion,
  RepositorioDeAutenticacion,
  UsuarioRestablecido,
} from '../ports/repositorio-de-autenticacion.port';
import {
  RestablecerContrasena,
  SolicitarRestablecimiento,
  type DependenciasDeRestablecimiento,
} from './restablecer-contrasena';

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const HORA_MS = 3_600_000;
const COMPANY = companyId('018f2b8c-1111-7000-8000-000000000001');
const USUARIO = userId('018f2b8c-2222-7000-8000-000000000002');
const CORREO = 'ana@snacklab.ec';
const CONTRASENA_BUENA = 'pimientos del piquillo asados';
const SESIONES_ABIERTAS = 3;
const IP = '203.0.113.7';

/** Un registro en memoria: lo que hace falta para ver que el limite corre ANTES que el trabajo. */
class RegistroEnMemoria implements RegistroDeLimites {
  public readonly golpes: { readonly kind: KindDeLimite; readonly clave: string; readonly at: Date }[] = [];

  public golpear(golpe: GolpeALimitar): Promise<readonly Date[]> {
    const previos = this.golpes
      .filter((g) => g.kind === golpe.kind && g.clave === golpe.clave && g.at >= golpe.desde)
      .map((g) => g.at)
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, golpe.maximo);
    this.golpes.push({ kind: golpe.kind, clave: golpe.clave, at: golpe.at });
    return Promise.resolve(previos);
  }
}

interface Solicitud {
  readonly email: string;
  readonly tokenHash: string;
  readonly expiraEn: Date;
  readonly enlace: string;
}

class RepositorioDoble implements RepositorioDeAutenticacion {
  public readonly solicitudes: Solicitud[] = [];
  public consumido: UsuarioRestablecido | null = { userId: USUARIO, companyId: COMPANY };
  public correo: string | null = CORREO;
  public readonly hashes: string[] = [];
  public revocaciones = 0;

  public buscarCredencial(): Promise<CredencialDeLogin | null> {
    return Promise.resolve(null);
  }
  public solicitarRestablecimiento(entrada: {
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<void> {
    this.solicitudes.push({
      email: entrada.email,
      tokenHash: entrada.tokenHash,
      expiraEn: entrada.expiraEn,
      enlace: datosParaGuardar(entrada.correo)['enlace'] ?? '',
    });
    return Promise.resolve();
  }
  public consumirRestablecimiento(): Promise<UsuarioRestablecido | null> {
    return Promise.resolve(this.consumido);
  }
  public correoDelUsuario(): Promise<string | null> {
    return Promise.resolve(this.correo);
  }
  public encolarCorreo(): Promise<void> {
    return Promise.resolve();
  }
  public fallosRecientes(): Promise<FallosRecientes> {
    return Promise.resolve({ porCuenta: [], porIp: [] });
  }
  public registrarIntento(): Promise<void> {
    return Promise.resolve();
  }
  public olvidarFallos(): Promise<void> {
    return Promise.resolve();
  }
  public abrirSesion(nueva: NuevaSesion): Promise<never> {
    void nueva;
    return Promise.reject(new Error('no aplica'));
  }
  public contextoDeSesion(): Promise<ContextoDeSesion | null> {
    return Promise.resolve(null);
  }
  public marcarVista(): Promise<void> {
    return Promise.resolve();
  }
  public revocarSesion(): Promise<void> {
    return Promise.resolve();
  }
  public revocarSesionesDe(): Promise<number> {
    this.revocaciones += 1;
    return Promise.resolve(SESIONES_ABIERTAS);
  }
  public guardarHashDeContrasena(entrada: { readonly hash: string }): Promise<void> {
    this.hashes.push(entrada.hash);
    return Promise.resolve();
  }
}

describe('restablecimiento de contrasena', () => {
  let repositorio: RepositorioDoble;
  let registro: RegistroEnMemoria;
  let eventos: AuditEvent[];
  let deps: DependenciasDeRestablecimiento;

  beforeEach(() => {
    repositorio = new RepositorioDoble();
    registro = new RegistroEnMemoria();
    eventos = [];

    const auditoria: AuditLogPort = {
      record: async (evento) => {
        eventos.push(evento);
        return Promise.resolve();
      },
    };
    const hasher: HasherDeContrasenas = {
      hash: async (texto) => Promise.resolve(`hash(${texto})`),
      verificar: async () => Promise.resolve(false),
      necesitaRehash: () => false,
    };
    const tokens: GeneradorDeTokens = {
      generar: () => ({ token: 'token-en-claro', hash: 'hash-del-token' }),
      hashDe: (token) => `hash-de(${token})`,
    };
    const enlaces: Enlaces = {
      deActivacion: (token) => `http://app/activacion?token=${token}`,
      deRestablecimiento: (token) => `http://app/restablecer?token=${token}`,
    };

    deps = {
      repositorio,
      tokens,
      hasher,
      auditoria,
      enlaces,
      reloj: { ahora: () => AHORA },
      limitador: new LimitadorDeTasa({ registro, auditoria }),
      horasDeRestablecimiento: 2,
    };
  });

  describe('SolicitarRestablecimiento', () => {
    it('genera el token, calcula la caducidad con las horas configuradas y manda el ENLACE, no el token', async () => {
      await new SolicitarRestablecimiento(deps).ejecutar({ email: '  Ana@Snacklab.EC ', ip: IP });

      expect(repositorio.solicitudes).toHaveLength(1);
      const [solicitud] = repositorio.solicitudes;
      expect(solicitud?.email).toBe(CORREO);
      expect(solicitud?.tokenHash).toBe('hash-del-token');
      expect(solicitud?.expiraEn.getTime()).toBe(AHORA.getTime() + 2 * HORA_MS);
      expect(solicitud?.enlace).toBe('http://app/restablecer?token=token-en-claro');
    });

    it('hace EL MISMO trabajo aunque el repositorio no encuentre a nadie: no hay canal de tiempo', async () => {
      // El caso de uso no sabe si el correo existe; la definer decide. Aqui
      // solo se comprueba que no hay ninguna rama que ahorre trabajo.
      await new SolicitarRestablecimiento(deps).ejecutar({ email: 'nadie@snacklab.ec', ip: IP });
      expect(repositorio.solicitudes).toHaveLength(1);
    });

    it('audita sin company, sin actor y sin el correo, pero CON la IP', async () => {
      await new SolicitarRestablecimiento(deps).ejecutar({ email: CORREO, ip: IP });

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        eventType: 'auth.password.reset_requested',
        actorType: 'ANONYMOUS',
        actorId: null,
        companyId: null,
        ip: IP,
      });
      expect(JSON.stringify(eventos[0]?.detail)).not.toContain(CORREO);
    });

    it('el limite corre ANTES de generar nada: al cuarto por destinatario no hay token ni solicitud', async () => {
      for (let i = 0; i < 3; i += 1) {
        await new SolicitarRestablecimiento(deps).ejecutar({ email: CORREO, ip: `10.0.0.${String(i)}` });
      }

      const cuarto = new SolicitarRestablecimiento(deps).ejecutar({ email: CORREO, ip: '10.0.0.9' });

      await expect(cuarto).rejects.toMatchObject({ codigo: 'LIMITE_DE_SOLICITUDES' });
      expect(repositorio.solicitudes).toHaveLength(3);
      // El golpe bloqueado tambien quedo registrado, y el bloqueo se audito.
      expect(registro.golpes.filter((g) => g.clave.startsWith('correo:'))).toHaveLength(4);
      expect(eventos.map((e) => e.eventType)).toContain('system.ratelimit.exceeded');
    });

    it('sin IP, el destinatario sigue protegiendo por su lado', async () => {
      await new SolicitarRestablecimiento(deps).ejecutar({ email: CORREO, ip: null });

      expect(registro.golpes.map((g) => g.clave.split(':')[0])).toEqual(['correo']);
    });
  });

  describe('RestablecerContrasena', () => {
    it('gasta el token, guarda el hash, revoca TODAS las sesiones y audita bajo la company', async () => {
      const revocadas = await new RestablecerContrasena(deps).ejecutar({
        token: 'el-token',
        contrasena: CONTRASENA_BUENA,
        ip: IP,
      });

      expect(revocadas).toBe(SESIONES_ABIERTAS);
      expect(repositorio.hashes).toEqual([`hash(${CONTRASENA_BUENA})`]);
      expect(repositorio.revocaciones).toBe(1);
      expect(eventos[0]).toMatchObject({
        eventType: 'auth.password.reset_completed',
        actorId: USUARIO,
        companyId: COMPANY,
        detail: { sesionesRevocadas: SESIONES_ABIERTAS },
        ip: IP,
      });
    });

    it('el limite por IP corre ANTES de gastar el token: al undecimo no se toca la base', async () => {
      for (let i = 0; i < 10; i += 1) {
        repositorio.consumido = null;
        const error: unknown = await new RestablecerContrasena(deps)
          .ejecutar({ token: 'malo', contrasena: CONTRASENA_BUENA, ip: IP })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(TokenDeRestablecimientoInvalidoError);
      }
      repositorio.consumido = { userId: USUARIO, companyId: COMPANY };

      const undecimo: Promise<number> = new RestablecerContrasena(deps).ejecutar({
        token: 'el-token',
        contrasena: CONTRASENA_BUENA,
        ip: IP,
      });

      const error = await undecimo.catch((e: unknown) => e as LimiteDeSolicitudesError);
      expect(error).toMatchObject({ codigo: 'LIMITE_DE_SOLICITUDES' });
      expect(repositorio.hashes).toEqual([]);
    });

    it('un token que la base no reconoce —inexistente, usado o caducado— es el MISMO error', async () => {
      repositorio.consumido = null;

      await expect(
        new RestablecerContrasena(deps).ejecutar({ token: 'cualquiera', contrasena: CONTRASENA_BUENA, ip: IP }),
      ).rejects.toBeInstanceOf(TokenDeRestablecimientoInvalidoError);
      expect(repositorio.hashes).toEqual([]);
      expect(eventos).toEqual([]);
    });

    it('un token vacio se rechaza sin tocar la base', async () => {
      await expect(
        new RestablecerContrasena(deps).ejecutar({ token: '   ', contrasena: CONTRASENA_BUENA, ip: IP }),
      ).rejects.toBeInstanceOf(TokenDeRestablecimientoInvalidoError);
    });

    it('una contrasena que contiene el correo se rechaza con la politica, y no se guarda nada', async () => {
      // Es la razon por la que el caso de uso lee el correo bajo tenant despues
      // de gastar el token: la definer no lo devuelve, y sin el esta regla no
      // se podria comprobar.
      repositorio.correo = 'anabel@snacklab.ec';

      await expect(
        new RestablecerContrasena(deps).ejecutar({ token: 'el-token', contrasena: 'anabel y sus cebollas', ip: IP }),
      ).rejects.toBeInstanceOf(ContrasenaDebilError);
      expect(repositorio.hashes).toEqual([]);
      expect(repositorio.revocaciones).toBe(0);
    });

    it('si el tenant no ve al usuario que la definer devolvio, se cierra en vez de restablecer a ciegas', async () => {
      repositorio.correo = null;

      await expect(
        new RestablecerContrasena(deps).ejecutar({ token: 'el-token', contrasena: CONTRASENA_BUENA, ip: IP }),
      ).rejects.toBeInstanceOf(TokenDeRestablecimientoInvalidoError);
    });
  });
});
