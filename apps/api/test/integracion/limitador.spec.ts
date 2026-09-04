/**
 * El limitador de peticiones — SEGURIDAD.md §2.1.
 *
 * ESTA PRUEBA NO EXISTIA HASTA P1, Y EL HUECO SE VIO POR ACCIDENTE. P0 cableo
 * el `ThrottlerGuard` como `APP_GUARD` y lo dio por hecho; nada comprobaba que
 * llegara a devolver un 429. Se descubrio porque el limitador empezo a estorbar
 * a OTRA suite —los fallos esperados salian como "expected 429 to be 400"— y
 * esa fue la unica prueba que habia tenido nunca de que funcionara: un efecto
 * colateral.
 *
 * DOS MECANISMOS DISTINTOS DEVUELVEN 429, Y HAY QUE SABER CUAL RESPONDIO:
 *
 *   TOO_MANY_REQUESTS   el limitador. Cuenta peticiones por IP, da igual la
 *                       ruta y da igual quien seas.
 *
 *   ACCESO_BLOQUEADO    la politica anti fuerza bruta. Cuenta INTENTOS DE LOGIN
 *                       fallidos por cuenta y por IP, y escala.
 *
 * El primer intento de escribir esta prueba usaba `POST /auth/login` con un
 * correo fijo, y acabo midiendo el segundo mecanismo sin darse cuenta: los
 * fallos se acumulaban en `login_attempt` entre corridas y a la quinta llegaba
 * un 429 que no era del limitador. Por eso se usa una ruta SIN logica de
 * intentos —`GET /ubicaciones` sin cookie— y por eso se comprueba el `code`, no
 * solo el estado. El `code` es justo lo que permite a un cliente distinguir
 * "espera un momento" de "tu cuenta esta bloqueada".
 *
 * SE LEVANTA UNA APLICACION PROPIA con su limite. Es lo que permite
 * `AppModule.forRoot(config)` y la razon por la que la configuracion entra por
 * parametro en vez de leerse de `process.env`: cada suite trae la suya.
 */

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

const OK = 200;
const NO_AUTORIZADO = 401;
const DEMASIADAS = 429;

const PETICIONES_PERMITIDAS = 3;
const VENTANA_MS = 60_000;

describe('el limitador de peticiones', () => {
  let app: INestApplication;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  /**
   * Una peticion que pasa por el limitador y por NADA mas que pueda devolver
   * 429. Sin cookie da 401, que es un estado inequivoco.
   */
  function pedir(): request.Test {
    return request(servidor()).get('/ubicaciones');
  }

  beforeAll(async () => {
    app = await createApplication({
      ...loadConfiguration(process.env),
      rateLimit: { windowMs: VENTANA_MS, max: PETICIONES_PERMITIDAS },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deja pasar hasta el limite y corta despues', async () => {
    const estados: number[] = [];
    for (let intento = 0; intento < PETICIONES_PERMITIDAS + 1; intento += 1) {
      estados.push((await pedir()).status);
    }

    expect(estados).toEqual([
      ...Array.from({ length: PETICIONES_PERMITIDAS }, () => NO_AUTORIZADO),
      DEMASIADAS,
    ]);
  });

  it('el 429 sale con el formato unico de error y con el codigo DEL LIMITADOR', async () => {
    const respuesta = await pedir();

    expect(respuesta.status).toBe(DEMASIADAS);
    // `TOO_MANY_REQUESTS` y no `ACCESO_BLOQUEADO`: son dos cosas distintas y el
    // cliente tiene que poder distinguirlas.
    expect(respuesta.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(respuesta.body).toHaveProperty('message');
  });

  it('las sondas de salud lo esquivan: las llama el orquestador, no un cliente', async () => {
    // Con el limitador ya disparado, `/health` sigue respondiendo. Si no fuera
    // asi, un pico de trafico sacaria las replicas del balanceador justo cuando
    // mas falta hacen.
    expect((await request(servidor()).get('/health')).status).toBe(OK);
  });
});
