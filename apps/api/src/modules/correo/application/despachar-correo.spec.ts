/**
 * Una pasada del despachador con dobles en memoria — base apagada (CLAUDE.md §2).
 */

import { describe, expect, it } from 'vitest';

import type { MailerPort, OutgoingMail } from '../../../shared/application/ports/mailer.port';
import type { Reloj } from '../../../shared/application/ports/reloj.port';
import { INTENTOS_MAXIMOS } from '../domain/reintentos';
import { DespacharCorreo } from './despachar-correo';
import type { ColaDeCorreo, CorreoPendiente, FalloDeEnvio, ReservaDeCorreo } from './ports/cola-de-correo.port';

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const HORA_MS = 3_600_000;
const RESERVADO_HASTA = new Date('2026-09-10T12:05:00.000Z');
const ENLACE = 'http://localhost:3001/activacion?token=abc';

const reloj: Reloj = { ahora: () => AHORA };

function pendiente(cambios: Partial<CorreoPendiente> = {}): CorreoPendiente {
  return {
    id: 'c1',
    destinatario: 'ana@snacklab.ec',
    plantilla: 'INVITACION',
    contenido: { plantilla: 'INVITACION', datos: { enlace: ENLACE, caducaEn: '2026-09-17T12:00:00.000Z' } },
    intentos: 0,
    reservadoHasta: RESERVADO_HASTA,
    ...cambios,
  };
}

class ColaEnMemoria implements ColaDeCorreo {
  public readonly enviados: { id: string; ahora: Date; datos: unknown }[] = [];
  public readonly fallos: { id: string; fallo: FalloDeEnvio }[] = [];
  public readonly renovaciones: { id: string; reservadoHasta: Date; ahora: Date }[] = [];
  /** Ids cuya reserva «ya es de otra instancia»: renovar devuelve `false`. */
  public cedidos: readonly string[] = [];
  public marcarEnviadoFallaCon: Error | null = null;
  public purgadoAntesDe: Date | null = null;
  public tomado: { ahora: Date; lote: number } | null = null;

  public constructor(private readonly filas: readonly CorreoPendiente[]) {}

  public tomarPendientes(ahora: Date, lote: number): Promise<readonly CorreoPendiente[]> {
    this.tomado = { ahora, lote };
    return Promise.resolve(this.filas.slice(0, lote));
  }

  public renovarReserva(correo: ReservaDeCorreo, ahora: Date): Promise<boolean> {
    this.renovaciones.push({ id: correo.id, reservadoHasta: correo.reservadoHasta, ahora });
    return Promise.resolve(!this.cedidos.includes(correo.id));
  }

  public marcarEnviado(id: string, ahora: Date, datos: unknown): Promise<void> {
    if (this.marcarEnviadoFallaCon !== null) {
      return Promise.reject(this.marcarEnviadoFallaCon);
    }
    this.enviados.push({ id, ahora, datos });
    return Promise.resolve();
  }

  public marcarFallo(id: string, fallo: FalloDeEnvio): Promise<void> {
    this.fallos.push({ id, fallo });
    return Promise.resolve();
  }

  public purgarLimites(antesDe: Date): Promise<number> {
    this.purgadoAntesDe = antesDe;
    return Promise.resolve(3);
  }
}

class MailerEnMemoria implements MailerPort {
  public readonly enviados: OutgoingMail[] = [];
  public fallaCon: Error | null = null;

  public send(mail: OutgoingMail): Promise<void> {
    if (this.fallaCon !== null) {
      return Promise.reject(this.fallaCon);
    }
    this.enviados.push(mail);
    return Promise.resolve();
  }
}

function despacho(cola: ColaDeCorreo, mailer: MailerPort, lote = 20): DespacharCorreo {
  return new DespacharCorreo({ cola, mailer, reloj, lote });
}

