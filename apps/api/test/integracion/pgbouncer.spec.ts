/**
 * La CUARTA condicion de D12: PgBouncer en modo transaccion, probado.
 *
 * LAS OTRAS TRES SE CUMPLEN POR CONSTRUCCION —el envoltorio unico existe, la
 * regla de `audit:forbidden` impide saltarselo, y hay una prueba de dos tenants
 * que falla si se omite—. Esta no: depende del comportamiento de un
 * intermediario que este repositorio no controla, y la unica forma de saberlo
 * es preguntarselo a un PgBouncer de verdad. Si esta prueba fallara, habria que
 * reabrir la eleccion de ORM (ADR-002), no parchear el codigo.
 *
 * QUE ES EXACTAMENTE LO QUE SE COMPRUEBA. En modo transaccion, PgBouncer
 * devuelve la conexion del servidor al pool EN CUANTO TERMINA LA TRANSACCION, y
 * se la entrega al siguiente cliente. Si la Barrera 2 fijara el tenant con un
 * `SET` de sesion, ese valor seguiria puesto en la conexion reutilizada y el
 * siguiente cliente —de otra company— heredaria el tenant del anterior. Seria
 * una fuga entre companies sin una sola linea de codigo equivocada, y ninguna
 * prueba contra una conexion directa la veria.
 *
 * `default_pool_size = 1` en el compose es lo que hace la prueba concluyente:
 * con una sola conexion al servidor, la reutilizacion no es probable, es
 * segura.
 *
 * SE COMPROBO QUE ESTA PRUEBA MIDE ALGO. Cambiando el `TRUE` de `set_config`
 * por `FALSE` —es decir, fijando el tenant en la SESION en vez de en la
 * transaccion— la prueba de "otro cliente no hereda el tenant" falla: el
 * segundo cliente ve la fila de la company del primero. Y hay un detalle que
 * conviene conocer: al deshacer el cambio, la prueba SEGUIA fallando hasta
 * reiniciar PgBouncer. El tenant filtrado no vivia en la aplicacion sino en la
 * conexion que el pooler guarda, y sobrevivio al reinicio del proceso entero.
 * Una fuga asi no se limpia reiniciando la API.
 *
 * NO SE SALTA SI NO HAY POOLER. Una prueba de seguridad que se salta a si misma
 * cuando falta la infraestructura es la sexta variante de INC-007: verde sin
 * medir nada. Si `PGBOUNCER_DATABASE_URL` no esta, esto FALLA y dice como
 * arreglarlo.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyId, type CompanyId } from '../../src/shared/domain/identity/identificadores';
import type { Configuration } from '../../src/shared/infrastructure/config/environment';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { PrismaConnection } from '../../src/shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../src/shared/infrastructure/persistence/tenant-transaction';

const CRUDA = process.env['PGBOUNCER_DATABASE_URL'];
if (CRUDA === undefined || CRUDA === '') {
  throw new Error(
    'Falta PGBOUNCER_DATABASE_URL. Levanta el pooler con `npm run db:up` y copia la variable ' +
      'de .env.example. Esta prueba NO se salta: verifica la cuarta condicion de D12.',
  );
}
/** El estrechamiento no sobrevive al cierre de una funcion: se fija aqui. */
const URL_POOLER: string = CRUDA;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

/** La misma configuracion de la aplicacion, pero apuntando al pooler. */
function porElPooler(): Configuration {
  return { ...loadConfiguration(process.env), databaseUrl: URL_POOLER };
}

