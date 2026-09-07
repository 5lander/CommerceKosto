/**
 * La importación, contra PostgreSQL real — criterio de aceptación de P10.
 *
 *   - **el archivo entero o nada**: 150 filas con la última mala escriben CERO
 *   - dos companies no se ven lo importado
 *   - **un combo importado se costea como combo**, sin cobrar la merma dos
 *     veces (R12, ADR-008 §14)
 *
 * Los CSV son sintéticos y se construyen aquí. CLAUDE.md §7 es explícito: nunca
 * datos reales de clientes en desarrollo. El Excel de referencia no entra al
 * repositorio ni a esta base.
 *
 * No hay peticiones HTTP porque **no hay controlador**: esta versión de la
 * importación se opera desde la línea de comandos. La sesión se abre por el
 * mismo camino que usa el CLI —`IniciarSesion` y después `ValidarSesion`—, así
 * que estas pruebas también cubren esa ruta.
 */

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { IniciarSesion } from '../../src/modules/iam/application/casos-de-uso/iniciar-sesion';
import {
  ValidarSesion,
  type SesionActiva,
} from '../../src/modules/iam/application/casos-de-uso/validar-sesion';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { ImportarArchivo } from '../../src/modules/imports/application/casos-de-uso/importar';
import type { TipoDeImportacion } from '../../src/modules/imports/domain/analisis';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import type { LocationId } from '../../src/shared/domain/identity/identificadores';

const CONTRASENA = 'tres cebollas moradas';

/** El tamaño del criterio de aceptación: la 150 es la que rompe. */
const FILAS_BUENAS = 149;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

interface Tenant {
  readonly companyId: string;
  readonly locationId: string;
  readonly correo: string;
}