describe('DespacharCorreo', () => {
  it('escribe el correo con la plantilla, lo manda y lo marca ENVIADO con datos saneados', async () => {
    const cola = new ColaEnMemoria([pendiente()]);
    const mailer = new MailerEnMemoria();

    const resumen = await despacho(cola, mailer).ejecutar();

    expect(resumen).toEqual({ tomados: 1, enviados: 1, fallidos: 0, cedidos: 0, purgados: 3 });
    expect(mailer.enviados).toHaveLength(1);
    expect(mailer.enviados[0]?.to).toBe('ana@snacklab.ec');
    expect(mailer.enviados[0]?.subject).toBe('Te han invitado a costeo-saas');
    expect(mailer.enviados[0]?.body).toContain(ENLACE);
    expect(cola.enviados).toEqual([
      { id: 'c1', ahora: AHORA, datos: { plantilla: 'INVITACION', destinatario: 'ana@snacklab.ec' } },
    ]);
    expect(cola.fallos).toHaveLength(0);
  });

  it('renueva la reserva de cada correo, con la firma con la que se tomo, justo antes de enviarlo', async () => {
    const cola = new ColaEnMemoria([pendiente({ id: 'c1' }), pendiente({ id: 'c2' })]);
    const mailer = new MailerEnMemoria();

    await despacho(cola, mailer).ejecutar();

    expect(cola.renovaciones).toEqual([
      { id: 'c1', reservadoHasta: RESERVADO_HASTA, ahora: AHORA },
      { id: 'c2', reservadoHasta: RESERVADO_HASTA, ahora: AHORA },
    ]);
  });

  it('si otra instancia se quedo con la reserva, el correo se cede: ni se envia ni se marca, y la pasada sigue', async () => {
    const cola = new ColaEnMemoria([pendiente({ id: 'c1' }), pendiente({ id: 'c2', destinatario: 'luis@snacklab.ec' })]);
    cola.cedidos = ['c1'];
    const mailer = new MailerEnMemoria();

    const resumen = await despacho(cola, mailer).ejecutar();

    expect(resumen).toEqual({ tomados: 2, enviados: 1, fallidos: 0, cedidos: 1, purgados: 3 });
    expect(mailer.enviados.map((correo) => correo.to)).toEqual(['luis@snacklab.ec']);
    expect(cola.enviados.map((marca) => marca.id)).toEqual(['c2']);
    expect(cola.fallos).toHaveLength(0);
  });

  it('un envio que falla se marca con el error, la espera y sin sanear, y no para a los demas', async () => {
    const cola = new ColaEnMemoria([pendiente({ id: 'c1' }), pendiente({ id: 'c2', destinatario: 'luis@snacklab.ec' })]);
    const mailer = new MailerEnMemoria();
    mailer.fallaCon = new Error('Resend respondio 503.');

    const resumen = await despacho(cola, mailer).ejecutar();

    expect(resumen.fallidos).toBe(2);
    expect(cola.fallos.map((f) => f.id)).toEqual(['c1', 'c2']);
    const fallo = cola.fallos[0]?.fallo;
    expect(fallo?.error).toBe('Resend respondio 503.');
    expect(fallo?.decision).toEqual({
      estado: 'PENDIENTE',
      intentos: 1,
      siguienteIntentoEn: new Date(AHORA.getTime() + 60_000),
    });
  });

  it('si el proveedor acepto el correo y falla la MARCA, el error sube y NO pasa por marcarFallo: no se reintenta lo que ya salio', async () => {
    const cola = new ColaEnMemoria([pendiente({ id: 'c1' }), pendiente({ id: 'c2', destinatario: 'luis@snacklab.ec' })]);
    cola.marcarEnviadoFallaCon = new Error("Can't reach database server");
    const mailer = new MailerEnMemoria();

    await expect(despacho(cola, mailer).ejecutar()).rejects.toThrow("Can't reach database server");

    // El primero salio; la pasada se corto ahi: el segundo ni se intento.
    expect(mailer.enviados.map((correo) => correo.to)).toEqual(['ana@snacklab.ec']);
    expect(cola.fallos).toHaveLength(0);
    expect(cola.purgadoAntesDe).toBeNull();
  });

  it('al quinto fallo la decision es FALLIDO y viajan los datos saneados para reemplazar el enlace', async () => {
    const cola = new ColaEnMemoria([pendiente({ intentos: INTENTOS_MAXIMOS - 1 })]);
    const mailer = new MailerEnMemoria();
    mailer.fallaCon = new Error('sin red');

    await despacho(cola, mailer).ejecutar();

    const fallo = cola.fallos[0]?.fallo;
    expect(fallo?.decision.estado).toBe('FALLIDO');
    expect(fallo?.datosSaneados).toEqual({ plantilla: 'INVITACION', destinatario: 'ana@snacklab.ec' });
  });

  it('una fila con datos ilegibles no bloquea la cola: cuenta como un fallo mas, sin llamar al proveedor', async () => {
    const cola = new ColaEnMemoria([pendiente({ contenido: null })]);
    const mailer = new MailerEnMemoria();

    const resumen = await despacho(cola, mailer).ejecutar();

    expect(resumen.fallidos).toBe(1);
    expect(mailer.enviados).toHaveLength(0);
    expect(cola.fallos[0]?.fallo.error).toContain('no tienen la forma');
  });

  it('el mensaje de error se acota a 500 caracteres: la columna la leen otros', async () => {
    const cola = new ColaEnMemoria([pendiente()]);
    const mailer = new MailerEnMemoria();
    mailer.fallaCon = new Error('x'.repeat(2_000));

    await despacho(cola, mailer).ejecutar();

    expect(cola.fallos[0]?.fallo.error).toHaveLength(500);
  });

  it('el aviso de bloqueo, sin datos, se escribe y se manda igual', async () => {
    const cola = new ColaEnMemoria([
      pendiente({ plantilla: 'BLOQUEO', contenido: { plantilla: 'BLOQUEO', datos: {} } }),
    ]);
    const mailer = new MailerEnMemoria();

    await despacho(cola, mailer).ejecutar();

    expect(mailer.enviados[0]?.subject).toContain('Intentos de acceso fallidos');
    expect(cola.enviados[0]?.datos).toEqual({ plantilla: 'BLOQUEO', destinatario: 'ana@snacklab.ec' });
  });

  it('pide el lote configurado y purga los golpes de mas de 24 horas, aunque no haya correos', async () => {
    const cola = new ColaEnMemoria([]);

    const resumen = await despacho(cola, new MailerEnMemoria(), 7).ejecutar();

    expect(cola.tomado).toEqual({ ahora: AHORA, lote: 7 });
    expect(cola.purgadoAntesDe).toEqual(new Date(AHORA.getTime() - 24 * HORA_MS));
    expect(resumen).toEqual({ tomados: 0, enviados: 0, fallidos: 0, cedidos: 0, purgados: 3 });
  });
});