describe('PgBouncer en modo transaccion', () => {
  let duena: Client;
  let unaConexion: PrismaConnection;
  let otraConexion: PrismaConnection;
  let una: TenantTransaction;
  let otra: TenantTransaction;

  let companyA: CompanyId;
  let companyB: CompanyId;
  let nombreA: string;
  let nombreB: string;

  async function crearTenant(nombre: string): Promise<CompanyId> {
    const { rows } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [nombre],
    );
    const empresa = companyId(rows[0]?.id ?? '');

    await duena.query(
      `INSERT INTO location (company_id, name, type, status) VALUES ($1, $2, 'LOCAL', 'ACTIVE')`,
      [empresa, `Local de ${nombre}`],
    );

    return empresa;
  }

  beforeAll(async () => {
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    const sufijo = randomUUID().slice(0, 8);
    nombreA = `pool-A-${sufijo}`;
    nombreB = `pool-B-${sufijo}`;
    companyA = await crearTenant(nombreA);
    companyB = await crearTenant(nombreB);

    // DOS clientes distintos, como dos replicas de la aplicacion: es lo que
    // obliga a PgBouncer a repartir entre ellos la unica conexion al servidor.
    unaConexion = new PrismaConnection(porElPooler());
    otraConexion = new PrismaConnection(porElPooler());
    una = new TenantTransaction(unaConexion);
    otra = new TenantTransaction(otraConexion);
  });

  afterAll(async () => {
    await unaConexion.onModuleDestroy();
    await otraConexion.onModuleDestroy();
    await duena.end();
  });

  it('la aplicacion funciona a traves del pooler', async () => {
    const nombres = await una.run(companyA, async (tx) =>
      (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
    );

    expect(nombres).toEqual([`Local de ${nombreA}`]);
  });

  it('las sentencias preparadas de Prisma no rompen en modo transaccion', async () => {
    // Es el fallo clasico: `max_prepared_statements = 0` y Prisma muere con
    // "prepared statement already exists" en la segunda consulta identica. Se
    // ejecuta la MISMA consulta varias veces a proposito.
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      const total = await una.run(companyA, async (tx) => tx.location.count());
      expect(total).toBe(1);
    }
  });

  describe('el tenant NO sobrevive a la transaccion', () => {
    it('otro cliente, sobre la conexion reutilizada, no hereda el tenant', async () => {
      // Cliente 1 trabaja como A y termina. Su conexion vuelve al pool.
      await una.run(companyA, async (tx) => tx.location.findMany({ select: { id: true } }));

      // Cliente 2 toma esa misma conexion —solo hay una— y consulta SIN tenant.
      // Si el tenant se hubiera quedado pegado a la sesion, veria las de A.
      const sinTenant = await otra.runWithoutTenant(
        'prueba: se consulta a proposito sin tenant para demostrar que no queda nada pegado',
        async (tx) => tx.location.findMany({ select: { name: true } }),
      );

      expect(sinTenant).toEqual([]);
    });

    it('un cliente con tenant B no ve nada de A aunque compartan conexion', async () => {
      await una.run(companyA, async (tx) => tx.location.findMany({ select: { id: true } }));

      const deB = await otra.run(companyB, async (tx) =>
        (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
      );

      expect(deB).toEqual([`Local de ${nombreB}`]);
      expect(deB).not.toContain(`Local de ${nombreA}`);
    });

    it('alternar A y B repetidamente nunca cruza datos', async () => {
      // La fuga por reutilizacion de conexion no es determinista: aparece
      // cuando el reparto cae de cierta forma. Se repite para que una pasada
      // afortunada no se confunda con una garantia.
      for (let vuelta = 0; vuelta < 10; vuelta += 1) {
        const deA = await una.run(companyA, async (tx) =>
          (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
        );
        const deB = await otra.run(companyB, async (tx) =>
          (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
        );

        expect(deA).toEqual([`Local de ${nombreA}`]);
        expect(deB).toEqual([`Local de ${nombreB}`]);
      }
    });

    it('en paralelo tampoco, que es cuando el pooler mas reparte', async () => {
      const vueltas = Array.from({ length: 10 }, (_, indice) => indice);

      const resultados = await Promise.all(
        vueltas.map(async (indice) => {
          const cliente = indice % 2 === 0 ? una : otra;
          const empresa = indice % 2 === 0 ? companyA : companyB;

          return cliente.run(empresa, async (tx) =>
            (await tx.location.findMany({ select: { name: true } })).map((l) => l.name),
          );
        }),
      );

      for (const [indice, nombres] of resultados.entries()) {
        expect(nombres).toEqual([indice % 2 === 0 ? `Local de ${nombreA}` : `Local de ${nombreB}`]);
      }
    });
  });
});
