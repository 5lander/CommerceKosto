/**
 * El bucle del despachador: espera, y una parada lo despierta en el acto —
 * pero nunca a media pasada.
 */

import { describe, expect, it } from 'vitest';

import { BucleDePasadas } from './bucle';

const ESPERA_LARGA_MS = 60_000;
const MARGEN_MS = 200;

/** Una promesa que se resuelve desde fuera: una pasada «en vuelo». */
function diferida(): { promesa: Promise<void>; resolver: () => void } {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

async function cederElTurno(): Promise<void> {
  await new Promise<void>((r) => {
    setTimeout(r, 0);
  });
}

describe('BucleDePasadas', () => {
  it('detener() despierta la espera sin agotar el temporizador', async () => {
    const bucle = new BucleDePasadas();
    const inicio = Date.now();

    const espera = bucle.esperar(ESPERA_LARGA_MS);
    bucle.detener();
    await espera;

    expect(Date.now() - inicio).toBeLessThan(MARGEN_MS);
    expect(bucle.sigue).toBe(false);
  });

  it('una vez detenido, esperar() vuelve enseguida', async () => {
    const bucle = new BucleDePasadas();
    bucle.detener();
    const inicio = Date.now();

    await bucle.esperar(ESPERA_LARGA_MS);

    expect(Date.now() - inicio).toBeLessThan(MARGEN_MS);
  });

  it('sin parada, la espera dura lo que se pidio', async () => {
    const bucle = new BucleDePasadas();
    const inicio = Date.now();

    await bucle.esperar(20);

    expect(Date.now() - inicio).toBeGreaterThanOrEqual(15);
    expect(bucle.sigue).toBe(true);
  });

  it('correr() con una parada A MEDIA PASADA termina esa pasada antes de resolver: nadie cierra el pool por debajo de un envio', async () => {
    const bucle = new BucleDePasadas();
    const enVuelo = diferida();
    let pasadasTerminadas = 0;
    let correrResolvio = false;

    const corrida = bucle
      .correr(async () => {
        await enVuelo.promesa;
        pasadasTerminadas += 1;
      }, ESPERA_LARGA_MS)
      .then(() => {
        correrResolvio = true;
      });

    // La senal llega con la pasada en vuelo.
    await cederElTurno();
    bucle.detener();
    await cederElTurno();
    expect(correrResolvio).toBe(false);
    expect(pasadasTerminadas).toBe(0);

    // La pasada termina, y solo entonces `correr` resuelve, sin otra pasada.
    enVuelo.resolver();
    await corrida;
    expect(correrResolvio).toBe(true);
    expect(pasadasTerminadas).toBe(1);
  });

  it('correr() con una parada durante la espera sale sin empezar otra pasada', async () => {
    const bucle = new BucleDePasadas();
    let pasadas = 0;
    const inicio = Date.now();

    const corrida = bucle.correr(() => {
      pasadas += 1;
      return Promise.resolve();
    }, ESPERA_LARGA_MS);
    await cederElTurno();
    bucle.detener();
    await corrida;

    expect(pasadas).toBe(1);
    expect(Date.now() - inicio).toBeLessThan(MARGEN_MS);
  });

  it('correr() ya detenido no hace ninguna pasada', async () => {
    const bucle = new BucleDePasadas();
    bucle.detener();
    let pasadas = 0;

    await bucle.correr(() => {
      pasadas += 1;
      return Promise.resolve();
    }, ESPERA_LARGA_MS);

    expect(pasadas).toBe(0);
  });
});
