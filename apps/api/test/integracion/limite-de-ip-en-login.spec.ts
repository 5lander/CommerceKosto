/**
 * 🔴 El eje de IP del login limita, no bloquea — D-16.196, ADR-028, INC-027.
 *
 *   🔴  treinta fallos de UNA cuenta desde una IP no dejan fuera a las demas
 *   🔴  doce cuentas distintas tampoco: eso lo junta una IP compartida (D-16.199)
 *   🔴  cincuenta si: 429 LIMITE_DE_SOLICITUDES con Retry-After
 *
 * VIVE EN SU PROPIO ARCHIVO, Y CON UNA IP FALSA, POR UNA RAZON QUE ES LA MISMA
 * QUE LA DEL CAMBIO. Las demas suites salen todas de `127.0.0.1`: si estas
 * pruebas ensuciaran esa IP —o borraran `login_attempt` para limpiarla— le
 * dejarian caer un 429 encima a cualquier login que otro archivo estuviera
 * haciendo a la vez, y romperian pruebas que no tienen nada que ver. Es el
 * problema de INC-027 a escala de banco de pruebas: una IP compartida.
 *
 * Asi que la aplicacion se monta con `127.0.0.1` como PROXY DE CONFIANZA y cada
 * peticion trae su `X-Forwarded-For`. `ipDelCliente` toma ese ultimo salto
 * (INC-022), de modo que estas pruebas viven en una IP que no existe —la de
 * documentacion de RFC 5737— y no tocan a nadie.
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
const DEMASIADAS_PETICIONES = 429;
/** Quince minutos: el enfriamiento fijo del eje de IP (ADR-028). */
const SEGUNDOS_DE_ENFRIAMIENTO = 15 * 60;
/** Cuentas distintas en una hora que disparan el limite (D-16.199). */
const CUENTAS_DEL_ROCIADO = 50;
/** Lo que junta un lunes por la manana detras de un CGNAT, y NO puede limitar. */
const CUENTAS_DE_UN_LUNES = 12;

const CONTRASENA = 'tres cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

describe('🔴 el eje de IP del login limita, no bloquea (D-16.196)', () => {
  let app: INestApplication;
  let duena: Client;
  let admin: string;
  let gerente: string;
  /** IP de documentacion (RFC 5737): no es de nadie, y no la usa ninguna otra suite. */
  const IP = `198.51.100.${String(Math.floor(Math.random() * 200) + 20)}`;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function entrar(email: string, contrasena = CONTRASENA): request.Test {
    return request(servidor()).post('/auth/login').set('X-Forwarded-For', IP).send({ email, contrasena });
  }

  /** Fallos ya ocurridos, escritos en la tabla: lo que se mide es la politica, no Argon2id. */
  async function fallosDesdeLaIp(correos: readonly string[], cadaUno: number): Promise<void> {
    for (const correo of correos) {
      for (let n = 0; n < cadaUno; n += 1) {
        await duena.query(`INSERT INTO login_attempt (email, ip, outcome) VALUES ($1, $2, 'failure')`, [correo, IP]);
      }
    }
  }

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
      proxiesDeConfianza: ['127.0.0.1'],
    });
    await app.init();

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`limite de ip ${sufijo}`],
    );
    const company = rows[0]?.id ?? '';
    const { rows: ubicaciones } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status) VALUES ($1, 'Centro', 'LOCAL', 'ACTIVE') RETURNING id`,
      [company],
    );

    admin = `admin.${sufijo}@snacklab.ec`;
    gerente = `gerente.${sufijo}@snacklab.ec`;
    for (const correo of [admin, gerente]) {
      await duena.query(`INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE')`, [company, correo, hash]);
    }
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location) SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, admin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location) SELECT $1, id, 'GERENTE_LOCAL', $2, true FROM app_user WHERE email = $3`,
      [company, ubicaciones[0]?.id, gerente],
    );
  });

  afterAll(async () => {
    // Solo lo de ESTA IP: `login_attempt` es de todos.
    await duena.query('DELETE FROM login_attempt WHERE ip = $1', [IP]);
    await app.close();
    await duena.end();
  });

  it('🔴 treinta fallos de UNA cuenta no dejan fuera a las demas de esa IP', async () => {
    await duena.query('DELETE FROM login_attempt WHERE ip = $1', [IP]);
    await fallosDesdeLaIp([gerente], 30);

    const respuesta = await entrar(admin);

    expect(respuesta.status).toBe(OK);
  });

  it('🔴 doce cuentas distintas NO limitan: eso lo junta una IP compartida (D-16.199)', async () => {
    await duena.query('DELETE FROM login_attempt WHERE ip = $1', [IP]);
    const tanteadas = Array.from({ length: CUENTAS_DE_UN_LUNES }, (_, n) => `lunes${String(n)}.${randomUUID().slice(0, 6)}@snacklab.ec`);
    await fallosDesdeLaIp(tanteadas, 1);

    const respuesta = await entrar(admin);

    expect(respuesta.status).toBe(OK);
  });

  it('🔴 cincuenta cuentas distintas si: 429 LIMITE_DE_SOLICITUDES con Retry-After, sin bloquear ninguna cuenta', async () => {
    await duena.query('DELETE FROM login_attempt WHERE ip = $1', [IP]);
    const tanteadas = Array.from({ length: CUENTAS_DEL_ROCIADO }, (_, n) => `barrido${String(n)}.${randomUUID().slice(0, 6)}@snacklab.ec`);
    await fallosDesdeLaIp(tanteadas, 1);

    const respuesta = await entrar(admin);

    expect(respuesta.status).toBe(DEMASIADAS_PETICIONES);
    expect(respuesta.body).toMatchObject({ code: 'LIMITE_DE_SOLICITUDES' });
    const espera = Number(respuesta.headers['retry-after']);
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(SEGUNDOS_DE_ENFRIAMIENTO);
  });

  it('y la misma cuenta entra sin problema desde otra IP: el limite es de la conexion', async () => {
    const otraIp = '198.51.100.7';
    const respuesta = await request(servidor())
      .post('/auth/login')
      .set('X-Forwarded-For', otraIp)
      .send({ email: admin, contrasena: CONTRASENA });

    expect(respuesta.status).toBe(OK);
  });
});
