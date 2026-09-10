/**
 * Lo que el rol del back office ve —y NO ve— del correo transaccional, contra
 * PostgreSQL real — P16-A1, Fase 3 (ADR-025, D-16.34).
 *
 *   - `costeo_backoffice` lee la salud de la cola (contadores e instantes) pero
 *     NO `email_outbox.datos`: el enlace con el token en claro, mientras el
 *     correo esta en vuelo, vale lo mismo que la fila de `password_reset_token`,
 *     y su BYPASSRLS no le da un privilegio de columna que no tiene
 *   - el token en claro no llega a `audit_log` por ninguna de las tres rutas
 *     que lo generan: invitar, reenviar y `/olvido`
 *   - al bloquear por limite de tasa queda `system.ratelimit.exceeded`, con
 *     la IP y el kind, y SIN el correo del destinatario (D-16.50); y queda
 *     UNA vez, en la transicion: los 429 siguientes no anaden filas
 *
 * POR QUE ESTA SUITE Y NO `correo-transaccional.spec.ts`: `audit_log` solo lo
 * lee el back office. El migrator tiene politica de INSERT y nada mas, asi que
 * un `count(*)` con la duena daria 0 aunque el token estuviera dentro — un
 * verde que no mide nada (INC-007). Y `BACKOFFICE_DATABASE_URL` solo puede
 * nombrarse en las suites del back office (`audit:forbidden`, ADR-017): la
 * regla es deliberadamente estrecha y se respeta, no se ensancha.
 *
 * UNA sola app HTTP por archivo, con el limitador subido para que un 429 no
 * se confunda con lo que se mide.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

const OK = 200;
const ACEPTADO = 202;
const DEMASIADAS_PETICIONES = 429;

/** Codigo SQLSTATE de "privilegio insuficiente". */
const PRIVILEGIO_DENEGADO = '42501';

const CONTRASENA = 'tres cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
const URL_BACKOFFICE = process.env['BACKOFFICE_DATABASE_URL'];
if (URL_MIGRATOR === undefined || URL_BACKOFFICE === undefined) {
  throw new Error('Faltan MIGRATION_DATABASE_URL o BACKOFFICE_DATABASE_URL. Ver .env.example.');
}

