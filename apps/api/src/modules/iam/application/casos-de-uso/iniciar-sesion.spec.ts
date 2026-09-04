/**
 * El login, probado ENTERO con la base apagada.
 *
 * Es el criterio arquitectonico de CLAUDE.md §2 aplicado fuera del motor de
 * costeo: si para probar el orden en que se comprueban el bloqueo, la
 * contrasena y el estado de la cuenta hiciera falta PostgreSQL, las capas
 * estarian mal. Aqui entran seis dobles en memoria y salen decisiones.
 *
 * LO QUE MAS SE PRUEBA NO ES EL CAMINO FELIZ: es que los cuatro motivos de
 * rechazo sean INDISTINGUIBLES desde fuera y que el trabajo de hasheo se haga
 * igual en todos. Esas dos propiedades son las que cierran la enumeracion de
 * usuarios, y son exactamente las que un refactor bienintencionado rompe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEvent, AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { MailerPort, OutgoingMail } from '../../../../shared/application/ports/mailer.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import {
  companyId,
  sessionId,
  userId,
  type SessionId,
} from '../../../../shared/domain/identity/identificadores';
import { AccesoBloqueadoError, CredencialesInvalidasError } from '../../domain/errores';
import type { GeneradorDeTokens, TokenDeSesion } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type {
  ContextoDeSesion,
  CredencialDeLogin,
  FallosRecientes,
  NuevaSesion,
  RepositorioDeAutenticacion,
} from '../ports/repositorio-de-autenticacion.port';
import { IniciarSesion, type DependenciasDeIniciarSesion } from './iniciar-sesion';

const AHORA = new Date('2026-09-04T12:00:00.000Z');
const CORREO = 'ana@snacklab.ec';
const CONTRASENA = 'tres cebollas moradas';
const HASH = '$argon2id$v=19$m=65536,t=3,p=1$sal$hash';

const COMPANY = companyId('018f2b8c-1111-7000-8000-000000000001');
const USUARIO = userId('018f2b8c-2222-7000-8000-000000000002');
const SESION = sessionId('018f2b8c-3333-7000-8000-000000000003');

const SEGUNDO_MS = 1000;
const MINUTO_MS = 60_000;

const CREDENCIAL: CredencialDeLogin = {
  userId: USUARIO,
  companyId: COMPANY,
  passwordHash: HASH,
  userStatus: 'ACTIVE',
  companyStatus: 'ACTIVE',
};

/** Repositorio en memoria: solo guarda lo que el caso de uso le pide guardar. */
class RepositorioDoble implements RepositorioDeAutenticacion {
  public credencial: CredencialDeLogin | null = CREDENCIAL;
  public fallos: FallosRecientes = { porCuenta: [], porIp: [] };
  public readonly intentos: string[] = [];
  public readonly sesiones: NuevaSesion[] = [];
  public olvidos = 0;
  public hashesGuardados = 0;

  public buscarCredencial(): Promise<CredencialDeLogin | null> {
    return Promise.resolve(this.credencial);
  }
  public fallosRecientes(entrada: {
    readonly email: string;
    readonly ip: string | null;
    readonly desde: Date;
  }): Promise<FallosRecientes> {
    void entrada;
    return Promise.resolve(this.fallos);
  }
  public registrarIntento(intento: { readonly outcome: string }): Promise<void> {
    this.intentos.push(intento.outcome);
    return Promise.resolve();
  }
  public olvidarFallos(): Promise<void> {
    this.olvidos += 1;
    return Promise.resolve();
  }
  public abrirSesion(nueva: NuevaSesion): Promise<SessionId> {
    this.sesiones.push(nueva);
    return Promise.resolve(SESION);
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
    return Promise.resolve(0);
  }
  public guardarHashDeContrasena(): Promise<void> {
    this.hashesGuardados += 1;
    return Promise.resolve();
  }
}

