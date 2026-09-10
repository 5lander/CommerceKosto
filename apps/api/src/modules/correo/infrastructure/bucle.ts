/**
 * Un bucle que espera entre pasadas y se deja parar — para `despachador.ts`.
 *
 * `setTimeout` a secas no basta: un `SIGTERM` durante la espera de cinco
 * segundos tendria que esperar a que venciera el temporizador para que el
 * proceso mirara si debe seguir, y `docker stop` da diez segundos antes de
 * matar. Aqui la senal despierta la espera en el acto, el bucle ve que ya no
 * sigue, y el proceso cierra el pool y sale limpio.
 *
 * NO INTERRUMPE UNA PASADA A MEDIAS, y es a proposito: un correo tomado y en
 * vuelo se termina de marcar. `correr()` solo resuelve cuando la pasada en
 * curso termino, asi que quien lo espera —el binario, antes de cerrar el pool—
 * no puede cerrar nada por debajo de un envio. Si el proceso muriera igual, la
 * reserva de la cola caduca y el correo vuelve solo (`prisma-cola-de-correo.ts`).
 */

export class BucleDePasadas {
  private activo = true;
  private despertar: (() => void) | null = null;

  public get sigue(): boolean {
    return this.activo;
  }

  /** Marca el fin y, si el bucle esta esperando, lo despierta ya. */
  public detener(): void {
    this.activo = false;
    this.despertar?.();
  }

  /**
   * Pasada, espera, pasada... hasta `detener()`. Resuelve cuando la pasada en
   * curso ha terminado: nunca a medias.
   */
  public async correr(pasada: () => Promise<void>, intervaloMs: number): Promise<void> {
    while (this.activo) {
      await pasada();
      await this.esperar(intervaloMs);
    }
  }

  public async esperar(ms: number): Promise<void> {
    if (!this.activo) {
      return;
    }
    await new Promise<void>((resolver) => {
      const temporizador = setTimeout(() => {
        this.despertar = null;
        resolver();
      }, ms);
      this.despertar = () => {
        clearTimeout(temporizador);
        this.despertar = null;
        resolver();
      };
    });
  }
}