describe('el back office y el correo transaccional', () => {
  let app: INestApplication;
  let duena: Client;
  let backoffice: Client;
  let sufijo: string;
  let companyId: string;
  let admin: string;
  let ana: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function unaFila(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ id: string }>(sql, [...valores]);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`la siembra no devolvio id: ${sql}`);
    }
    return id;
  }

  async function contar(cliente: Client, sql: string, valores: readonly unknown[] = []): Promise<number> {
    const { rows } = await cliente.query<{ n: string }>(sql, [...valores]);
    return Number(rows[0]?.n ?? '0');
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor()).post('/auth/login').send({ email, contrasena: CONTRASENA });
    expect(respuesta.status).toBe(OK);
    return (respuesta.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  }

  /** Los tokens en claro que hay en vuelo para un destinatario, leidos con la duena. */
  async function tokensEnVuelo(destinatario: string): Promise<readonly string[]> {
    const { rows } = await duena.query<{ enlace: string }>(
      `SELECT datos->>'enlace' AS enlace FROM email_outbox WHERE destinatario = $1 ORDER BY created_at DESC`,
      [destinatario],
    );
    return rows.map((fila) => {
      const token = new URL(fila.enlace).searchParams.get('token');
      if (token === null) {
        throw new Error(`el enlace no lleva token: ${fila.enlace}`);
      }
      return token;
    });
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    backoffice = new Client({ connectionString: URL_BACKOFFICE });
    await backoffice.connect();

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    // Los cuatro endpoints con limite de tasa (D-16.50) cuentan por IP, y aqui
    // todo sale de 127.0.0.1: el residuo de otra corrida bloquearia esta.
    await duena.query('DELETE FROM rate_limit_hit');

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    companyId = await unaFila(
      `INSERT INTO company (name, status, plan_code) VALUES ($1, 'ACTIVE', 'BASICO') RETURNING id`,
      [`backoffice-correo ${sufijo}`],
    );
    admin = `admin.${sufijo}@snacklab.ec`;
    ana = `ana.${sufijo}@snacklab.ec`;
    for (const email of [admin, ana]) {
      const usuario = await unaFila(
        `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
        [companyId, email, hash],
      );
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'ADMIN', false)`,
        [companyId, usuario],
      );
    }
  });

  afterAll(async () => {
    await app.close();
    await backoffice.end();
    await duena.end();
  });

  it('el token en claro no llega a audit_log por ninguna de las tres rutas: invitar, reenviar y /olvido', async () => {
    const cookie = await entrar(admin);
    const nuevo = `rastro.${randomUUID().slice(0, 8)}@snacklab.ec`;

    expect((await request(servidor()).post('/usuarios').set('Cookie', cookie).send({ email: nuevo })).status).toBe(
      ACEPTADO,
    );
    const invitado = await unaFila(`SELECT id FROM app_user WHERE email = $1`, [nuevo]);
    expect(
      (await request(servidor()).post(`/usuarios/${invitado}/reenvio-de-invitacion`).set('Cookie', cookie)).status,
    ).toBe(ACEPTADO);
    expect((await request(servidor()).post('/auth/password/olvido').send({ email: ana })).status).toBe(ACEPTADO);

    const tokens = [...(await tokensEnVuelo(nuevo)), ...(await tokensEnVuelo(ana))];
    expect(tokens).toHaveLength(3);

    // Control positivo ANTES de buscar el token: el back office ve el log, y ve
    // los eventos que estas tres rutas acaban de escribir. Sin esto, un lector
    // sin privilegio daria 0 filas y la prueba pasaria sin medir nada.
    expect(
      await contar(
        backoffice,
        `SELECT count(*)::text AS n FROM audit_log
          WHERE company_id = $1 AND event_type IN ('user.invited', 'user.invitation_resent')`,
        [companyId],
      ),
    ).toBe(2);
    expect(
      await contar(
        backoffice,
        `SELECT count(*)::text AS n FROM audit_log WHERE event_type = 'auth.password.reset_requested'`,
      ),
    ).toBeGreaterThan(0);

    for (const token of tokens) {
      expect(
        await contar(backoffice, `SELECT count(*)::text AS n FROM audit_log a WHERE a::text LIKE '%' || $1 || '%'`, [
          token,
        ]),
      ).toBe(0);
    }
  });

  it('al bloquear por limite de tasa queda system.ratelimit.exceeded con la IP y el kind, y sin el correo', async () => {
    const desconocido = `nadie.${randomUUID().slice(0, 8)}@snacklab.ec`;
    const antes = new Date();

    // Cuatro para un correo que no existe: el limite no distingue, y el
    // cuarto es el que audita.
    for (let i = 0; i < 3; i += 1) {
      expect((await request(servidor()).post('/auth/password/olvido').send({ email: desconocido })).status).toBe(
        ACEPTADO,
      );
    }
    const cuarto = await request(servidor()).post('/auth/password/olvido').send({ email: desconocido });
    expect(cuarto.status).toBe(DEMASIADAS_PETICIONES);
    expect(cuarto.body).toMatchObject({ code: 'LIMITE_DE_SOLICITUDES' });

    const { rows } = await backoffice.query<{ ip: string | null; detail: Record<string, unknown> }>(
      `SELECT host(ip) AS ip, detail FROM audit_log
        WHERE event_type = 'system.ratelimit.exceeded' AND at >= $1 ORDER BY at DESC`,
      [antes],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ ip: '127.0.0.1', detail: { kind: 'password.olvido', ejes: 'destinatario' } });
    expect(JSON.stringify(rows[0]?.detail)).not.toContain(desconocido);
    expect(
      await contar(backoffice, `SELECT count(*)::text AS n FROM audit_log a WHERE a::text LIKE '%' || $1 || '%'`, [
        desconocido,
      ]),
    ).toBe(0);

    // Insistir bloqueado deja golpes, no eventos: `audit_log` no se purga y
    // auditar cada 429 dejaria a un anonimo escribir miles de filas por hora.
    for (let i = 0; i < 3; i += 1) {
      expect((await request(servidor()).post('/auth/password/olvido').send({ email: desconocido })).status).toBe(
        DEMASIADAS_PETICIONES,
      );
    }
    expect(
      await contar(
        backoffice,
        `SELECT count(*)::text AS n FROM audit_log
          WHERE event_type = 'system.ratelimit.exceeded' AND at >= $1 AND detail->>'kind' = 'password.olvido'`,
        [antes],
      ),
    ).toBe(1);
  });

  it('costeo_backoffice ve la salud de la cola, pero NO `datos`: el token en vuelo no es suyo', async () => {
    expect(
      await contar(
        backoffice,
        `SELECT count(*)::text AS n FROM email_outbox WHERE company_id = $1 AND estado = 'PENDIENTE'`,
        [companyId],
      ),
    ).toBeGreaterThan(0);

    await expect(backoffice.query('SELECT datos FROM email_outbox')).rejects.toMatchObject({
      code: PRIVILEGIO_DENEGADO,
    });
  });
});