describe('IniciarSesion', () => {
  let repositorio: RepositorioDoble;
  let hasher: HasherDeContrasenas;
  let auditoria: AuditLogPort;
  let correo: MailerPort;
  let eventos: AuditEvent[];
  let correos: OutgoingMail[];
  let verificados: (string | null)[];
  let caso: IniciarSesion;
  let coincide: boolean;
  let pideRehash: boolean;

  beforeEach(() => {
    repositorio = new RepositorioDoble();
    eventos = [];
    correos = [];
    verificados = [];
    coincide = true;
    pideRehash = false;

    hasher = {
      hash: async () => Promise.resolve(HASH),
      verificar: async (hashRecibido) => {
        verificados.push(hashRecibido);
        return Promise.resolve(hashRecibido !== null && coincide);
      },
      necesitaRehash: () => pideRehash,
    };

    const tokens: GeneradorDeTokens = {
      generar: (): TokenDeSesion => ({ token: 'token-en-claro', hash: 'hash-del-token' }),
      hashDe: () => 'hash-del-token',
    };

    auditoria = {
      record: async (evento) => {
        eventos.push(evento);
        return Promise.resolve();
      },
    };

    correo = {
      send: async (mail) => {
        correos.push(mail);
        return Promise.resolve();
      },
    };

    const reloj: Reloj = { ahora: () => AHORA };

    const deps: DependenciasDeIniciarSesion = { repositorio, hasher, tokens, auditoria, correo, reloj };
    caso = new IniciarSesion(deps);
  });

  function entrar(datos: Partial<{ email: string; contrasena: string; ip: string | null }> = {}) {
    return caso.ejecutar({
      email: datos.email ?? CORREO,
      contrasena: datos.contrasena ?? CONTRASENA,
      ip: datos.ip === undefined ? '10.0.0.1' : datos.ip,
      userAgent: 'vitest',
    });
  }

  /** @param cuantos fallos, todos hace diez segundos */
  function fallosRecientes(cuantos: number): Date[] {
    return Array.from({ length: cuantos }, () => new Date(AHORA.getTime() - 10 * SEGUNDO_MS));
  }

  describe('camino correcto', () => {
    it('abre sesion y devuelve el token en claro una sola vez', async () => {
      const abierta = await entrar();

      expect(abierta.token).toBe('token-en-claro');
      expect(abierta.companyId).toBe(COMPANY);
      expect(abierta.userId).toBe(USUARIO);
    });

    it('en la base se guarda el HASH del token, nunca el token', async () => {
      await entrar();

      expect(repositorio.sesiones).toHaveLength(1);
      expect(repositorio.sesiones[0]?.tokenHash).toBe('hash-del-token');
      expect(JSON.stringify(repositorio.sesiones)).not.toContain('token-en-claro');
    });

    it('normaliza el correo antes de todo lo demas', async () => {
      const buscar = vi.spyOn(repositorio, 'buscarCredencial');

      await entrar({ email: '  ANA@SnackLab.EC  ' });

      expect(buscar).toHaveBeenCalledWith(CORREO);
    });

    it('olvida los fallos anteriores: un dia malo no se arrastra', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(3), porIp: [] };

      await entrar();

      expect(repositorio.olvidos).toBe(1);
    });

    it('registra el intento como success y audita `auth.login.succeeded`', async () => {
      await entrar();

      expect(repositorio.intentos).toEqual(['success']);
      expect(eventos.map((e) => e.eventType)).toEqual(['auth.login.succeeded']);
      expect(eventos[0]?.companyId).toBe(COMPANY);
    });

    it('rehashea si los parametros se han endurecido', async () => {
      pideRehash = true;

      await entrar();

      expect(repositorio.hashesGuardados).toBe(1);
    });

    it('no rehashea si no hace falta', async () => {
      await entrar();

      expect(repositorio.hashesGuardados).toBe(0);
    });
  });

  describe('los cuatro rechazos son indistinguibles', () => {
    /**
     * VA EN UNA SOLA PRUEBA A PROPOSITO. Repartido en cuatro, cada una pasaria
     * por su cuenta y la propiedad que importa —que los cuatro mensajes sean EL
     * MISMO— dependeria de que se ejecuten en orden y compartan estado. Es la
     * misma trampa que INC-008: la comprobacion que solo se cumple aislada.
     */
    it('correo desconocido, contrasena mala, usuario suspendido y company suspendida', async () => {
      const casos: (() => void)[] = [
        () => {
          repositorio.credencial = null;
        },
        () => {
          coincide = false;
        },
        () => {
          repositorio.credencial = { ...CREDENCIAL, userStatus: 'SUSPENDED' };
        },
        () => {
          repositorio.credencial = { ...CREDENCIAL, companyStatus: 'SUSPENDED' };
        },
      ];

      const mensajes: string[] = [];
      for (const preparar of casos) {
        repositorio.credencial = CREDENCIAL;
        coincide = true;
        preparar();

        await expect(entrar()).rejects.toBeInstanceOf(CredencialesInvalidasError);
        mensajes.push(await mensajeDelRechazo(entrar));
      }

      expect(mensajes).toHaveLength(casos.length);
      expect(new Set(mensajes).size).toBe(1);
    });
  });

  describe('el trabajo de hasheo se hace siempre', () => {
    it('tambien cuando el correo no existe: si no, el tiempo delataria', async () => {
      repositorio.credencial = null;

      await expect(entrar()).rejects.toThrow();

      expect(verificados).toEqual([null]);
    });

    it('el estado de la cuenta se mira DESPUES de verificar, no antes', async () => {
      repositorio.credencial = { ...CREDENCIAL, userStatus: 'SUSPENDED' };

      await expect(entrar()).rejects.toThrow();

      // Si se hubiera cortado por el estado, no habria llegado a verificar.
      expect(verificados).toEqual([HASH]);
    });
  });

  describe('el motivo real solo va al log', () => {
    it('la auditoria lleva el motivo; el error del usuario, no', async () => {
      coincide = false;

      await expect(entrar()).rejects.toThrow();

      expect(eventos[0]?.eventType).toBe('auth.login.failed');
      expect(eventos[0]?.detail).toEqual({ motivo: 'contrasena_incorrecta' });
    });

    it('un correo desconocido se audita SIN tenant y como anonimo', async () => {
      repositorio.credencial = null;

      await expect(entrar()).rejects.toThrow();

      expect(eventos[0]?.companyId).toBeNull();
      expect(eventos[0]?.actorType).toBe('ANONYMOUS');
    });
  });

  describe('bloqueo', () => {
    it('cinco fallos por cuenta bloquean', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(5), porIp: [] };

      await expect(entrar()).rejects.toBeInstanceOf(AccesoBloqueadoError);
    });

    it('el eje de IP aguanta mas: cinco fallos de la cocina NO bloquean el local', async () => {
      // Detras de una IP hay un restaurante entero saliendo por el mismo NAT.
      // Con el umbral de cuenta, cinco errores de cinco empleados distintos
      // dejarian al local completo fuera durante una hora.
      repositorio.fallos = { porCuenta: [], porIp: fallosRecientes(5) };

      await expect(entrar()).resolves.toBeDefined();
    });

    it('veinticinco fallos por IP si bloquean: eso ya es rociado de contrasenas', async () => {
      // Una IP probando la misma contrasena contra cien correos distintos:
      // ninguna cuenta llega a cinco fallos, y sin el eje de IP pasaria entera.
      repositorio.fallos = { porCuenta: [], porIp: fallosRecientes(25) };

      await expect(entrar()).rejects.toBeInstanceOf(AccesoBloqueadoError);
    });

    it('bloqueado NO gasta un hash: seria una denegacion de servicio barata', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(5), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(verificados).toEqual([]);
    });

    it('el intento bloqueado se registra y se audita como blocked', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(5), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(repositorio.intentos).toEqual(['blocked']);
      expect(eventos[0]?.eventType).toBe('auth.login.blocked');
      expect(eventos[0]?.outcome).toBe('blocked');
    });

    it('cuatro fallos todavia dejan pasar', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(4), porIp: [] };

      await expect(entrar()).resolves.toBeDefined();
    });
  });

  describe('aviso al titular', () => {
    it('el quinto fallo lo dispara', async () => {
      coincide = false;
      repositorio.fallos = { porCuenta: fallosRecientes(4), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(correos).toHaveLength(1);
      expect(correos[0]?.to).toBe(CORREO);
    });

    it('el segundo fallo no', async () => {
      coincide = false;
      repositorio.fallos = { porCuenta: fallosRecientes(1), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(correos).toEqual([]);
    });

    it('NUNCA se envia si la cuenta no existe: seria un relay de correo', async () => {
      repositorio.credencial = null;
      repositorio.fallos = { porCuenta: fallosRecientes(4), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(correos).toEqual([]);
    });

    it('el aviso no lleva enlaces: seria indistinguible de una suplantacion', async () => {
      coincide = false;
      repositorio.fallos = { porCuenta: fallosRecientes(4), porIp: [] };

      await expect(entrar()).rejects.toThrow();

      expect(correos[0]?.body).not.toMatch(/https?:\/\//u);
    });
  });

  describe('sin IP conocida', () => {
    it('la cuenta sigue protegiendo por su lado', async () => {
      repositorio.fallos = { porCuenta: fallosRecientes(5), porIp: [] };

      await expect(entrar({ ip: null })).rejects.toBeInstanceOf(AccesoBloqueadoError);
    });
  });

  describe('la ventana consultada cubre la escalada entera', () => {
    it('se piden los fallos de la ultima hora, no los de quince minutos', async () => {
      const espia = vi.spyOn(repositorio, 'fallosRecientes');

      await entrar();

      const llamada = espia.mock.calls[0]?.[0];
      expect(llamada?.desde).toEqual(new Date(AHORA.getTime() - 60 * MINUTO_MS));
    });
  });
});

/** Ejecuta y devuelve el mensaje del rechazo, para poder compararlos entre si. */
async function mensajeDelRechazo(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('se esperaba un rechazo y no lo hubo');
}
