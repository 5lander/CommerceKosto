/**
 * `/health`, `/ready` y el formato unico de error, contra la aplicacion REAL —
 * la misma que monta `main.ts`, porque las dos pasan por `createApplication`.
 */

import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

const OK = 200;
const NO_ENCONTRADO = 404;

describe('la aplicacion HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(loadConfiguration(process.env));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

/**
 * `INestApplication.getHttpServer()` esta declarado como `any` en NestJS. Se
 * fija aqui, en un unico sitio y con el tipo real, en vez de dejar que ese
 * `any` se propague por cada llamada a supertest — que es justo lo que
 * `no-unsafe-argument` detecta y lo que CLAUDE.md §3 prohibe.
 */
  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  describe('/health — liveness', () => {
    it('responde 200 y ok', async () => {
      const respuesta = await request(servidor()).get('/health');

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toMatchObject({ status: 'ok' });
    });

    it('NO consulta la base de datos', async () => {
      // Si la consultara, un corte de PostgreSQL haria que el orquestador
      // matara y reiniciara todas las replicas — lo peor que puede pasar
      // durante un corte de base de datos. Se comprueba por la forma de la
      // respuesta: liveness no reporta ningun indicador.
      const respuesta = await request(servidor()).get('/health');

      expect(respuesta.body).toMatchObject({ info: {}, details: {} });
    });
  });

  describe('/ready — readiness', () => {
    it('responde 200 con la base arriba, y dice que la miro', async () => {
      const respuesta = await request(servidor()).get('/ready');

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
    });
  });

  describe('formato unico de error', () => {
    it('un 404 sale como { code, message } y nada mas', async () => {
      const respuesta = await request(servidor()).get('/no-existe-esta-ruta');

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect(Object.keys(respuesta.body as Record<string, unknown>).sort()).toEqual(['code', 'message']);
      expect(respuesta.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('el cuerpo del error es JSON, tambien en una ruta inexistente', async () => {
      const respuesta = await request(servidor()).get('/no-existe-esta-ruta');

      expect(respuesta.headers['content-type']).toContain('application/json');
    });
  });
});
