#!/usr/bin/env node
/**
 * `npm run restaurar:tenant -- --company=<uuid>` — devuelve los datos de UNA
 * company desde la base auxiliar, sin tocar a las demás (D-16.195).
 *
 * POR QUE EXISTE. `npm run restaurar` deja el respaldo entero en
 * `costeo_restaurado`, y eso sirve para la pérdida total. Pero el caso probable
 * no es ese: es un cliente que borró lo suyo, o una importación que se comió su
 * catálogo. Restaurar la base completa para arreglarle el día a uno significaría
 * devolver a TODOS los demás al estado de ayer — un incidente peor que el que se
 * está arreglando.
 *
 * COMO FUNCIONA, EN UNA LINEA: las filas salen y entran por la MISMA BARRERA que
 * las protege. Las dos conexiones —la de la copia y la del destino— usan el rol
 * de la aplicación con `app.company_id` fijado, así que RLS recorta el volcado y
 * vuelve a comprobar cada fila al insertarla. No hay ni un `WHERE company_id`
 * escrito a mano: si lo hubiera, sería una segunda definición de "qué es de
 * quién", y la única que vale es la de la base.
 *
 * LO QUE NO VUELVE, Y ESTA DICHO EN `lib/tenant.mjs`: las sesiones (son
 * credenciales vivas), el outbox de correo (no se reenvían invitaciones viejas)
 * y los dos registros append-only, que la aplicación ni siquiera puede leer.
 *
 * EL DESTINO TIENE QUE ESTAR VACIO PARA ESE TENANT. No se mezcla lo restaurado
 * con lo que haya: mezclar deja una base que no es ni lo uno ni lo otro, que es
 * la misma razón por la que `restaurar` no escribe encima de una base con
 * tablas. El cascarón —la fila de `company`— sí tiene que existir: lo crea
 * `seed:tenant`, o sigue ahí si lo que se perdió fueron los datos.
 */

import { apuntandoA, exigir } from './lib/entorno.mjs';
import { volcarTablaDelTenant } from './lib/pgdump.mjs';
import { aplicarSql, consultar } from './lib/psql.mjs';
import { comoRecuentos } from './lib/testigos.mjs';
import { argumento } from './lib/proceso.mjs';
import {
  SQL_DE_LOS_AJUSTES,
  SQL_DE_RECUENTOS_DEL_TENANT,
  SQL_LA_COMPANY,
  SQL_TABLAS_CON_TENANT,
  TABLAS_DEL_TENANT,
  TABLAS_QUE_NO_VUELVEN,
} from './lib/tenant.mjs';

const SALIDA_CON_ERROR = 1;

/** La auxiliar que deja `npm run restaurar`. Es una constante, como allí. */
const BASE_AUXILIAR = 'costeo_restaurado';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * El entorno que fija el tenant en la sesión: RLS hace el resto.
 *
 * @param {string} company @returns {Record<string, string>}
 */
function comoTenant(company) {
  return { PGOPTIONS: `-c app.company_id=${company}` };
}

/** @param {string} conexion @param {string} company @returns {ReadonlyMap<string, string>} */
function recuentos(conexion, company) {
  return comoRecuentos(
    consultar({ conexion, sql: SQL_DE_RECUENTOS_DEL_TENANT, entorno: comoTenant(company) }),
  );
}

/**
 * La copia auxiliar tiene que existir, y decirlo con palabras: el error de psql
 * —«database "costeo_restaurado" does not exist»— es correcto y no dice qué hacer.
 *
 * @param {string} origen @param {string} base
 */
function exigirLaCopia(origen, base) {
  try {
    consultar({ conexion: origen, sql: 'SELECT 1' });
  } catch {
    throw new Error(
      [
        `No se puede leer la base "${base}".`,
        '',
        'Este paso es el SEGUNDO: la copia completa la deja `npm run restaurar`.',
        '  npm run restaurar -- .respaldos/<el respaldo>.dump',
        '  npm run restaurar:tenant -- --company=<uuid>',
      ].join('\n'),
    );
  }
}

