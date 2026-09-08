/**
 * El back office contra PostgreSQL real — criterio de aceptación de P11.
 *
 * Las tres cosas que el plan exige, y una cuarta que la migración prometió:
 *
 *   1. **Ningún módulo de la app cliente alcanza la conexión privilegiada.** Se
 *      comprueba sobre el contenedor de Nest YA CONSTRUIDO, no leyendo imports:
 *      un grep lo verifica `audit:forbidden`, pero lo que de verdad importa es
 *      si el objeto está o no en el inyector, y eso solo se sabe preguntándole.
 *   2. **Toda operación cross-tenant deja registro con motivo.**
 *   3. **El registro no se puede editar ni borrar**, ni siquiera por el rol que
 *      lo escribe: se comprueba contra la base con su propio rol.
 *   4. **`audit_log` por fin tiene lector**, que es el pendiente estructural que
 *      arrastraba desde P0.
 *
 * Y una que sale gratis y vale mucho: **el motivo corto se rechaza con 400 y no
 * escribe nada**. Es la diferencia entre un control y un adorno.
 */

import { randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { BackofficeModule } from '../../src/modules/backoffice/backoffice.module';
import { BackofficeConnection } from '../../src/modules/backoffice/infrastructure/backoffice-connection';
import {
  CambiarPlan,
  CrearCompany,
  ListarCompanies,
  VerCompany,
  type PeticionDeOperador,
} from '../../src/modules/backoffice/application/casos-de-uso/companies';
import { LeerAuditoria } from '../../src/modules/backoffice/application/casos-de-uso/auditoria';
import {
  IniciarSesionDeOperador,
  ValidarSesionDeOperador,
} from '../../src/modules/backoffice/application/casos-de-uso/sesion';
import { MotivoInsuficienteError } from '../../src/modules/backoffice/domain/motivo';
import { PlanNoAlcanzaError } from '../../src/modules/backoffice/domain/errores';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import type { CompanyId } from '../../src/shared/domain/identity/identificadores';

const CONTRASENA = 'siete cebollas moradas';

const MOTIVO = 'El cliente reporta un food cost negativo en el cierre de marzo';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

const URL_BACKOFFICE = process.env['BACKOFFICE_DATABASE_URL'];
if (URL_BACKOFFICE === undefined) {
  throw new Error('Falta BACKOFFICE_DATABASE_URL. Ver .env.example.');
}

describe('back office', () => {
  let backoffice: INestApplicationContext;
  let duena: Client;
  let comoBackoffice: Client;
  let sufijo: string;
  let peticion: PeticionDeOperador;
  let companyDePrueba: CompanyId;

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    comoBackoffice = new Client({ connectionString: URL_BACKOFFICE });
    await comoBackoffice.connect();

    // `NestFactory` y no `@nestjs/testing`: montar el modulo de verdad no
    // necesita una dependencia mas, y ademas prueba el mismo camino que usa
    // `backoffice.ts` en produccion.
    //
    // SIN HTTP, y es obligatorio: esta suite ya monta la aplicacion CLIENTE
    // —para comprobar que no tiene la conexion privilegiada— y **dos
    // aplicaciones HTTP de Nest en el mismo worker de vitest hacen que Node
    // reviente con un fallo nativo**, sin mensaje. La superficie HTTP del back
    // office se prueba en `backoffice-interfaz.spec.ts`, que corre en su propio
    // worker por ser otro archivo.
    backoffice = await NestFactory.createApplicationContext(BackofficeModule, { logger: false });

    // Un operador de verdad, con el hasher de verdad.
    await duena.query(
      `INSERT INTO backoffice_user (email, password_hash, status) VALUES ($1, $2, 'ACTIVE')`,
      [`operador-${sufijo}@ejemplo.invalid`, await new Argon2Hasher().hash(CONTRASENA)],
    );

    const token = await backoffice.get(IniciarSesionDeOperador).ejecutar({
      email: `operador-${sufijo}@ejemplo.invalid`,
      contrasena: CONTRASENA,
      ip: null,
      userAgent: null,
    });
    const operador = await backoffice.get(ValidarSesionDeOperador).ejecutar(token);
    peticion = { operador, motivo: MOTIVO, ip: null };

    companyDePrueba = await backoffice
      .get(CrearCompany)
      .ejecutar(peticion, {
        nombre: `Cliente de prueba ${sufijo}`,
        plan: 'BASICO',
        emailDelDueno: `dueno-${sufijo}@ejemplo.invalid`,
      });
  }, 60_000);

  afterAll(async () => {
    await backoffice.close();
    await duena.end();
    await comoBackoffice.end();
  });

  /**
   * EL CRITERIO DE ACEPTACIÓN, sobre el contenedor real.
   *
   * `audit:forbidden` ya impide escribir el import, y `audit:arch` impide la
   * arista. Esto comprueba la consecuencia: que el objeto NO ESTÁ donde la
   * aplicación cliente podría pedirlo. Es la diferencia entre «nadie lo ha
   * escrito» y «no se puede».
   */
  it('la aplicación cliente NO tiene la conexión privilegiada en su contenedor', async () => {
    const app = await createApplication(loadConfiguration(process.env));

    try {
      expect(() => app.get(BackofficeConnection)).toThrow();
      expect(() => app.get(BackofficeConnection, { strict: false })).toThrow();
    } finally {
      await app.close();
    }
  }, 60_000);

  it('el proceso del back office SÍ la tiene: la prueba anterior mide algo', () => {
    // Sin esto, la de arriba pasaría igual si `BackofficeConnection` no
    // existiera en ningún sitio. Es la pareja que la vuelve una comprobación.
    expect(backoffice.get(BackofficeConnection)).toBeDefined();
  });

  describe('el motivo', () => {
    it('rechaza uno corto con 400 y NO escribe nada', async () => {
      const antes = await contarAccesos(duena);

      await expect(
        backoffice
          .get(ListarCompanies)
          .ejecutar({ ...peticion, motivo: 'soporte' }),
      ).rejects.toThrow(MotivoInsuficienteError);

      expect(await contarAccesos(duena)).toBe(antes);
    });

    it('la base lo exige aunque el dominio no lo hiciera', async () => {
      // La red por debajo (INC-012): si alguien añade un caso de uso y se olvida
      // de `exigirMotivoSuficiente`, el CHECK lo para igual.
      await expect(
        duena.query(
          `INSERT INTO backoffice_access_log (operator_id, company_id, action, reason)
           SELECT id, NULL, 'company.list', 'corto' FROM backoffice_user LIMIT 1`,
        ),
      ).rejects.toThrow(/motivo_con_sustancia/u);
    });
  });

  describe('el registro de acceso', () => {
    it('ver una company deja su línea con motivo, operador y company', async () => {
      await backoffice.get(VerCompany).ejecutar(peticion, companyDePrueba);

      const { rows } = await duena.query<{ action: string; reason: string; company_id: string }>(
        `SELECT action, reason, company_id FROM backoffice_access_log
          WHERE company_id = $1 AND action = 'company.read'
          ORDER BY at DESC LIMIT 1`,
        [companyDePrueba],
      );

      expect(rows[0]?.reason).toBe(MOTIVO);
      expect(rows[0]?.company_id).toBe(companyDePrueba);
    });

    it('NO se puede editar ni borrar, ni con el rol que lo escribe', async () => {
      // Los privilegios, comprobados contra la base y no supuestos. Es la misma
      // decisión que sostiene R3 en el libro de inventario: append-only por
      // privilegio, no por costumbre.
      await expect(
        comoBackoffice.query(`UPDATE backoffice_access_log SET reason = 'otro'`),
      ).rejects.toThrow(/permission denied/u);

      await expect(comoBackoffice.query(`DELETE FROM backoffice_access_log`)).rejects.toThrow(
        /permission denied/u,
      );
    });

    it('la aplicación cliente no lo ve ni con SELECT', async () => {
      const comoApp = new Client({ connectionString: process.env['DATABASE_URL'] });
      await comoApp.connect();

      try {
        await expect(comoApp.query('SELECT 1 FROM backoffice_access_log')).rejects.toThrow(
          /permission denied/u,
        );
      } finally {
        await comoApp.end();
      }
    });
  });

  describe('planes y límites', () => {
    it('no deja bajar de plan por debajo de lo que la company ya tiene', async () => {
      // CADENA permite 100 ubicaciones; se crean 11 y se intenta volver a
      // BASICO, que permite 10.
      await backoffice
        .get(CambiarPlan)
        .ejecutar(peticion, { companyId: companyDePrueba, plan: 'CADENA' });

      for (let numero = 0; numero < 11; numero += 1) {
        await duena.query(
          `INSERT INTO location (company_id, name, type, status)
           VALUES ($1, $2, 'AMBOS', 'ACTIVE')`,
          [companyDePrueba, `Sucursal ${String(numero)} ${sufijo}`],
        );
      }

      await expect(
        backoffice
          .get(CambiarPlan)
          .ejecutar(peticion, { companyId: companyDePrueba, plan: 'BASICO' }),
      ).rejects.toThrow(PlanNoAlcanzaError);
    });
  });

  describe('audit_log', () => {
    it('el back office puede leerlo — el pendiente estructural desde P0', async () => {
      const lineas = await backoffice.get(LeerAuditoria).ejecutar(peticion, null);

      // Que devuelva algo importa menos que que NO lance: hasta P11 esta
      // consulta era imposible porque ningún rol tenía SELECT sobre la tabla.
      expect(Array.isArray(lineas)).toBe(true);
    });

    it('la aplicación cliente sigue sin poder leerlo', async () => {
      const comoApp = new Client({ connectionString: process.env['DATABASE_URL'] });
      await comoApp.connect();

      try {
        // Tiene GRANT SELECT pero la política `audit_log_app_no_lee` es
        // `USING (false)`: cero filas, no un error. La política es la cerradura.
        const { rows } = await comoApp.query('SELECT id FROM audit_log LIMIT 1');
        expect(rows).toHaveLength(0);
      } finally {
        await comoApp.end();
      }
    });
  });
});

async function contarAccesos(cliente: Client): Promise<number> {
  const { rows } = await cliente.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM backoffice_access_log',
  );
  return Number(rows[0]?.total ?? '0');
}
