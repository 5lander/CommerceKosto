import { Injectable } from '@nestjs/common';

import type { Reloj } from '../../application/ports/reloj.port';

@Injectable()
export class RelojDelSistema implements Reloj {
  public ahora(): Date {
    return new Date();
  }
}