/**
 * El catálogo manda: si hay una tabla de tenant que la lista no conoce, parar.
 * Una restauración incompleta no se nota hasta que el cliente busca lo que falta.
 *
 * @param {string} conexion
 */
function exigirListaCompleta(conexion) {
  const enLaBase = consultar({ conexion, sql: SQL_TABLAS_CON_TENANT })
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean);

  const conocidas = new Set([...TABLAS_DEL_TENANT, ...TABLAS_QUE_NO_VUELVEN]);
  const nuevas = enLaBase.filter((tabla) => !conocidas.has(tabla));
  if (nuevas.length > 0) {
    throw new Error(
      [
        `Hay ${String(nuevas.length)} tabla(s) de tenant que esta lista no conoce: ${nuevas.join(', ')}.`,
        '',
        'Anadelas a TABLAS_DEL_TENANT (en orden de claves foraneas) o a',
        'TABLAS_QUE_NO_VUELVEN, con el motivo. Ver scripts/lib/tenant.mjs.',
      ].join('\n'),
    );
  }
}

/** @param {string} destino @param {string} company @returns {string} */
function exigirCompanyEnDestino(destino, company) {
  const fila = consultar({ conexion: destino, sql: SQL_LA_COMPANY, entorno: comoTenant(company) }).trim();
  if (fila === '') {
    throw new Error(
      [
        `La company ${company} no existe en el destino.`,
        '',
        'Se restauran SUS DATOS, no su alta: el cascaron (company, y con el sus',
        'ajustes) lo crea `npm run seed:tenant`. Si lo que se perdio fue la',
        'company entera, creala primero y vuelve.',
      ].join('\n'),
    );
  }
  return fila;
}

/** @param {string} destino @param {string} company */
function exigirDestinoVacio(destino, company) {
  const conFilas = [...recuentos(destino, company).entries()].filter(([, filas]) => filas !== '0');
  if (conFilas.length > 0) {
    throw new Error(
      [
        'El destino YA tiene datos de esa company, y esto no escribe encima:',
        ...conFilas.map(([tabla, filas]) => `  ${tabla}: ${filas} filas`),
        '',
        'Mezclar lo restaurado con lo que hay deja una base que no es ni lo uno',
        'ni lo otro. Si de verdad hay que rehacer el tenant, vacialo primero y',
        'vuelve a lanzar esto.',
      ].join('\n'),
    );
  }
}

/** @param {{origen: string, destino: string, company: string}} peticion */
function copiar({ origen, destino, company }) {
  for (const tabla of TABLAS_DEL_TENANT) {
    const sql = volcarTablaDelTenant({ conexion: origen, tabla, company });
    aplicarSql({ conexion: destino, sql, descripcion: `las filas de ${tabla}`, entorno: comoTenant(company) });
  }
}

/**
 * Los ajustes de costeo no se reinsertan (ver `lib/tenant.mjs`): se comparan y,
 * si no coinciden, se dicen. Son el IVA y los objetivos de food cost de un
 * cliente: restaurarlos en silencio seria peor que no restaurarlos.
 *
 * @param {{origen: string, destino: string, company: string}} peticion
 */
