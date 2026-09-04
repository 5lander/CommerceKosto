/**
 * Lo que convierte un falso en util para probar — CLAUDE.md §12.
 *
 * Un doble que siempre responde al instante y siempre con exito solo prueba el
 * camino feliz. Los caminos que rompen en produccion son el lento y el que
 * falla, y ninguno de los dos se puede provocar con un servicio real sin
 * romperlo de verdad. Por eso los falsos de este proyecto simulan latencia y
 * permiten armar un fallo para la siguiente llamada.
 */

const LATENCIA_POR_DEFECTO_MS = 5;

export class ExternalServiceFailure extends Error {
  public constructor(service: string) {
    super(`El servicio externo "${service}" fallo (simulado por su adaptador falso).`);
    this.name = 'ExternalServiceFailure';
  }
}

export class Simulation {
  private fallosPendientes = 0;

  public constructor(
    private readonly service: string,
    private readonly latencyMs: number = LATENCIA_POR_DEFECTO_MS,
  ) {}

  /** Arma `count` fallos consecutivos en las siguientes llamadas. */
  public failNext(count = 1): void {
    this.fallosPendientes = count;
  }

  /** @throws {ExternalServiceFailure} si hay un fallo armado. */
  public async settle(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, this.latencyMs);
    });

    if (this.fallosPendientes > 0) {
      this.fallosPendientes -= 1;
      throw new ExternalServiceFailure(this.service);
    }
  }
}
