/**
 * Adaptador falso de correo — CLAUDE.md §12, `MAIL_ADAPTER=fake`.
 *
 * Guarda lo enviado en memoria en vez de mandarlo. Es lo que permite que las
 * pruebas de P1 comprueben el CONTENIDO de una invitacion —que el enlace
 * caduque, que no lleve la contrasena dentro— sin una cuenta de correo ni una
 * bandeja que vaciar.
 */

import { Injectable } from '@nestjs/common';

import type { MailerPort, OutgoingMail } from '../../application/ports/mailer.port';
import { Simulation } from './simulation';

@Injectable()
export class FakeMailer implements MailerPort {
  public readonly simulation = new Simulation('mailer');
  private readonly enviados: OutgoingMail[] = [];

  public async send(mail: OutgoingMail): Promise<void> {
    await this.simulation.settle();
    this.enviados.push(mail);
  }

  public get sent(): readonly OutgoingMail[] {
    return this.enviados;
  }
}