function avisarDeLosAjustes({ origen, destino, company }) {
  const entorno = comoTenant(company);
  const enLaCopia = consultar({ conexion: origen, sql: SQL_DE_LOS_AJUSTES, entorno }).trim();
  const enDestino = consultar({ conexion: destino, sql: SQL_DE_LOS_AJUSTES, entorno }).trim();

  if (enLaCopia === enDestino) {
    console.log('[restaurar-tenant] ajustes de costeo: iguales a los de la copia, nada que reponer');
    return;
  }

  console.log('[restaurar-tenant] ATENCION — los ajustes de costeo NO coinciden y NO se restauran solos:');
  console.log(`[restaurar-tenant]   en la copia: ${enLaCopia === '' ? '(sin fila)' : enLaCopia}`);
  console.log(`[restaurar-tenant]   en destino:  ${enDestino === '' ? '(sin fila)' : enDestino}`);
  console.log('[restaurar-tenant]   Reponlos desde la pantalla de Ajustes. Orden de las columnas:');
  console.log('[restaurar-tenant]   iva_venta, iva_compra_recuperable, provision_merma, food_cost_objetivo,');
  console.log('[restaurar-tenant]   food_cost_maximo, food_cost_umbral_verde, prime_cost_maximo,');
  console.log('[restaurar-tenant]   regla_popularidad, dias_operativos_mes, dias_cobertura');
}

/** @param {ReadonlyMap<string, string>} antes @param {ReadonlyMap<string, string>} despues */
function comparar(antes, despues) {
  const descuadres = TABLAS_DEL_TENANT.filter(
    (tabla) => (antes.get(tabla) ?? '0') !== (despues.get(tabla) ?? '0'),
  );

  for (const tabla of TABLAS_DEL_TENANT) {
    const filas = despues.get(tabla) ?? '0';
    if (filas !== '0') console.log(`[restaurar-tenant]   ${tabla}: ${filas} filas`);
  }

  if (descuadres.length > 0) {
    throw new Error(
      [
        'Los recuentos NO cuadran tras restaurar:',
        ...descuadres.map((t) => `  ${t}: copia ${antes.get(t) ?? '0'} / destino ${despues.get(t) ?? '0'}`),
      ].join('\n'),
    );
  }
}

/**
 * Todo lo que tiene que ser cierto ANTES de escribir una sola fila.
 *
 * @param {{origen: string, destino: string, company: string, desde: string}} peticion
 * @returns {ReadonlyMap<string, string>} lo que hay en la copia, por tabla
 */
function exigirQueSePueda({ origen, destino, company, desde }) {
  exigirLaCopia(origen, desde);
  exigirListaCompleta(origen);
  const cual = exigirCompanyEnDestino(destino, company);
  console.log(`[restaurar-tenant] company ${company} -> ${cual}`);

  const enLaCopia = recuentos(origen, company);
  const total = [...enLaCopia.values()].reduce((suma, filas) => suma + Number(filas), 0);
  console.log(`[restaurar-tenant] en ${desde}: ${String(total)} filas suyas en ${String(TABLAS_DEL_TENANT.length)} tablas`);
  if (total === 0) {
    throw new Error(`La copia ${desde} no tiene ni una fila de esa company. ¿Es el respaldo correcto?`);
  }

  exigirDestinoVacio(destino, company);
  return enLaCopia;
}

function principal() {
  const company = argumento('company');
  if (company === undefined || !UUID.test(company)) {
    throw new Error('Uso: npm run restaurar:tenant -- --company=<uuid de la company>');
  }

  const desde = argumento('desde') ?? BASE_AUXILIAR;
  const conexionApp = exigir('DATABASE_URL');
  const origen = apuntandoA(conexionApp, desde);
  const destino = conexionApp;

  const enLaCopia = exigirQueSePueda({ origen, destino, company, desde });
  copiar({ origen, destino, company });
  comparar(enLaCopia, recuentos(destino, company));
  avisarDeLosAjustes({ origen, destino, company });

  console.log('[restaurar-tenant] listo — los recuentos cuadran tabla por tabla');
  console.log('[restaurar-tenant] NO vuelven, a proposito: sesiones, outbox de correo y los dos logs');
  console.log('[restaurar-tenant] los ajustes de costeo se comparan, no se reinsertan (los crea el trigger)');
}

try {
  principal();
} catch (error) {
  console.error(`\n[restaurar-tenant] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(SALIDA_CON_ERROR);
}