describe('importación', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let una: Tenant;
  let otra: Tenant;

  async function sembrarTenant(prefijo: string): Promise<Tenant> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);

    const { rows: companies } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const companyId = companies[0]?.id ?? '';

    // Los parámetros de costeo NO se siembran aquí: el trigger
    // `company_nace_con_ajustes` los pone con los valores de D3 al crear la
    // company. Insertarlos a mano choca con su clave primaria, y descubrirlo
    // así es la señal de que la semilla vive donde debe — en la base, no en
    // cada sitio que crea un tenant.

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [companyId, `${prefijo} centro`],
    );
    const locationId = locales[0]?.id ?? '';

    const correo = `${prefijo}-admin.${sufijo}@ejemplo.ec`;
    await duena.query(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [companyId, correo, hash],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [companyId, correo],
    );

    return { companyId, locationId, correo };
  }

  /** La misma ruta que abre el CLI: login de verdad y después validación. */
  async function sesionDe(tenant: Tenant): Promise<SesionActiva> {
    const abierta = await app.get(IniciarSesion).ejecutar({
      email: tenant.correo,
      contrasena: CONTRASENA,
      ip: null,
      userAgent: null,
    });
    return app.get(ValidarSesion).ejecutar(abierta.token);
  }

  async function importar(
    tenant: Tenant,
    tipo: TipoDeImportacion,
    csv: string,
    opciones: { readonly confirmar?: boolean; readonly confirmarPrecios?: boolean } = {},
  ): Promise<number | null> {
    const resultado = await app.get(ImportarArchivo).ejecutar(await sesionDe(tenant), {
      tipo,
      bytes: Buffer.from(csv, 'utf8'),
      nombreOriginal: `${tipo.toLowerCase()}.csv`,
      claveDeAlmacenamiento: randomUUID(),
      locationId: tenant.locationId as LocationId,
      confirmar: opciones.confirmar ?? true,
      confirmarPrecios: opciones.confirmarPrecios ?? true,
      vigenciaDesde: new Date('2026-01-01T12:00:00.000Z'),
    });

    return resultado.filasEscritas;
  }

  async function contarItems(companyId: string): Promise<number> {
    const { rows } = await duena.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM item WHERE company_id = $1',
      [companyId],
    );
    return Number(rows[0]?.n ?? '0');
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    una = await sembrarTenant('imp');
    otra = await sembrarTenant('omp');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('el archivo entero o nada', () => {
    /**
     * **ES EL CRITERIO DE ACEPTACIÓN DEL PAQUETE.** Antes de P10, cada método
     * del repositorio abría su propia transacción: 150 altas eran 150
     * transacciones y las 149 primeras quedaban escritas. Lo que esta prueba
     * fija no es que falle —eso ya fallaba—, es que **no deje nada dentro**.
     */
    it('150 filas con la última inválida no escriben ni una', async () => {
      const antes = await contarItems(una.companyId);

      const filas = [
        'nombre,tipo,unidad de uso,rendimiento',
        ...Array.from(
          { length: FILAS_BUENAS },
          (_, i) => `Insumo ${sufijo} ${String(i)},COMPRADO,kg,0.95`,
        ),
        // Rendimiento 1.2: limpiar no crea materia. El dominio lo rechaza.
        `Insumo malo ${sufijo},COMPRADO,kg,1.2`,
      ].join('\n');

      await expect(importar(una, 'ITEMS', filas)).rejects.toThrow();
      expect(await contarItems(una.companyId)).toBe(antes);
    }, 120_000);

    it('el mismo archivo sin la fila mala entra entero', async () => {
      const antes = await contarItems(una.companyId);

      const filas = [
        'nombre,tipo,unidad de uso,rendimiento',
        ...Array.from(
          { length: FILAS_BUENAS },
          (_, i) => `Bueno ${sufijo} ${String(i)},COMPRADO,kg,0.95`,
        ),
      ].join('\n');

      expect(await importar(una, 'ITEMS', filas)).toBe(FILAS_BUENAS);
      expect(await contarItems(una.companyId)).toBe(antes + FILAS_BUENAS);
    }, 120_000);

    it('sin --confirmar analiza y no escribe nada', async () => {
      const antes = await contarItems(una.companyId);
      const csv = `nombre,tipo,unidad de uso,rendimiento\nSeco ${sufijo},COMPRADO,kg,1`;

      expect(await importar(una, 'ITEMS', csv, { confirmar: false })).toBeNull();
      expect(await contarItems(una.companyId)).toBe(antes);
    });
  });

  describe('aislamiento entre companies', () => {
    it('lo importado en una company no existe en la otra', async () => {
      const nombre = `Exclusivo ${sufijo}`;
      const csv = `nombre,tipo,unidad de uso,rendimiento\n${nombre},COMPRADO,kg,1`;

      expect(await importar(una, 'ITEMS', csv)).toBe(1);

      const { rows } = await duena.query<{ company_id: string }>(
        'SELECT company_id FROM item WHERE name = $1',
        [nombre],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.company_id).toBe(una.companyId);
      expect(rows[0]?.company_id).not.toBe(otra.companyId);
    });

    it('el rastro de la importación tampoco cruza', async () => {
      const csv = `nombre,tipo,unidad de uso,rendimiento\nRastro ${sufijo},COMPRADO,kg,1`;
      await importar(otra, 'ITEMS', csv);

      const { rows } = await duena.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM import_job WHERE company_id = $1',
        [otra.companyId],
      );

      expect(Number(rows[0]?.n ?? '0')).toBeGreaterThan(0);
    });
  });

  describe('un combo se importa como combo', () => {
    /**
     * **LA PRUEBA QUE JUSTIFICA METER COMBOS EN ESTE SPRINT.** `combo_component`
     * existe desde P4 y hasta ahora **nadie la había escrito nunca**: un combo
     * se podía crear y jamás componer. Lo que se fija aquí es que la línea de un
     * COMBO va a esa tabla y no a `recipe_line`, que es lo que evita volver a
     * aplicarle rendimiento y merma (R12, ADR-008 §14).
     */
    it('la línea de un combo va a combo_component, no a recipe_line', async () => {
      const simple = `Panini ${sufijo}`;
      const combo = `Combo panini ${sufijo}`;
      const insumo = `Pan ${sufijo}`;

      await importar(una, 'ITEMS', `nombre,tipo,unidad de uso,rendimiento\n${insumo},COMPRADO,unid,1`);
      await importar(
        una,
        'PRODUCTOS',
        [
          'nombre,tipo,pvp,porciones',
          `${simple},SIMPLE,4.50,1`,
          `${combo},COMBO,5.25,1`,
        ].join('\n'),
      );
      await importar(
        una,
        'RECETAS',
        ['producto,item,cantidad,base', `${simple},${insumo},1,EP`, `${combo},${simple},1,EP`].join(
          '\n',
        ),
      );

      const { rows: componentes } = await duena.query<{ cantidad: string }>(
        `SELECT cc.cantidad::text AS cantidad
           FROM combo_component cc
           JOIN product p ON p.id = cc.combo_product_id
          WHERE p.name = $1`,
        [combo],
      );
      expect(componentes).toHaveLength(1);

      // Y el combo NO tiene receta a ítems: si la tuviera, su costo sumaría el
      // pan otra vez, ya con la merma aplicada.
      const { rows: lineas } = await duena.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM recipe_line rl
           JOIN recipe r ON r.id = rl.recipe_id
           JOIN product p ON p.id = r.product_id
          WHERE p.name = $1`,
        [combo],
      );
      expect(Number(lineas[0]?.n ?? '0')).toBe(0);
    }, 120_000);

    it('un combo que contiene otro combo se rechaza', async () => {
      const comboA = `Combo A ${sufijo}`;
      const comboB = `Combo B ${sufijo}`;

      await importar(
        una,
        'PRODUCTOS',
        ['nombre,tipo,pvp,porciones', `${comboA},COMBO,9.00,1`, `${comboB},COMBO,8.00,1`].join('\n'),
      );

      await expect(
        importar(una, 'RECETAS', `producto,item,cantidad,base\n${comboA},${comboB},1,EP`),
      ).rejects.toThrow(/no puede contener otro combo/u);
    }, 120_000);
  });
});
