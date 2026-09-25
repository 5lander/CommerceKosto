/**
 * `X-Forwarded-For` desde un par que NO es de confianza, contra la API real
 * — P16-A1, D-16.36, D-16.49, INC-022.
 *
 * Es la mitad que protege de la falsificacion: con `PROXY_DE_CONFIANZA` vacia
 * (la configuracion de desarrollo, y la de cualquier despliegue sin proxy),
 * la cabecera se IGNORA aunque venga. Si no fuera asi, cualquiera esquivaria
 * el limite por IP cambiandola en cada intento, o bloquearia a un tercero
 * envenenando su IP.
 *
 *   - diez `/olvido` con diez `X-Forwarded-For` distintas siguen siendo diez
 *     golpes de la MISMA clave (la IP del socket): el undecimo es 429
 *   - `login_attempt.ip` guarda la IP del socket, no la cabecera
 *   - cada golpe deja su fila: `ip:` con la IP del socket y `correo:` con un
 *     hash, y ninguna con el correo en claro
 *
 * La otra mitad —el par SI es de confianza y la cabecera manda— esta en
 * `limite-de-tasa.spec.ts`, con su propia app. UNA app HTTP por archivo.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

const ACEPTADO = 202;
const NO_AUTORIZADO = 401;
const DEMASIADAS_PETICIONES = 429;

const OLVIDO_POR_IP = 10;
/** Lo que supertest deja en el socket: loopback, ya normalizado de `::ffff:127.0.0.1`. */
const SOCKET = '127.0.0.1';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

describe('X-Forwarded-For desde un par que NO es de confianza', () => {
  let app: INestApplication;
  let duena: Client;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function correoNuevo(): string {
    return `falso.${randomUUID().slice(0, 8)}@snacklab.ec`;
  }

  function olvidoDesde(ipFalsa: string): request.Test {
    return request(servidor())
      .post('/auth/password/olvido')
      .set('X-Forwarded-For', ipFalsa)
      .send({ email: correoNuevo() });
  }

  async function contar(sql: string, valores: readonly unknown[] = []): Promise<number> {
    const { rows } = await duena.query<{ n: string }>(sql, [...valores]);
    return Number(rows[0]?.n ?? '0');
  }

  beforeAll(async () => {
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    const configuracion = loadConfiguration(process.env);
    // Sin proxies de confianza a proposito: es lo que se prueba. El limitador
    // global va alto para que su 429 no se confunda con el del limite de tasa.
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
      proxiesDeConfianza: [],
    });
    await app.init();

    await duena.query('DELETE FROM rate_limit_hit');
    await duena.query('DELETE FROM login_attempt');
  });

  afterAll(async () => {
    // Todo lo de esta suite quedo bajo `ip:127.0.0.1`, que es la clave de
    // cualquier otra suite: no se deja para la siguiente.
    await duena.query('DELETE FROM rate_limit_hit');
    await app.close();
    await duena.end();
  });

  it('una X-Forwarded-For distinta en cada peticion NO cambia la clave: el undecimo es 429 igual', async () => {
    const estados: number[] = [];
    for (let i = 0; i < OLVIDO_POR_IP; i += 1) {
      estados.push((await olvidoDesde(`198.51.100.${String(i + 1)}`)).status);
    }
    expect(estados).toEqual(Array.from({ length: OLVIDO_POR_IP }, () => ACEPTADO));

    const undecimo = await olvidoDesde('198.51.100.200');
    expect(undecimo.status).toBe(DEMASIADAS_PETICIONES);
    expect(undecimo.body).toMatchObject({ code: 'LIMITE_DE_SOLICITUDES' });
    expect(undecimo.headers['retry-after']).toMatch(/^\d+$/u);

    // Y sin cabecera tampoco: es la misma IP del socket.
    const sinCabecera = await request(servidor()).post('/auth/password/olvido').send({ email: correoNuevo() });
    expect(sinCabecera.status).toBe(DEMASIADAS_PETICIONES);
  });

  it('todos los golpes quedaron bajo la IP del socket, y ninguna clave lleva un correo', async () => {
    expect(await contar(`SELECT count(*)::text AS n FROM rate_limit_hit WHERE clave = $1`, [`ip:${SOCKET}`])).toBe(
      OLVIDO_POR_IP + 2,
    );
    expect(await contar(`SELECT count(*)::text AS n FROM rate_limit_hit WHERE clave LIKE 'ip:198.51.100.%'`)).toBe(0);
    expect(await contar(`SELECT count(*)::text AS n FROM rate_limit_hit WHERE clave LIKE '%@%'`)).toBe(0);
    expect(await contar(`SELECT count(*)::text AS n FROM rate_limit_hit WHERE clave ~ '^correo:[0-9a-f]{64}$'`)).toBe(
      OLVIDO_POR_IP + 2,
    );
  });

  it('login_attempt.ip guarda la IP del socket, no la cabecera', async () => {
    const correo = correoNuevo();
    const respuesta = await request(servidor())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.77')
      .send({ email: correo, contrasena: 'no es esta' });
    expect(respuesta.status).toBe(NO_AUTORIZADO);

    const { rows } = await duena.query<{ ip: string }>(
      `SELECT host(ip) AS ip FROM login_attempt WHERE email = $1 ORDER BY at DESC LIMIT 1`,
      [correo],
    );
    expect(rows[0]?.ip).toBe(SOCKET);
  });
});
